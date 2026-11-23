import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  chartPayloadSchema,
  diagramPayloadSchema,
  parseAnnotatedMarkdown,
  proposalBlockPayloadSchema,
  proposalOpInputSchema,
  serializeBlocksToAnnotatedMarkdown,
  validateMermaidDiagram,
  validateVegaLiteChart,
} from '@docalaizer/core';
import { type Database, documents, revisions } from '@docalaizer/db';
import { APPROVAL_POLICIES, PROPOSAL_STATUSES } from '@docalaizer/shared';
import { AppError } from '../errors';
import {
  getProjectTree,
  listAgentAccessibleProjects,
  searchDocumentsByProjectIds,
} from '../services/project.service';
import {
  createDocumentAsAgent,
  createProposalAsAgent,
  getProposalForAgent,
  listProposalsForAgent,
  proposeMarkdownUpdateAsAgent,
  updateProposalAsAgent,
} from '../services/proposal.service';
import {
  type AuthAgent,
  assertAgentProjectAccess,
  assertAgentScope,
  createProjectAsAgent,
} from '../services/rbac.service';

function okJson(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorJson(err: unknown) {
  if (err instanceof AppError) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: {
                code: err.code,
                message: err.message,
                ...(err.details !== undefined ? { details: err.details } : {}),
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  const message = err instanceof Error ? err.message : 'Unexpected tool error';
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message } }) }],
  };
}

async function runTool<T>(fn: () => Promise<T>) {
  try {
    return okJson(await fn());
  } catch (err) {
    return errorJson(err);
  }
}

