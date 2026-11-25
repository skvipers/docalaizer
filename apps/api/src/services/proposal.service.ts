import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  type ClassifiedProposalOp,
  CoreMergeError,
  type DocumentBlock,
  type ProposalBlockPayload,
  type ProposalOpInput,
  type ProposalReviewDecision,
  applyProposalReview,
  classifyProposalOps,
  createDocumentBlock,
  diffMarkdownToProposalOps,
  evaluateProposalPolicy,
  generateBlockId,
  validateBlockPayload,
} from '@docalaizer/core';
import {
  type Database,
  type Document,
  type Proposal,
  type ProposalMetadataChanges,
  type ProposalOp,
  type Revision,
  agents,
  documents,
  projectMembers,
  projects,
  proposalOps,
  proposals,
  revisions,
} from '@docalaizer/db';
import { type ConflictState, ERROR_CODES, type ProposalStatus } from '@docalaizer/shared';
import { AppError, isPgUniqueViolation } from '../errors';
import { buildSearchVectorSql } from './document.service';
import {
  type AuthAgent,
  assertAgentProjectAccess,
  assertAgentScope,
  assertProjectRole,
} from './rbac.service';

export interface ProposalConflictSummary {
  total_ops: number;
  clean: number;
  human_protected: number;
  locked: number;
  stale_conflict: number;
  risky_delete: number;
}

export function summarizeClassifiedOps(
  classified: readonly ClassifiedProposalOp[],
): { summary: ProposalConflictSummary; warnings: string[] } {
  const summary: ProposalConflictSummary = {
    total_ops: classified.length,
    clean: 0,
    human_protected: 0,
    locked: 0,
    stale_conflict: 0,
    risky_delete: 0,
  };
  const warnings: string[] = [];

  for (let i = 0; i < classified.length; i++) {
    const item = classified[i]!;
    summary[item.conflictState]++;
    if (item.conflictState !== 'clean') {
      warnings.push(`op[${i}] (${item.conflictState}): ${item.reasons.join(' ')}`);
    }
  }

  return { summary, warnings };
}

function validateProposalOpsVisualizations(ops: readonly ProposalOpInput[]): void {
  const insertedIds = new Set<string>();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.opType === 'insert' && op.newBlockPayload.id) {
      const id = op.newBlockPayload.id;
      if (insertedIds.has(id)) {
        throw new AppError(400, 'DUPLICATE_BLOCK_ID', `Duplicate inserted block ID "${id}".`);
      }
      insertedIds.add(id);
    }
    if (op.opType === 'insert' || op.opType === 'update') {
      const validation = validateBlockPayload(op.newBlockPayload);
      if (!validation.valid) {
        throw new AppError(
          422,
          validation.code,
          `Visualization validation failed in ops[${i}].`,
          validation.details,
        );
      }
    }
  }
}

function dbOpToCoreOp(row: ProposalOp): ProposalOpInput {
  switch (row.opType) {
    case 'insert':
      return {
        opType: 'insert',
        afterBlockId: row.afterBlockId,
        newBlockPayload: row.newBlockPayload as ProposalBlockPayload,
      };
    case 'update':
      return {
        opType: 'update',
        targetBlockId: row.targetBlockId!,
        ...(row.expectedHash ? { expectedHash: row.expectedHash } : {}),
        newBlockPayload: row.newBlockPayload as ProposalBlockPayload,
      };
    case 'delete':
      return {
        opType: 'delete',
        targetBlockId: row.targetBlockId!,
        ...(row.expectedHash ? { expectedHash: row.expectedHash } : {}),
      };
    case 'move':
      return {
        opType: 'move',
        targetBlockId: row.targetBlockId!,
        afterBlockId: row.afterBlockId,
        ...(row.expectedHash ? { expectedHash: row.expectedHash } : {}),
      };
  }
}

export async function createDocumentAsAgent(
  db: Database,
  params: {
    agent: AuthAgent;
    projectId: string;
    parentId?: string | null;
    slug: string;
    title: string;
    icon?: string;
    blocks: ProposalBlockPayload[];
    rationale?: string;
    idempotencyKey?: string;
  },
): Promise<
  | { status: 'applied'; document: Document; revision: Revision }
  | {
      status: 'pending';
      document: Document;
      proposal: Proposal;
      summary: ProposalConflictSummary;
    }
