import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { agents, createDb, projects, users } from '@docalaizer/db';
import { createApp } from '../app';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://docalaizer:docalaizer_dev@localhost:5439/docalaizer';

const { db, pool } = createDb(DATABASE_URL);
const createdUserIds: string[] = [];
const createdProjectIds: string[] = [];
const createdAgentIds: string[] = [];

afterAll(async () => {
  try {
    if (createdProjectIds.length > 0) {
      await db.delete(projects).where(inArray(projects.id, createdProjectIds));
    }
    if (createdAgentIds.length > 0) {
      await db.delete(agents).where(inArray(agents.id, createdAgentIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  } finally {
    await pool.end();
  }
});

async function mcpCall(
  app: ReturnType<typeof createApp>,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
) {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    result?: {
      tools?: Array<{ name: string }>;
      isError?: boolean;
      content?: Array<{ type: string; text: string }>;
    };
    error?: unknown;
  };
}

describe('REST API routes + MCP Streamable HTTP integration', () => {
  it('connects REST workspace management with live MCP tools/list and tools/call end-to-end', async () => {
    const suffix = randomUUID().slice(0, 8);
    const app = createApp({ db, allowPublicSignup: true });

    // 1. Register user via REST
    const regRes = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `mcp-${suffix}@example.com`,
        name: 'MCP Owner',
        password: 'password123',
      }),
    });
    expect(regRes.status).toBe(201);
    const { user } = (await regRes.json()) as { user: { id: string } };
    createdUserIds.push(user.id);
    const cookie = regRes.headers.get('set-cookie')!.split(';')[0]!;

    // 2. Create project via REST
    const projRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Platform Docs',
        slug: `platform-${suffix}`,
        defaultApprovalPolicy: 'strict',
      }),
    });
    expect(projRes.status).toBe(201);
    const { project } = (await projRes.json()) as { project: { id: string } };
    createdProjectIds.push(project.id);

    // 3. Create document via REST
    const docRes = await app.request(`/api/v1/projects/${project.id}/docs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        slug: 'getting-started',
        title: 'Getting Started',
        blocks: [
          {
            id: 'blk_intro',
            type: 'markdown',
            content: '## Welcome\nManual onboarding guide for engineers.',
          },
        ],
      }),
    });
    expect(docRes.status).toBe(201);
    const { document: doc, revision: v1 } = (await docRes.json()) as {
      document: { id: string };
      revision: { id: string };
    };

    // 4. Verify tree and full-text search via REST
    const treeRes = await app.request(`/api/v1/projects/${project.id}/tree`, {
      headers: { cookie },
    });
    expect(treeRes.status).toBe(200);
    const treeJson = (await treeRes.json()) as { documents: Array<{ id: string }> };
    expect(treeJson.documents).toHaveLength(1);

    const searchRes = await app.request(`/api/v1/docs/search?q=onboarding&projectId=${project.id}`, {
      headers: { cookie },
    });
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as { results: Array<{ documentId: string }> };
    expect(searchJson.results.some((r) => r.documentId === doc.id)).toBe(true);

    // 5. Issue AI Agent token via REST (with projects:create enabled)
    const agentRes = await app.request('/api/v1/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Cursor MCP',
        scopes: ['projects:read', 'projects:create', 'docs:read', 'docs:create', 'docs:propose'],
        projectScopeMode: 'selected',
        allowedProjectIds: [project.id],
      }),
    });
    expect(agentRes.status).toBe(201);
    const { agent, token } = (await agentRes.json()) as {
      agent: { id: string };
      token: string;
    };
    createdAgentIds.push(agent.id);

    // 6. Stateless MCP rejects GET (standalone SSE) and DELETE with 405 Method Not Allowed
    const getRes = await app.request('/mcp', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'text/event-stream',
      },
    });
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get('allow')).toBe('POST');

    const deleteRes = await app.request('/mcp', {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(deleteRes.status).toBe(405);

    // 7. MCP tools/list
    const listResp = await mcpCall(app, token, 'tools/list');
    const toolNames = (listResp.result?.tools ?? []).map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'list_projects',
        'create_project',
        'get_project_tree',
        'search_docs',
        'get_doc',
        'get_doc_history',
        'create_doc',
        'propose_changes',
        'propose_markdown_update',
        'validate_visualization',
        'list_proposals',
        'get_proposal',
        'update_proposal',
      ]),
    );

    // 7. MCP get_doc(annotated_markdown)
    const getDocResp = await mcpCall(app, token, 'tools/call', {
      name: 'get_doc',
      arguments: { doc_id: doc.id, format: 'annotated_markdown' },
    });
    const docPayload = JSON.parse(getDocResp.result?.content?.[0]?.text ?? '{}') as {
      head_revision_id: string;
      annotated_markdown: string;
    };
    expect(docPayload.head_revision_id).toBe(v1.id);
    expect(docPayload.annotated_markdown).toContain('owner="human"');

    // 8. MCP propose_markdown_update adds a Mermaid diagram while keeping the human block intact
    const updatedMarkdown = `${docPayload.annotated_markdown}\n\n\`\`\`mermaid\nflowchart LR\n  Dev --> Docalaizer\n\`\`\``;
    const proposeResp = await mcpCall(app, token, 'tools/call', {
      name: 'propose_markdown_update',
      arguments: {
        doc_id: doc.id,
        base_revision_id: v1.id,
        title: 'Add onboarding flow diagram',
        annotated_markdown: updatedMarkdown,
      },
    });
    expect(proposeResp.result?.isError).not.toBe(true);
    const proposePayload = JSON.parse(proposeResp.result?.content?.[0]?.text ?? '{}') as {
      status: string;
      proposal_id: string;
      review_url: string;
      proposal: { id: string };
      ops: Array<{ id: string }>;
    };
    expect(proposePayload.status).toBe('pending');
    expect(proposePayload.proposal_id).toBe(proposePayload.proposal.id);
    expect(proposePayload.review_url).toContain(proposePayload.proposal.id);
    expect(proposePayload.ops).toHaveLength(1);

    // 9. Human reviews & approves Proposal via REST Inbox
    const inboxRes = await app.request(`/api/v1/proposals?projectId=${project.id}&status=pending`, {
      headers: { cookie },
    });
    expect(inboxRes.status).toBe(200);
    const inboxJson = (await inboxRes.json()) as {
      proposals: Array<{ proposal: { id: string } }>;
    };
    expect(inboxJson.proposals.some((p) => p.proposal.id === proposePayload.proposal.id)).toBe(
      true,
    );

    const reviewRes = await app.request(
      `/api/v1/proposals/${proposePayload.proposal.id}/review`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          decisions: [{ opId: proposePayload.ops[0]!.id, decision: 'accepted' }],
        }),
      },
    );
    expect(reviewRes.status).toBe(200);
    const reviewJson = (await reviewRes.json()) as {
      proposal: { status: string };
      revision: { revisionNumber: number; blocksSnapshot: Array<{ type: string }> };
    };
    expect(reviewJson.proposal.status).toBe('approved');
    expect(reviewJson.revision.revisionNumber).toBe(2);
    expect(reviewJson.revision.blocksSnapshot.map((b) => b.type)).toEqual(['markdown', 'diagram']);

    // 10. MCP create_project succeeds because agent has `projects:create`
    const createProjResp = await mcpCall(app, token, 'tools/call', {
      name: 'create_project',
      arguments: { name: 'AI Spawned', slug: `ai-spawned-${suffix}` },
    });
    expect(createProjResp.result?.isError).not.toBe(true);
    const createdProjJson = JSON.parse(createProjResp.result?.content?.[0]?.text ?? '{}') as {
      project: { id: string };
    };
    createdProjectIds.push(createdProjJson.project.id);
  });

  it('works end-to-end with the official @modelcontextprotocol/sdk StreamableHTTPClientTransport over live HTTP', async () => {
    const suffix = randomUUID().slice(0, 8);
    const app = createApp({
      db,
      allowPublicSignup: true,
      appBaseUrl: 'https://docs.example.test',
    });

    const server = serve({ fetch: app.fetch, port: 0 });
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `mcp-sdk-${suffix}@example.com`,
          name: 'SDK Owner',
          password: 'password123',
        }),
      });
      expect(regRes.status).toBe(201);
      const { user } = (await regRes.json()) as { user: { id: string } };
      createdUserIds.push(user.id);
      const cookie = regRes.headers.get('set-cookie')!.split(';')[0]!;

      const projRes = await fetch(`${baseUrl}/api/v1/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'SDK Docs',
          slug: `sdk-${suffix}`,
          defaultApprovalPolicy: 'strict',
        }),
      });
      const { project } = (await projRes.json()) as { project: { id: string } };
      createdProjectIds.push(project.id);

      const docRes = await fetch(`${baseUrl}/api/v1/projects/${project.id}/docs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          slug: 'api-guide',
          title: 'API Guide',
          blocks: [{ id: 'blk_1', type: 'markdown', content: 'Initial API guide.' }],
        }),
      });
      const { document: doc, revision: v1 } = (await docRes.json()) as {
        document: { id: string };
        revision: { id: string };
      };

      const agentRes = await fetch(`${baseUrl}/api/v1/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Real MCP Client',
          scopes: ['projects:read', 'docs:read', 'docs:propose'],
          projectScopeMode: 'selected',
          allowedProjectIds: [project.id],
        }),
      });
      const { agent, token } = (await agentRes.json()) as {
        agent: { id: string };
        token: string;
      };
      createdAgentIds.push(agent.id);

      const client = new Client({ name: 'docalaizer-test-client', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: {
          headers: { authorization: `Bearer ${token}` },
        },
      });
      await client.connect(transport);

      try {
        const listed = await client.listTools();
        expect(listed.tools.some((t) => t.name === 'propose_changes')).toBe(true);

        const validated = await client.callTool({
          name: 'validate_visualization',
          arguments: {
            type: 'diagram',
            engine: 'mermaid',
            payload: { engine: 'mermaid', source: 'flowchart LR\n  A --> B' },
          },
        });
        expect(validated.isError).not.toBe(true);
        const valText = (validated.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
        expect(JSON.parse(valText)).toEqual({ valid: true });

        const proposed = await client.callTool({
          name: 'propose_changes',
          arguments: {
            doc_id: doc.id,
            base_revision_id: v1.id,
            title: 'Update API Guide title & add section',
            metadata_changes: { title: 'API Guide v2' },
            ops: [
              {
                opType: 'insert',
                afterBlockId: 'blk_1',
                newBlockPayload: { type: 'markdown', content: 'Added via official MCP SDK client.' },
              },
            ],
          },
        });
        expect(proposed.isError).not.toBe(true);
        const propText = (proposed.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
        const propJson = JSON.parse(propText) as {
          status: string;
          proposal_id: string;
          review_url: string;
          proposal: { id: string; metadataChanges: { title?: string } | null };
        };
        expect(propJson.status).toBe('pending');
        expect(propJson.proposal_id).toBe(propJson.proposal.id);
        expect(propJson.review_url).toContain('https://docs.example.test/');
        expect(propJson.proposal.metadataChanges?.title).toBe('API Guide v2');

        const allProps = await client.callTool({
          name: 'list_proposals',
          arguments: { project_id: project.id, status: 'all' },
        });
        expect(allProps.isError).not.toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
