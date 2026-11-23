import {
  type ApprovalPolicy,
  type ConflictState,
  ERROR_CODES,
  type OperationDecision,
  type ProposalStatus,
} from '@docalaizer/shared';
import {
  type DocumentBlock,
  type ProposalBlockPayload,
  type ProposalOpInput,
  createDocumentBlock,
} from './blocks';
import { computeBlockContentHash } from './hash';
import { type ValidationIssue, validateBlockPayload } from './validators';

export const RISKY_DELETE_SHRINK_RATIO = 0.7;
export const RISKY_DELETE_MIN_BASE_CHARS = 40;

export class CoreMergeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'CoreMergeError';
  }
}

export interface ClassifiedProposalOp {
  op: ProposalOpInput;
  conflictState: ConflictState;
  defaultDecision: Extract<OperationDecision, 'accepted' | 'rejected'>;
  canApply: boolean;
  reasons: string[];
  baseBlock: DocumentBlock | null;
  headBlock: DocumentBlock | null;
}

export interface ProposalReviewDecision {
  decision: Extract<OperationDecision, 'accepted' | 'rejected' | 'edited'>;
  humanEditedPayload?: ProposalBlockPayload;
  reviewComment?: string;
  forceResolveStale?: boolean;
}

export interface ApplyProposalReviewResult {
  nextBlocks: DocumentBlock[];
  proposalStatus: Extract<ProposalStatus, 'approved' | 'partially_approved' | 'rejected'>;
  appliedCount: number;
  rejectedCount: number;
  hasChanges: boolean;
  classifiedOps: ClassifiedProposalOp[];
}

export interface PolicyEvaluationResult {
  shouldAutoApply: boolean;
  reason: string;
}

function isRiskyTextShrink(headBlock: DocumentBlock, nextPayload: ProposalBlockPayload): boolean {
  if (headBlock.type !== 'markdown' || nextPayload.type !== 'markdown') {
    return false;
  }
  const beforeLen = headBlock.content.trim().length;
  if (beforeLen < RISKY_DELETE_MIN_BASE_CHARS) {
    return false;
  }
  const afterLen = nextPayload.content.trim().length;
  const shrinkRatio = (beforeLen - afterLen) / beforeLen;
  return shrinkRatio > RISKY_DELETE_SHRINK_RATIO;
}

/**
 * Classifies a single proposal operation against baseBlocks and current headBlocks.
 * Priority: locked > risky_delete > stale_conflict > human_protected > clean.
 */