> {
  assertAgentScope(params.agent, 'docs:create');
  await assertAgentProjectAccess(db, params.agent, params.projectId, ['owner', 'editor']);

  for (let i = 0; i < params.blocks.length; i++) {
    const validation = validateBlockPayload(params.blocks[i]!);
    if (!validation.valid) {
      throw new AppError(
        422,
        validation.code,
        `Visualization validation failed in blocks[${i}].`,
        validation.details,
      );
    }
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);

  if (!project) {
    throw new AppError(404, 'NOT_FOUND', 'Project not found.');
  }

  if (params.parentId) {
    const [parentDoc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, params.parentId), eq(documents.projectId, params.projectId)))
      .limit(1);
    if (!parentDoc) {
      throw new AppError(404, 'NOT_FOUND', 'Parent document not found in this project.');
    }
  }

  const normalizedBlocks: ProposalBlockPayload[] = params.blocks.map((payload) => ({
    ...payload,
    id: payload.id ?? generateBlockId(),
  }));

  const ops: ProposalOpInput[] = normalizedBlocks.map((payload, idx) => ({
    opType: 'insert',
    afterBlockId: idx === 0 ? null : (normalizedBlocks[idx - 1]?.id ?? null),
    newBlockPayload: payload,
  }));
  validateProposalOpsVisualizations(ops);

  const classified = classifyProposalOps(ops, [], []);
  const policyEval = evaluateProposalPolicy({
    policy: project.defaultApprovalPolicy,
    isNewDocument: true,
    hasMetadataChanges: false,
    classifiedOps: classified,
  });

  try {
    if (policyEval.shouldAutoApply) {
      const now = new Date().toISOString();
      const blocks: DocumentBlock[] = normalizedBlocks.map((payload) =>
        createDocumentBlock({
          payload,
          authorType: 'ai',
          authorId: params.agent.id,
          now,
          humanTouched: false,
          lockedByHuman: false,
        }),
      );

      const created = await db.transaction(async (tx) => {
        const [doc] = await tx
          .insert(documents)
          .values({
            projectId: params.projectId,
            parentId: params.parentId ?? null,
            slug: params.slug.trim().toLowerCase(),
            title: params.title.trim(),
            icon: params.icon,
            isDraft: false,
          })
          .returning();

        if (!doc) {
          throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create document.');
        }

        const [rev] = await tx
          .insert(revisions)
          .values({
            documentId: doc.id,
            parentRevisionId: null,
            revisionNumber: 1,
            authorType: 'ai',
            authorAgentId: params.agent.id,
            summary: params.rationale ?? 'Initial AI document',
            blocksSnapshot: blocks,
            searchVector: buildSearchVectorSql(doc.title, blocks),
          })
          .returning();

        if (!rev) {
          throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create revision.');
        }

        const [updatedDoc] = await tx
          .update(documents)
          .set({ headRevisionId: rev.id, updatedAt: new Date() })
          .where(eq(documents.id, doc.id))
          .returning();

        return { document: updatedDoc ?? doc, revision: rev };
      });

      return { status: 'applied', ...created };
    }

    // Strict policy: create draft document + pending publication proposal
    const created = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          projectId: params.projectId,
          parentId: params.parentId ?? null,
          slug: params.slug.trim().toLowerCase(),
          title: params.title.trim(),
          icon: params.icon,
          isDraft: true,
        })
        .returning();

      if (!doc) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create draft document.');
      }

      const [proposal] = await tx
        .insert(proposals)
        .values({
          projectId: params.projectId,
          documentId: doc.id,
          baseRevisionId: null,
          agentId: params.agent.id,
          idempotencyKey: params.idempotencyKey ?? null,
          title: `Create page: ${doc.title}`,
          rationale: params.rationale ?? null,
          status: 'pending',
        })
        .returning();

      if (!proposal) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create proposal.');
      }

      if (ops.length > 0) {
        await tx.insert(proposalOps).values(
          ops.map((op, idx) => ({
            proposalId: proposal.id,
            opOrder: idx,
            opType: op.opType,
            targetBlockId: null,
            afterBlockId: op.opType === 'insert' ? op.afterBlockId : null,
            expectedHash: null,
            newBlockPayload: op.opType === 'insert' ? op.newBlockPayload : null,
            conflictState: 'clean' as ConflictState,
            decision: 'pending' as const,
          })),
        );
      }

      return { document: doc, proposal };
    });

    const { summary } = summarizeClassifiedOps(classified);
    return { status: 'pending', ...created, summary };
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError(
        409,
        'SLUG_ALREADY_EXISTS',
        `Document slug "${params.slug}" already exists in this project.`,
      );
    }
    throw err;
  }
}