export function createDocalaizerMcpServer(db: Database, agent: AuthAgent): McpServer {
  const server = new McpServer({
    name: 'docalaizer',
    version: '0.1.0',
  });

  // 1. list_projects
  server.tool(
    'list_projects',
    'List projects accessible to this AI agent.',
    { query: z.string().optional() },
    async ({ query }) =>
      runTool(async () => {
        const items = await listAgentAccessibleProjects(db, agent, query);
        return {
          projects: items.map((p) => ({
            id: p.id,
            slug: p.slug,
            name: p.name,
            description: p.description,
            default_approval_policy: p.defaultApprovalPolicy,
          })),
        };
      }),
  );

  // 2. create_project
  server.tool(
    'create_project',
    'Create a new project (requires projects:create scope).',
    {
      name: z.string().min(1).max(140),
      slug: z.string().min(1).max(80).optional(),
      description: z.string().max(1000).optional(),
      icon: z.string().max(32).optional(),
      default_approval_policy: z.enum(APPROVAL_POLICIES).optional(),
    },
    async (args) =>
      runTool(async () => {
        const slug =
          args.slug ??
          (args.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') ||
            `project-${Date.now()}`);
        const project = await createProjectAsAgent(db, agent, {
          name: args.name,
          slug,
          description: args.description,
          icon: args.icon,
          defaultApprovalPolicy: args.default_approval_policy,
        });
        return { project };
      }),
  );

  // 3. get_project_tree
  server.tool(
    'get_project_tree',
    'Get hierarchical document tree for a project.',
    { project_id: z.string().uuid() },
    async ({ project_id }) =>
      runTool(async () => {
        assertAgentScope(agent, 'projects:read');
        await assertAgentProjectAccess(db, agent, project_id, [
          'owner',
          'editor',
          'reviewer',
          'viewer',
        ]);
        const tree = await getProjectTree(db, project_id);
        return { documents: tree };
      }),
  );

  // 4. search_docs
  server.tool(
    'search_docs',
    'Full-text search across accessible documentation pages.',
    {
      query: z.string().min(1),
      project_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ query, project_id, limit }) =>
      runTool(async () => {
        assertAgentScope(agent, 'docs:read');
        const accessible = await listAgentAccessibleProjects(db, agent);
        let projectIds = accessible.map((p) => p.id);
        if (project_id) {
          if (!projectIds.includes(project_id)) {
            throw new AppError(403, 'PROJECT_ACCESS_DENIED', 'Agent cannot access this project.');
          }
          projectIds = [project_id];
        }
        const results = await searchDocumentsByProjectIds(db, { projectIds, query, limit });
        return { results };
      }),
  );

  // 5. get_doc
  server.tool(
    'get_doc',
    'Read document head revision, block IDs, and humanTouched/lockedByHuman protection flags.',
    {
      doc_id: z.string().uuid(),
      format: z.enum(['blocks', 'annotated_markdown']).optional(),
    },
    async ({ doc_id, format }) =>
      runTool(async () => {
        assertAgentScope(agent, 'docs:read');
        const [doc] = await db.select().from(documents).where(eq(documents.id, doc_id)).limit(1);
        if (!doc) throw new AppError(404, 'NOT_FOUND', 'Document not found.');
        await assertAgentProjectAccess(db, agent, doc.projectId, [
          'owner',
          'editor',
          'reviewer',
          'viewer',
        ]);

        const headRev = doc.headRevisionId
          ? (
              await db
                .select()
                .from(revisions)
                .where(eq(revisions.id, doc.headRevisionId))
                .limit(1)
            )[0] ?? null
          : null;

        const blocks = headRev?.blocksSnapshot ?? [];
        return {
          doc_id: doc.id,
          project_id: doc.projectId,
          title: doc.title,
          slug: doc.slug,
          head_revision_id: doc.headRevisionId,
          revision_number: headRev?.revisionNumber ?? 0,
          is_draft: doc.isDraft,
          ...(format === 'annotated_markdown'
            ? { annotated_markdown: serializeBlocksToAnnotatedMarkdown(blocks) }
            : { blocks }),
        };
      }),
  );

  // 6. get_doc_history
  server.tool(
    'get_doc_history',
    'Get recent revision history for a document.',
    {
      doc_id: z.string().uuid(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ doc_id, limit }) =>
      runTool(async () => {
        assertAgentScope(agent, 'docs:read');
        const [doc] = await db.select().from(documents).where(eq(documents.id, doc_id)).limit(1);
        if (!doc) throw new AppError(404, 'NOT_FOUND', 'Document not found.');
        await assertAgentProjectAccess(db, agent, doc.projectId, [
          'owner',
          'editor',
          'reviewer',
          'viewer',
        ]);

        const history = await db
          .select({
            id: revisions.id,
            revision_number: revisions.revisionNumber,
            author_type: revisions.authorType,
            summary: revisions.summary,
            created_at: revisions.createdAt,
          })
          .from(revisions)
          .where(eq(revisions.documentId, doc.id))
          .orderBy(desc(revisions.revisionNumber))
          .limit(limit ?? 20);
        return { revisions: history };
      }),
  );

  // 7. create_doc
  server.tool(
    'create_doc',
    'Create a new documentation page (auto-published or pending Proposal per project policy).',
    {
      project_id: z.string().uuid(),
      parent_id: z.string().uuid().nullable().optional(),
      title: z.string().min(1).max(200),
      slug: z.string().min(1).max(120).optional(),
      icon: z.string().max(32).optional(),
      blocks: z.array(proposalBlockPayloadSchema).optional(),
      markdown: z.string().optional(),
      rationale: z.string().max(1000).optional(),
      idempotency_key: z.string().max(200).optional(),
    },
    async (args) =>
      runTool(async () => {
        const slug =
          args.slug ??
          (args.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') ||
            `doc-${Date.now()}`);
        const blocks =
          args.blocks ??
          (args.markdown
            ? parseAnnotatedMarkdown(args.markdown).map((b) => ({
                ...(b.id ? { id: b.id } : {}),
                ...(b.title ? { title: b.title } : {}),
                type: b.type,
                content: b.content,
              }))
            : []);

        return createDocumentAsAgent(db, {
          agent,
          projectId: args.project_id,
          parentId: args.parent_id ?? null,
          slug,
          title: args.title,
          icon: args.icon,
          blocks: blocks as z.infer<typeof proposalBlockPayloadSchema>[],
          rationale: args.rationale,
          idempotencyKey: args.idempotency_key,
        });
      }),
  );

  // 8. propose_changes
  server.tool(
    'propose_changes',
    'Submit block-level change Proposal (never overwrites humanTouched/locked blocks without UI approval).',
    {
      doc_id: z.string().uuid(),
      base_revision_id: z.string().uuid(),
      title: z.string().min(1).max(200),
      rationale: z.string().max(2000).optional(),
      ops: z.array(proposalOpInputSchema),
      idempotency_key: z.string().max(200).optional(),
    },
    async (args) =>
      runTool(async () =>
        createProposalAsAgent(db, {
          agent,
          docId: args.doc_id,
          baseRevisionId: args.base_revision_id,
          title: args.title,
          rationale: args.rationale,
          ops: args.ops,
          idempotencyKey: args.idempotency_key,
        }),
      ),
  );

  // 9. propose_markdown_update
  server.tool(
    'propose_markdown_update',
    'Submit updated annotated_markdown; server aligns block IDs and builds a protected Proposal.',
    {
      doc_id: z.string().uuid(),
      base_revision_id: z.string().uuid(),
      title: z.string().min(1).max(200),
      rationale: z.string().max(2000).optional(),
      annotated_markdown: z.string(),
      idempotency_key: z.string().max(200).optional(),
    },
    async (args) =>
      runTool(async () =>
        proposeMarkdownUpdateAsAgent(db, {
          agent,
          docId: args.doc_id,
          baseRevisionId: args.base_revision_id,
          title: args.title,
          rationale: args.rationale,
          annotatedMarkdown: args.annotated_markdown,
          idempotencyKey: args.idempotency_key,
        }),
      ),
  );

  // 10. validate_visualization
  server.tool(
    'validate_visualization',
    'Validate Mermaid diagram or Vega-Lite chart spec before submitting a Proposal.',
    {
      type: z.enum(['diagram', 'chart']),
      payload: z.unknown(),
    },
    async ({ type, payload }) =>
      runTool(async () => {
        assertAgentScope(agent, 'docs:read');
        if (type === 'diagram') {
          const parsed = diagramPayloadSchema.parse(payload);
          return validateMermaidDiagram(parsed);
        }
        const parsed = chartPayloadSchema.parse(payload);
        return validateVegaLiteChart(parsed);
      }),
  );

  // 11. list_proposals & get_proposal & update_proposal
  server.tool(
    'list_proposals',
    'List proposals visible to this agent.',
    {
      project_id: z.string().uuid().optional(),
      doc_id: z.string().uuid().optional(),
      status: z.enum(PROPOSAL_STATUSES).optional(),
    },
    async ({ project_id, doc_id, status }) =>
      runTool(async () => {
        const items = await listProposalsForAgent(db, agent, {
          ...(project_id ? { projectId: project_id } : {}),
          ...(doc_id ? { docId: doc_id } : {}),
          ...(status ? { status } : {}),
        });
        return { proposals: items };
      }),
  );

  server.tool(
    'get_proposal',
    'Read proposal status, per-op decisions, and human review comments.',
    { proposal_id: z.string().uuid() },
    async ({ proposal_id }) =>
      runTool(async () => getProposalForAgent(db, agent, proposal_id)),
  );

  server.tool(
    'update_proposal',
    'Update an open pending proposal after reading human review comments.',
    {
      proposal_id: z.string().uuid(),
      base_revision_id: z.string().uuid().optional(),
      ops: z.array(proposalOpInputSchema),
      rationale: z.string().max(2000).optional(),
    },
    async (args) =>
      runTool(async () =>
        updateProposalAsAgent(db, {
          agent,
          proposalId: args.proposal_id,
          baseRevisionId: args.base_revision_id,
          ops: args.ops,
          rationale: args.rationale,
        }),
      ),
  );

  return server;
}

export async function handleMcpHttpRequest(
  db: Database,
  agent: AuthAgent,
  req: Request,
): Promise<Response> {
  const server = createDocalaizerMcpServer(db, agent);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless per-request Streamable HTTP
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close();
    await server.close();
  }
}