export function classifyOperationConflict(
  op: ProposalOpInput,
  baseBlocks: readonly DocumentBlock[],
  headBlocks: readonly DocumentBlock[],
  pendingInsertedIds: ReadonlySet<string> = new Set(),
): ClassifiedProposalOp {
  const baseById = new Map(baseBlocks.map((b) => [b.id, b]));
  const headById = new Map(headBlocks.map((b) => [b.id, b]));

  if (op.opType === 'insert') {
    if (
      op.afterBlockId !== null &&
      !headById.has(op.afterBlockId) &&
      !pendingInsertedIds.has(op.afterBlockId)
    ) {
      return {
        op,
        conflictState: 'stale_conflict',
        defaultDecision: 'rejected',
        canApply: true,
        reasons: [`Anchor block "${op.afterBlockId}" no longer exists in current head revision.`],
        baseBlock: baseById.get(op.afterBlockId) ?? null,
        headBlock: null,
      };
    }
    return {
      op,
      conflictState: 'clean',
      defaultDecision: 'accepted',
      canApply: true,
      reasons: [],
      baseBlock: null,
      headBlock: null,
    };
  }

  const baseBlock = baseById.get(op.targetBlockId) ?? null;
  const headBlock = headById.get(op.targetBlockId) ?? null;

  if (!headBlock) {
    return {
      op,
      conflictState: 'stale_conflict',
      defaultDecision: 'rejected',
      canApply: false,
      reasons: [`Target block "${op.targetBlockId}" was deleted in a newer revision.`],
      baseBlock,
      headBlock: null,
    };
  }

  const expectedHash = op.expectedHash ?? baseBlock?.contentHash;
  const isStale = expectedHash !== undefined && expectedHash !== headBlock.contentHash;
  const isMoveAnchorMissing =
    op.opType === 'move' && op.afterBlockId !== null && !headById.has(op.afterBlockId);

  const reasons: string[] = [];

  if (headBlock.meta.lockedByHuman) {
    reasons.push('Block is explicitly locked by a human user (lockedByHuman = true).');
    return {
      op,
      conflictState: 'locked',
      defaultDecision: 'rejected',
      canApply: false,
      reasons,
      baseBlock,
      headBlock,
    };
  }

  if (op.opType === 'delete' && headBlock.meta.humanTouched) {
    reasons.push('AI is attempting to delete a human-edited block.');
    if (isStale) {
      reasons.push('Block was also modified since the AI base revision.');
    }
    return {
      op,
      conflictState: 'risky_delete',
      defaultDecision: 'rejected',
      canApply: true,
      reasons,
      baseBlock,
      headBlock,
    };
  }

  if (op.opType === 'update' && isRiskyTextShrink(headBlock, op.newBlockPayload)) {
    reasons.push('AI update removes more than 70% of the block text (possible LLM truncation).');
    if (headBlock.meta.humanTouched) {
      reasons.push('Block was previously edited by a human.');
    }
    if (isStale) {
      reasons.push('Block was also modified since the AI base revision.');
    }
    return {
      op,
      conflictState: 'risky_delete',
      defaultDecision: 'rejected',
      canApply: true,
      reasons,
      baseBlock,
      headBlock,
    };
  }

  if (isStale || isMoveAnchorMissing) {
    if (isStale) {
      reasons.push('Block changed in head revision after the AI read base revision.');
    }
    if (isMoveAnchorMissing) {
      reasons.push(`Move anchor block "${op.afterBlockId}" no longer exists in head revision.`);
    }
    if (headBlock.meta.humanTouched) {
      reasons.push('Block is protected by human edits.');
    }
    return {
      op,
      conflictState: 'stale_conflict',
      defaultDecision: 'rejected',
      canApply: true,
      reasons,
      baseBlock,
      headBlock,
    };
  }

  if (headBlock.meta.humanTouched) {
    reasons.push('Block was previously edited by a human and requires explicit approval.');
    return {
      op,
      conflictState: 'human_protected',
      defaultDecision: 'rejected',
      canApply: true,
      reasons,
      baseBlock,
      headBlock,
    };
  }

  return {
    op,
    conflictState: 'clean',
    defaultDecision: 'accepted',
    canApply: true,
    reasons: [],
    baseBlock,
    headBlock,
  };
}

export function classifyProposalOps(
  ops: readonly ProposalOpInput[],
  baseBlocks: readonly DocumentBlock[],
  headBlocks: readonly DocumentBlock[],
): ClassifiedProposalOp[] {
  const pendingInsertedIds = new Set<string>();
  return ops.map((op) => {
    const classified = classifyOperationConflict(op, baseBlocks, headBlocks, pendingInsertedIds);
    if (op.opType === 'insert' && op.newBlockPayload.id) {
      pendingInsertedIds.add(op.newBlockPayload.id);
    }
    return classified;
  });
}

/**
 * Evaluates whether an AI proposal can be auto-applied under the project/document policy.
 * Hard security invariant: ANY non-clean op (including humanTouched or lockedByHuman)
 * NEVER auto-applies regardless of policy.
 */