export async function createProposalAsAgent(
  db: Database,
  params: {
    agent: AuthAgent;
    docId: string;
    baseRevisionId: string;
    title: string;
    rationale?: string;
    ops: ProposalOpInput[];
    metadataChanges?: ProposalMetadataChanges;
    idempotencyKey?: string;
  },
): Promise<
  | { status: 'applied'; revision: Revision; summary: ProposalConflictSummary }
  | {
      status: 'pending';
      proposal: Proposal;
      ops: ProposalOp[];
      summary: ProposalConflictSummary;
      warnings: string[];
      idempotentReplay: boolean;
    }
> {
  assertAgentScope(params.agent, 'docs:propose');

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, params.docId))
    .limit(1);

  if (!doc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  await assertAgentProjectAccess(db, params.agent, doc.projectId, ['owner', 'editor']);

  // Idempotency check before creating anything
  if (params.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.agentId, params.agent.id),
          eq(proposals.documentId, doc.id),
          eq(proposals.idempotencyKey, params.idempotencyKey),
        ),
      )
      .limit(1);

    if (existing) {
      const existingOps = await db
        .select()
        .from(proposalOps)
        .where(eq(proposalOps.proposalId, existing.id))
        .orderBy(asc(proposalOps.opOrder));

      const summary: ProposalConflictSummary = {
        total_ops: existingOps.length,
        clean: 0,
        human_protected: 0,
        locked: 0,
        stale_conflict: 0,
        risky_delete: 0,
      };
      for (const row of existingOps) {
        summary[row.conflictState]++;
      }
      const [appliedRevision] = await db
        .select()
        .from(revisions)
        .where(eq(revisions.proposalId, existing.id))
        .limit(1);
      if (appliedRevision) {
        return { status: 'applied', revision: appliedRevision, summary };
      }
      return {
        status: 'pending',
        proposal: existing,
        ops: existingOps,
        summary,
        warnings: [],
        idempotentReplay: true,
      };
    }
  }

  // Server-side validation of all Mermaid / Vega-Lite payloads BEFORE creating Proposal
  validateProposalOpsVisualizations(params.ops);

  if (params.metadataChanges?.parentId) {
    if (params.metadataChanges.parentId === doc.id) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A document cannot be its own parent.');
    }
    const [parentDoc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, params.metadataChanges.parentId),
          eq(documents.projectId, doc.projectId),
        ),
      )
      .limit(1);
    if (!parentDoc) {
      throw new AppError(404, 'NOT_FOUND', 'Target parent document not found in this project.');
    }
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, doc.projectId))
    .limit(1);

  if (!project) {
    throw new AppError(404, 'NOT_FOUND', 'Project not found.');
  }

  const [baseRev] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, params.baseRevisionId), eq(revisions.documentId, doc.id)))
    .limit(1);

  if (!baseRev) {
    throw new AppError(
      404,
      ERROR_CODES.BASE_REVISION_NOT_FOUND,
      `Base revision "${params.baseRevisionId}" not found for document "${doc.id}".`,
    );
  }

  const headRev = doc.headRevisionId
    ? (
        await db
          .select()
          .from(revisions)
          .where(eq(revisions.id, doc.headRevisionId))
          .limit(1)
      )[0] ?? null
    : null;

  const headBlocks = headRev?.blocksSnapshot ?? [];
  const classified = classifyProposalOps(params.ops, baseRev.blocksSnapshot, headBlocks);
  const { summary, warnings } = summarizeClassifiedOps(classified);

  const effectivePolicy = doc.approvalPolicyOverride ?? project.defaultApprovalPolicy;
  const hasMetadataChanges =
    params.metadataChanges !== undefined && Object.keys(params.metadataChanges).length > 0;

  const policyEval = evaluateProposalPolicy({
    policy: effectivePolicy,
    isNewDocument: false,
    hasMetadataChanges,
    classifiedOps: classified,
  });

  // Auto-apply ONLY when policy permits AND every single op is clean (zero humanTouched/locked)
  if (policyEval.shouldAutoApply && headRev) {
    let applied: Revision;
    try {
      applied = await db.transaction(async (tx) => {
      const [currentDoc] = await tx
        .select()
        .from(documents)
        .where(eq(documents.id, doc.id))
        .limit(1);

      if (!currentDoc || currentDoc.headRevisionId !== headRev.id) {
        throw new AppError(
          409,
          ERROR_CODES.HEAD_REVISION_CONFLICT,
          'Document changed while evaluating auto-apply policy; please re-read and retry.',
        );
      }

      const mergeResult = applyProposalReview({
        baseBlocks: baseRev.blocksSnapshot,
        headBlocks: headRev.blocksSnapshot,
        ops: params.ops,
        decisions: params.ops.map(() => ({ decision: 'accepted' })),
        reviewerUserId: params.agent.ownerUserId,
        agentId: params.agent.id,
      });

      const [autoProposal] = await tx
        .insert(proposals)
        .values({
          projectId: doc.projectId,
          documentId: doc.id,
          baseRevisionId: baseRev.id,
          agentId: params.agent.id,
          idempotencyKey: params.idempotencyKey ?? null,
          title: params.title.trim(),
          rationale: params.rationale ?? null,
          status: 'approved',
          reviewedAt: new Date(),
        })
        .returning();
      if (!autoProposal) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to record auto-applied proposal.');
      }
      if (classified.length > 0) {
        await tx.insert(proposalOps).values(
          classified.map((item, idx) => ({
            proposalId: autoProposal.id,
            opOrder: idx,
            opType: item.op.opType,
            targetBlockId: item.op.opType === 'insert' ? null : item.op.targetBlockId,
            afterBlockId:
              item.op.opType === 'insert' || item.op.opType === 'move'
                ? item.op.afterBlockId
                : null,
            expectedHash: item.op.opType === 'insert' ? null : (item.op.expectedHash ?? null),
            newBlockPayload:
              item.op.opType === 'insert' || item.op.opType === 'update'
                ? item.op.newBlockPayload
                : null,
            conflictState: item.conflictState,
            decision: 'accepted' as const,
          })),
        );
      }

      const [nextRev] = await tx
        .insert(revisions)
        .values({
          documentId: doc.id,
          parentRevisionId: headRev.id,
          revisionNumber: headRev.revisionNumber + 1,
          authorType: 'ai',
          authorAgentId: params.agent.id,
          proposalId: autoProposal.id,
          summary: params.title,
          blocksSnapshot: mergeResult.nextBlocks,
          searchVector: buildSearchVectorSql(currentDoc.title, mergeResult.nextBlocks),
        })
        .returning();

      if (!nextRev) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create auto-applied revision.');
      }

      const [updatedDoc] = await tx
        .update(documents)
        .set({ headRevisionId: nextRev.id, updatedAt: new Date() })
        .where(and(eq(documents.id, doc.id), eq(documents.headRevisionId, headRev.id)))
        .returning();

      if (!updatedDoc) {
        throw new AppError(
          409,
          ERROR_CODES.HEAD_REVISION_CONFLICT,
          'Document head changed concurrently during auto-apply.',
        );
      }

      return nextRev;
      });
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        if (params.idempotencyKey) {
          const [existing] = await db
            .select()
            .from(proposals)
            .where(
              and(
                eq(proposals.agentId, params.agent.id),
                eq(proposals.documentId, doc.id),
                eq(proposals.idempotencyKey, params.idempotencyKey),
              ),
            )
            .limit(1);
          const [existingRevision] = existing
            ? await db.select().from(revisions).where(eq(revisions.proposalId, existing.id)).limit(1)
            : [];
          if (existingRevision) {
            return { status: 'applied', revision: existingRevision, summary };
          }
        }
        throw new AppError(
          409,
          ERROR_CODES.HEAD_REVISION_CONFLICT,
          'Document head changed concurrently during auto-apply; please retry.',
        );
      }
      throw err;
    }

    return { status: 'applied', revision: applied, summary };
  }

  // Standard path: persist pending Proposal + ProposalOps for Review Inbox
  try {
    const persisted = await db.transaction(async (tx) => {
      const [proposal] = await tx
        .insert(proposals)
        .values({
          projectId: doc.projectId,
          documentId: doc.id,
          baseRevisionId: baseRev.id,
          agentId: params.agent.id,
          idempotencyKey: params.idempotencyKey ?? null,
          title: params.title.trim(),
          rationale: params.rationale ?? null,
          metadataChanges: hasMetadataChanges ? params.metadataChanges! : null,
          status: 'pending',
        })
        .returning();

      if (!proposal) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create proposal.');
      }

      const insertedOps =
        classified.length > 0
          ? await tx
              .insert(proposalOps)
              .values(
                classified.map((item, idx) => ({
                  proposalId: proposal.id,
                  opOrder: idx,
                  opType: item.op.opType,
                  targetBlockId: item.op.opType === 'insert' ? null : item.op.targetBlockId,
                  afterBlockId:
                    item.op.opType === 'insert' || item.op.opType === 'move'
                      ? item.op.afterBlockId
                      : null,
                  expectedHash:
                    item.op.opType === 'insert' ? null : (item.op.expectedHash ?? null),
                  newBlockPayload:
                    item.op.opType === 'insert' || item.op.opType === 'update'
                      ? item.op.newBlockPayload
                      : null,
                  conflictState: item.conflictState,
                  decision: 'pending' as const,
                })),
              )
              .returning()
          : [];

      return { proposal, ops: insertedOps };
    });

    return {
      status: 'pending',
      ...persisted,
      summary,
      warnings,
      idempotentReplay: false,
    };
  } catch (err) {
    if (params.idempotencyKey && isPgUniqueViolation(err)) {
      // Concurrent replay won the unique index race — fetch and return the stored proposal
      const [existing] = await db
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.agentId, params.agent.id),
            eq(proposals.documentId, doc.id),
            eq(proposals.idempotencyKey, params.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        const existingOps = await db
          .select()
          .from(proposalOps)
          .where(eq(proposalOps.proposalId, existing.id))
          .orderBy(asc(proposalOps.opOrder));

        return {
          status: 'pending',
          proposal: existing,
          ops: existingOps,
          summary,
          warnings,
          idempotentReplay: true,
        };
      }
    }
    throw err;
  }
}

export async function getProposalWithLiveDiff(
  db: Database,
  params: { userId: string; proposalId: string },
): Promise<{
  proposal: Proposal;
  document: Document;
  userRole: 'owner' | 'editor' | 'reviewer' | 'viewer';
  ops: Array<{
    row: ProposalOp;
    liveConflictState: ConflictState;
    defaultDecision: 'accepted' | 'rejected';
    canApply: boolean;
    reasons: string[];
    baseBlock: DocumentBlock | null;
    headBlock: DocumentBlock | null;
  }>;
  summary: ProposalConflictSummary;
}> {
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, params.proposalId))
    .limit(1);

  if (!proposal) {
    throw new AppError(404, 'NOT_FOUND', 'Proposal not found.');
  }

  const userRole = await assertProjectRole(db, params.userId, proposal.projectId, [
    'owner',
    'editor',
    'reviewer',
    'viewer',
  ]);

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, proposal.documentId))
    .limit(1);

  if (!doc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  const opRows = await db
    .select()
    .from(proposalOps)
    .where(eq(proposalOps.proposalId, proposal.id))
    .orderBy(asc(proposalOps.opOrder));

  const baseRev = proposal.baseRevisionId
    ? (
        await db
          .select()
          .from(revisions)
          .where(eq(revisions.id, proposal.baseRevisionId))
          .limit(1)
      )[0] ?? null
    : null;

  const headRev = doc.headRevisionId
    ? (
        await db
          .select()
          .from(revisions)
          .where(eq(revisions.id, doc.headRevisionId))
          .limit(1)
      )[0] ?? null
    : null;

  const coreOps = opRows.map(dbOpToCoreOp);
  const classified = classifyProposalOps(
    coreOps,
    baseRev?.blocksSnapshot ?? [],
    headRev?.blocksSnapshot ?? [],
  );
  const { summary } = summarizeClassifiedOps(classified);

  return {
    proposal,
    document: doc,
    userRole,
    ops: opRows.map((row, idx) => {
      const c = classified[idx]!;
      return {
        row,
        liveConflictState: c.conflictState,
        defaultDecision: c.defaultDecision,
        canApply: c.canApply,
        reasons: c.reasons,
        baseBlock: c.baseBlock,
        headBlock: c.headBlock,
      };
    }),
    summary,
  };
}