export function evaluateProposalPolicy(params: {
  policy: ApprovalPolicy;
  isNewDocument: boolean;
  hasMetadataChanges: boolean;
  classifiedOps: readonly ClassifiedProposalOp[];
}): PolicyEvaluationResult {
  const hasProtectedOrConflicting = params.classifiedOps.some(
    (item) => item.conflictState !== 'clean',
  );

  if (hasProtectedOrConflicting) {
    return {
      shouldAutoApply: false,
      reason: 'Proposal touches human-protected, locked, risky, or stale blocks; human approval is mandatory.',
    };
  }

  if (params.hasMetadataChanges && !params.isNewDocument) {
    return {
      shouldAutoApply: false,
      reason: 'Document metadata/tree changes always require human approval.',
    };
  }

  switch (params.policy) {
    case 'strict':
      return {
        shouldAutoApply: false,
        reason: 'Approval policy is set to strict.',
      };
    case 'auto_new_docs':
      return params.isNewDocument
        ? {
            shouldAutoApply: true,
            reason: 'New AI documents auto-publish under auto_new_docs policy.',
          }
        : {
            shouldAutoApply: false,
            reason: 'Edits to existing documents require review under auto_new_docs policy.',
          };
    case 'protect_human':
      return {
        shouldAutoApply: true,
        reason: 'All affected blocks are clean and untouched by humans under protect_human policy.',
      };
  }
}

export function applyProposalReview(params: {
  baseBlocks: readonly DocumentBlock[];
  headBlocks: readonly DocumentBlock[];
  ops: readonly ProposalOpInput[];
  decisions: readonly ProposalReviewDecision[];
  reviewerUserId: string;
  agentId: string;
  now?: string;
}): ApplyProposalReviewResult {
  if (params.ops.length !== params.decisions.length) {
    throw new CoreMergeError(
      'DECISION_COUNT_MISMATCH',
      `Expected ${params.ops.length} review decisions, received ${params.decisions.length}.`,
    );
  }

  const timestamp = params.now ?? new Date().toISOString();
  const classifiedOps = classifyProposalOps(params.ops, params.baseBlocks, params.headBlocks);
  const working: DocumentBlock[] = params.headBlocks.map((b) => ({
    ...b,
    meta: { ...b.meta },
  }));

  let appliedCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < classifiedOps.length; i++) {
    const classified = classifiedOps[i]!;
    const review = params.decisions[i]!;
    const { op, conflictState } = classified;

    if (review.decision === 'rejected') {
      rejectedCount++;
      continue;
    }

    if (conflictState === 'locked') {
      throw new CoreMergeError(
        ERROR_CODES.BLOCK_LOCKED_WARNING,
        `Cannot apply operation #${i} on locked block "${op.opType === 'insert' ? '' : op.targetBlockId}". Unlock the block first.`,
      );
    }

    if (
      conflictState === 'stale_conflict' &&
      review.decision === 'accepted' &&
      !review.forceResolveStale
    ) {
      throw new CoreMergeError(
        ERROR_CODES.HEAD_REVISION_CONFLICT,
        `Operation #${i} has a stale_conflict; choose "edited" or explicitly pass forceResolveStale: true.`,
      );
    }

    const isHumanEdited = review.decision === 'edited';

    if (op.opType === 'insert') {
      const payload = isHumanEdited
        ? review.humanEditedPayload ?? op.newBlockPayload
        : op.newBlockPayload;

      const validation = validateBlockPayload(payload);
      if (!validation.valid) {
        throw new CoreMergeError(
          validation.code,
          `Invalid visualization payload in insert operation #${i}.`,
          validation.details,
        );
      }

      const created = createDocumentBlock({
        payload,
        authorType: isHumanEdited ? 'human' : 'ai',
        authorId: isHumanEdited ? params.reviewerUserId : params.agentId,
        now: timestamp,
        humanTouched: isHumanEdited,
        lockedByHuman: false,
      });

      if (op.afterBlockId === null) {
        working.unshift(created);
      } else {
        const anchorIdx = working.findIndex((b) => b.id === op.afterBlockId);
        if (anchorIdx === -1) {
          working.push(created);
        } else {
          working.splice(anchorIdx + 1, 0, created);
        }
      }
      appliedCount++;
      continue;
    }

    const targetIdx = working.findIndex((b) => b.id === op.targetBlockId);
    if (targetIdx === -1) {
      throw new CoreMergeError(
        ERROR_CODES.HEAD_REVISION_CONFLICT,
        `Target block "${op.targetBlockId}" no longer exists in current head revision.`,
      );
    }

    if (op.opType === 'delete') {
      working.splice(targetIdx, 1);
      appliedCount++;
      continue;
    }

    if (op.opType === 'move') {
      const [moved] = working.splice(targetIdx, 1);
      if (!moved) continue;
      if (op.afterBlockId === null) {
        working.unshift(moved);
      } else {
        const anchorIdx = working.findIndex((b) => b.id === op.afterBlockId);
        if (anchorIdx === -1) {
          working.push(moved);
        } else {
          working.splice(anchorIdx + 1, 0, moved);
        }
      }
      appliedCount++;
      continue;
    }

    if (op.opType === 'update') {
      const existing = working[targetIdx]!;
      const payload = isHumanEdited
        ? review.humanEditedPayload ?? op.newBlockPayload
        : op.newBlockPayload;

      const validation = validateBlockPayload(payload);
      if (!validation.valid) {
        throw new CoreMergeError(
          validation.code,
          `Invalid visualization payload in update operation #${i}.`,
          validation.details,
        );
      }

      const nextHash = computeBlockContentHash(payload.type, payload.content);
      const updatedBlock = {
        id: existing.id,
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        type: payload.type,
        content: payload.content,
        contentHash: nextHash,
        meta: {
          ...existing.meta,
          lastEditedByType: isHumanEdited ? 'human' : 'ai',
          lastEditorId: isHumanEdited ? params.reviewerUserId : params.agentId,
          lastEditedAt: timestamp,
          // Sticky invariant: approving AI over a human-touched block preserves humanTouched
          // until explicitly released by the user in UI.
          humanTouched: existing.meta.humanTouched || isHumanEdited,
        },
      } as DocumentBlock;

      working[targetIdx] = updatedBlock;
      appliedCount++;
    }
  }

  let proposalStatus: ApplyProposalReviewResult['proposalStatus'];
  if (appliedCount === 0) {
    proposalStatus = 'rejected';
  } else if (rejectedCount === 0) {
    proposalStatus = 'approved';
  } else {
    proposalStatus = 'partially_approved';
  }

  return {
    nextBlocks: working,
    proposalStatus,
    appliedCount,
    rejectedCount,
    hasChanges: appliedCount > 0,
    classifiedOps,
  };
}