export interface ReviewDecisionInput extends ProposalReviewDecision {
  opId: string;
}

export async function reviewProposal(
  db: Database,
  params: {
    reviewerUserId: string;
    proposalId: string;
    decisions: ReviewDecisionInput[];
    acceptMetadataChanges?: boolean;
  },
): Promise<{
  proposal: Proposal;
  revision: Revision | null;
  appliedCount: number;
  rejectedCount: number;
}> {
  const [initialProposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, params.proposalId))
    .limit(1);

  if (!initialProposal) {
    throw new AppError(404, 'NOT_FOUND', 'Proposal not found.');
  }

  await assertProjectRole(db, params.reviewerUserId, initialProposal.projectId, [
    'owner',
    'editor',
    'reviewer',
  ]);

  try {
    return await db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(eq(proposals.id, params.proposalId))
      .limit(1);

    if (!proposal) {
      throw new AppError(404, 'NOT_FOUND', 'Proposal not found.');
    }

    if (proposal.status !== 'pending') {
      throw new AppError(
        409,
        'PROPOSAL_ALREADY_REVIEWED',
        `Proposal has already been processed (status: ${proposal.status}).`,
      );
    }

    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, proposal.documentId))
      .limit(1);

    if (!doc) {
      throw new AppError(404, 'NOT_FOUND', 'Document not found.');
    }

    const opRows = await tx
      .select()
      .from(proposalOps)
      .where(eq(proposalOps.proposalId, proposal.id))
      .orderBy(asc(proposalOps.opOrder));

    const decisionByOpId = new Map(params.decisions.map((d) => [d.opId, d]));
    const orderedDecisions: ProposalReviewDecision[] = opRows.map((row) => {
      const found = decisionByOpId.get(row.id);
      if (!found) {
        throw new AppError(
          400,
          'MISSING_OP_DECISION',
          `Review decision is required for operation "${row.id}".`,
        );
      }
      return found;
    });

    const baseRev = proposal.baseRevisionId
      ? (
          await tx
            .select()
            .from(revisions)
            .where(eq(revisions.id, proposal.baseRevisionId))
            .limit(1)
        )[0] ?? null
      : null;

    const headRev = doc.headRevisionId
      ? (
          await tx
            .select()
            .from(revisions)
            .where(eq(revisions.id, doc.headRevisionId))
            .limit(1)
        )[0] ?? null
      : null;

    let mergeResult;
    try {
      mergeResult = applyProposalReview({
        baseBlocks: baseRev?.blocksSnapshot ?? [],
        headBlocks: headRev?.blocksSnapshot ?? [],
        ops: opRows.map(dbOpToCoreOp),
        decisions: orderedDecisions,
        reviewerUserId: params.reviewerUserId,
        agentId: proposal.agentId,
      });
    } catch (err) {
      if (err instanceof CoreMergeError) {
        const status =
          err.code === ERROR_CODES.CHART_VALIDATION_ERROR
            ? 422
            : err.code === ERROR_CODES.HEAD_REVISION_CONFLICT ||
                err.code === ERROR_CODES.BLOCK_LOCKED_WARNING
              ? 409
              : 400;
        throw new AppError(status, err.code, err.message, err.details);
      }
      throw err;
    }

    // Persist per-operation review decisions and live conflict states
    for (let i = 0; i < opRows.length; i++) {
      const row = opRows[i]!;
      const decision = orderedDecisions[i]!;
      const classified = mergeResult.classifiedOps[i]!;
      await tx
        .update(proposalOps)
        .set({
          conflictState: classified.conflictState,
          decision: decision.decision,
          humanEditedPayload: decision.humanEditedPayload ?? null,
          reviewComment: decision.reviewComment ?? null,
        })
        .where(eq(proposalOps.id, row.id));
    }

    const applyMetadata =
      proposal.metadataChanges !== null && (params.acceptMetadataChanges ?? mergeResult.hasChanges);

    let createdRevision: Revision | null = null;
    if (mergeResult.hasChanges || applyMetadata) {
      const nextTitle =
        applyMetadata && proposal.metadataChanges?.title
          ? proposal.metadataChanges.title.trim()
          : doc.title;
      const nextSlug =
        applyMetadata && proposal.metadataChanges?.slug
          ? proposal.metadataChanges.slug.trim().toLowerCase()
          : doc.slug;
      const nextParentId =
        applyMetadata && proposal.metadataChanges?.parentId !== undefined
          ? proposal.metadataChanges.parentId
          : doc.parentId;
      const nextIcon =
        applyMetadata && proposal.metadataChanges?.icon !== undefined
          ? proposal.metadataChanges.icon
          : doc.icon;

      const [nextRev] = await tx
        .insert(revisions)
        .values({
          documentId: doc.id,
          parentRevisionId: headRev?.id ?? null,
          revisionNumber: (headRev?.revisionNumber ?? 0) + 1,
          authorType: 'merge',
          authorUserId: params.reviewerUserId,
          authorAgentId: proposal.agentId,
          proposalId: proposal.id,
          summary: `Approved proposal: ${proposal.title}`,
          blocksSnapshot: mergeResult.nextBlocks,
          searchVector: buildSearchVectorSql(nextTitle, mergeResult.nextBlocks),
        })
        .returning();

      if (!nextRev) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create merged revision.');
      }
      createdRevision = nextRev;

      // Optimistic concurrency lock on documents.head_revision_id (handles NULL for draft docs too)
      const expectedHeadId = doc.headRevisionId;
      const [updatedDoc] = await tx
        .update(documents)
        .set({
          headRevisionId: nextRev.id,
          title: nextTitle,
          slug: nextSlug,
          parentId: nextParentId,
          icon: nextIcon,
          isDraft: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documents.id, doc.id),
            expectedHeadId === null
              ? sql`${documents.headRevisionId} IS NULL`
              : eq(documents.headRevisionId, expectedHeadId),
          ),
        )
        .returning({ id: documents.id });

      if (!updatedDoc) {
        throw new AppError(
          409,
          ERROR_CODES.HEAD_REVISION_CONFLICT,
          'Document head changed concurrently during proposal review; transaction rolled back.',
        );
      }
    }

    const now = new Date();
    const [updatedProposal] = await tx
      .update(proposals)
      .set({
        status: mergeResult.proposalStatus,
        reviewedByUserId: params.reviewerUserId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(and(eq(proposals.id, proposal.id), eq(proposals.status, 'pending')))
      .returning();

    if (!updatedProposal) {
      throw new AppError(
        409,
        'PROPOSAL_ALREADY_REVIEWED',
        'Proposal was reviewed concurrently by another user.',
      );
    }

    return {
      proposal: updatedProposal,
      revision: createdRevision,
      appliedCount: mergeResult.appliedCount,
      rejectedCount: mergeResult.rejectedCount,
    };
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError(
        409,
        ERROR_CODES.HEAD_REVISION_CONFLICT,
        'Document head changed concurrently during proposal review; please retry.',
      );
    }
    throw err;
  }
}

export async function listProposalsForUser(
  db: Database,
  userId: string,
  filters: { projectId?: string; docId?: string; status?: ProposalStatus } = {},
) {
  const memberships = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));

  let projectIds = memberships.map((m) => m.projectId);
  if (filters.projectId) {
    if (!projectIds.includes(filters.projectId)) {
      throw new AppError(403, ERROR_CODES.PROJECT_ACCESS_DENIED, 'Access denied to project.');
    }
    projectIds = [filters.projectId];
  }

  if (projectIds.length === 0) return [];

  const conditions = [inArray(proposals.projectId, projectIds)];
  if (filters.docId) conditions.push(eq(proposals.documentId, filters.docId));
  if (filters.status) conditions.push(eq(proposals.status, filters.status));

  const rows = await db
    .select({
      proposal: proposals,
      documentTitle: documents.title,
      documentSlug: documents.slug,
      projectName: projects.name,
      projectSlug: projects.slug,
      agentName: agents.name,
    })
    .from(proposals)
    .innerJoin(documents, eq(proposals.documentId, documents.id))
    .innerJoin(projects, eq(proposals.projectId, projects.id))
    .innerJoin(agents, eq(proposals.agentId, agents.id))
    .where(and(...conditions))
    .orderBy(desc(proposals.createdAt))
    .limit(100);

  return rows;
}