export interface HumanEditConflict {
  blockId: string;
  reason: string;
  headBlock: DocumentBlock | null;
  proposedBlock: ProposalBlockPayload | null;
}

export type HumanMergeResult =
  | { ok: true; nextBlocks: DocumentBlock[] }
  | { ok: false; conflicts: HumanEditConflict[] };

/**
 * Block-level 3-way merge for concurrent human edits (PATCH /docs/:docId).
 * Automatically merges edits to disjoint blocks and marks all human-changed blocks
 * with humanTouched = true.
 */
export function mergeHumanEdit(params: {
  baseBlocks: readonly DocumentBlock[];
  headBlocks: readonly DocumentBlock[];
  proposedBlocks: readonly ProposalBlockPayload[];
  editorUserId: string;
  now?: string;
}): HumanMergeResult {
  const timestamp = params.now ?? new Date().toISOString();
  const baseById = new Map(params.baseBlocks.map((b) => [b.id, b]));
  const headById = new Map(params.headBlocks.map((b) => [b.id, b]));
  const proposedById = new Map<string, ProposalBlockPayload>();

  for (const p of params.proposedBlocks) {
    if (p.id) {
      proposedById.set(p.id, p);
    }
  }

  const conflicts: HumanEditConflict[] = [];
  const nextBlocks: DocumentBlock[] = [];
  const handledHeadIds = new Set<string>();

  for (const proposed of params.proposedBlocks) {
    const id = proposed.id;
    const baseBlock = id ? baseById.get(id) ?? null : null;
    const headBlock = id ? headById.get(id) ?? null : null;

    if (id && headBlock) {
      handledHeadIds.add(id);
    }

    const proposedHash = computeBlockContentHash(proposed.type, proposed.content);
    const titleChangedFromBase =
      baseBlock !== null && (baseBlock.title ?? undefined) !== (proposed.title ?? undefined);
    const userModifiedThisBlock =
      baseBlock === null ||
      baseBlock.contentHash !== proposedHash ||
      baseBlock.type !== proposed.type ||
      titleChangedFromBase;

    if (!userModifiedThisBlock && headBlock) {
      // User did not touch this block; keep latest head version (including concurrent edits)
      nextBlocks.push(headBlock);
      continue;
    }

    if (userModifiedThisBlock && baseBlock !== null) {
      if (!headBlock) {
        conflicts.push({
          blockId: baseBlock.id,
          reason: 'Block was deleted in a concurrent revision while you were editing it.',
          headBlock: null,
          proposedBlock: proposed,
        });
        continue;
      }

      const headChangedFromBase =
        headBlock.contentHash !== baseBlock.contentHash ||
        headBlock.type !== baseBlock.type ||
        (headBlock.title ?? undefined) !== (baseBlock.title ?? undefined);

      if (headChangedFromBase && headBlock.contentHash !== proposedHash) {
        conflicts.push({
          blockId: baseBlock.id,
          reason: 'Block was modified concurrently by another revision.',
          headBlock,
          proposedBlock: proposed,
        });
        continue;
      }

      const validation = validateBlockPayload(proposed);
      if (!validation.valid) {
        throw new CoreMergeError(
          validation.code,
          `Invalid visualization in block "${baseBlock.id}".`,
          validation.details,
        );
      }

      nextBlocks.push({
        id: baseBlock.id,
        ...(proposed.title !== undefined ? { title: proposed.title } : {}),
        type: proposed.type,
        content: proposed.content,
        contentHash: proposedHash,
        meta: {
          ...headBlock.meta,
          lastEditedByType: 'human',
          lastEditorId: params.editorUserId,
          lastEditedAt: timestamp,
          humanTouched: true,
        },
      } as DocumentBlock);
      continue;
    }

    // Brand-new block created by human
    const validation = validateBlockPayload(proposed);
    if (!validation.valid) {
      throw new CoreMergeError(
        validation.code,
        'Invalid visualization in newly added block.',
        validation.details,
      );
    }

    nextBlocks.push(
      createDocumentBlock({
        payload: proposed,
        authorType: 'human',
        authorId: params.editorUserId,
        now: timestamp,
        humanTouched: true,
        lockedByHuman: false,
      }),
    );
  }

  // Handle blocks present in headBlocks that were absent from proposedBlocks
  for (const headBlock of params.headBlocks) {
    if (handledHeadIds.has(headBlock.id)) continue;
    const baseBlock = baseById.get(headBlock.id);
    if (!baseBlock) {
      // Added concurrently in head after baseRevision -> preserve it!
      nextBlocks.push(headBlock);
    } else if (headBlock.contentHash !== baseBlock.contentHash) {
      // User deleted it, while another revision modified it -> conflict!
      conflicts.push({
        blockId: headBlock.id,
        reason: 'Block was modified concurrently while you deleted it.',
        headBlock,
        proposedBlock: null,
      });
    }
    // Otherwise: user intentionally deleted an unchanged block -> omit from nextBlocks
  }

  if (conflicts.length > 0) {
    return { ok: false, conflicts };
  }

  return { ok: true, nextBlocks };
}