export async function listProposalsForAgent(
  db: Database,
  agent: AuthAgent,
  filters: { projectId?: string; docId?: string; status?: ProposalStatus } = {},
) {
  assertAgentScope(agent, 'docs:read');

  const ownerMemberships = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, agent.ownerUserId));

  let projectIds = ownerMemberships.map((m) => m.projectId);
  if (agent.projectScopeMode === 'selected') {
    const allowed = new Set(agent.allowedProjectIds);
    projectIds = projectIds.filter((id) => allowed.has(id));
  }

  if (filters.projectId) {
    if (!projectIds.includes(filters.projectId)) {
      throw new AppError(403, ERROR_CODES.PROJECT_ACCESS_DENIED, 'Agent cannot access this project.');
    }
    projectIds = [filters.projectId];
  }

  if (projectIds.length === 0) return [];

  const conditions = [inArray(proposals.projectId, projectIds)];
  if (filters.docId) conditions.push(eq(proposals.documentId, filters.docId));
  if (filters.status) conditions.push(eq(proposals.status, filters.status));

  return db
    .select()
    .from(proposals)
    .where(and(...conditions))
    .orderBy(desc(proposals.createdAt))
    .limit(50);
}

export async function getProposalForAgent(
  db: Database,
  agent: AuthAgent,
  proposalId: string,
): Promise<{ proposal: Proposal; ops: ProposalOp[] }> {
  assertAgentScope(agent, 'docs:read');

  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);

  if (!proposal) {
    throw new AppError(404, 'NOT_FOUND', 'Proposal not found.');
  }

  await assertAgentProjectAccess(db, agent, proposal.projectId, [
    'owner',
    'editor',
    'reviewer',
    'viewer',
  ]);

  const ops = await db
    .select()
    .from(proposalOps)
    .where(eq(proposalOps.proposalId, proposal.id))
    .orderBy(asc(proposalOps.opOrder));

  return { proposal, ops };
}

export async function updateProposalAsAgent(
  db: Database,
  params: {
    agent: AuthAgent;
    proposalId: string;
    baseRevisionId?: string;
    ops: ProposalOpInput[];
    rationale?: string;
  },
): Promise<{
  proposal: Proposal;
  ops: ProposalOp[];
  summary: ProposalConflictSummary;
  warnings: string[];
}> {
  assertAgentScope(params.agent, 'docs:propose');
  validateProposalOpsVisualizations(params.ops);

  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, params.proposalId))
    .limit(1);

  if (!proposal) {
    throw new AppError(404, 'NOT_FOUND', 'Proposal not found.');
  }

  if (proposal.agentId !== params.agent.id) {
    throw new AppError(403, 'FORBIDDEN', 'Only the authoring agent can update this proposal.');
  }

  if (proposal.status !== 'pending') {
    throw new AppError(409, 'PROPOSAL_ALREADY_REVIEWED', 'Only pending proposals can be updated.');
  }

  await assertAgentProjectAccess(db, params.agent, proposal.projectId, ['owner', 'editor']);

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, proposal.documentId))
    .limit(1);

  if (!doc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  const nextBaseId = params.baseRevisionId ?? proposal.baseRevisionId;
  const baseRev = nextBaseId
    ? (
        await db
          .select()
          .from(revisions)
          .where(and(eq(revisions.id, nextBaseId), eq(revisions.documentId, doc.id)))
          .limit(1)
      )[0] ?? null
    : null;

  if (nextBaseId && !baseRev) {
    throw new AppError(404, ERROR_CODES.BASE_REVISION_NOT_FOUND, 'Base revision not found.');
  }

  const headRev = doc.headRevisionId
    ? (
        await db
          .select()
          .from(revisions)
          .where(eq(revisions.id, doc.headRevisionId))
          .limit(1)
      )[0] ?? null
    : null;

  const classified = classifyProposalOps(
    params.ops,
    baseRev?.blocksSnapshot ?? [],
    headRev?.blocksSnapshot ?? [],
  );
  const { summary, warnings } = summarizeClassifiedOps(classified);

  const updated = await db.transaction(async (tx) => {
    const [updatedProposal] = await tx
      .update(proposals)
      .set({
        baseRevisionId: nextBaseId ?? null,
        ...(params.rationale !== undefined ? { rationale: params.rationale } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(proposals.id, proposal.id), eq(proposals.status, 'pending')))
      .returning();

    if (!updatedProposal) {
      throw new AppError(409, 'PROPOSAL_ALREADY_REVIEWED', 'Proposal is no longer pending.');
    }

    await tx.delete(proposalOps).where(eq(proposalOps.proposalId, proposal.id));

    const insertedOps =
      classified.length > 0
        ? await tx
            .insert(proposalOps)
            .values(
              classified.map((item, idx) => ({
                proposalId: proposal.id,
                opOrder: idx,
                opType: item.op.opType,
                targetBlockId: item.op.opType === 'insert' ? null : item.op.targetBlockId,
                afterBlockId:
                  item.op.opType === 'insert' || item.op.opType === 'move'
                    ? item.op.afterBlockId
                    : null,
                expectedHash:
                  item.op.opType === 'insert' ? null : (item.op.expectedHash ?? null),
                newBlockPayload:
                  item.op.opType === 'insert' || item.op.opType === 'update'
                    ? item.op.newBlockPayload
                    : null,
                conflictState: item.conflictState,
                decision: 'pending' as const,
              })),
            )
            .returning()
        : [];

    return { proposal: updatedProposal, ops: insertedOps };
  });

  return { ...updated, summary, warnings };
}

export async function proposeMarkdownUpdateAsAgent(
  db: Database,
  params: {
    agent: AuthAgent;
    docId: string;
    baseRevisionId: string;
    title: string;
    rationale?: string;
    annotatedMarkdown: string;
    idempotencyKey?: string;
  },
) {
  assertAgentScope(params.agent, 'docs:propose');

  const [baseRev] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, params.baseRevisionId), eq(revisions.documentId, params.docId)))
    .limit(1);

  if (!baseRev) {
    throw new AppError(
      404,
      ERROR_CODES.BASE_REVISION_NOT_FOUND,
      `Base revision "${params.baseRevisionId}" not found for document "${params.docId}".`,
    );
  }

  const ops = diffMarkdownToProposalOps(baseRev.blocksSnapshot, params.annotatedMarkdown);
  return createProposalAsAgent(db, {
    agent: params.agent,
    docId: params.docId,
    baseRevisionId: params.baseRevisionId,
    title: params.title,
    rationale: params.rationale,
    ops,
    idempotencyKey: params.idempotencyKey,
  });
}
