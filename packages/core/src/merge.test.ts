import { ERROR_CODES } from '@docalaizer/shared';
import { describe, expect, it } from 'vitest';
import { type ProposalOpInput, createDocumentBlock } from './blocks';
import {
  CoreMergeError,
  applyProposalReview,
  classifyOperationConflict,
  classifyProposalOps,
  evaluateProposalPolicy,
  mergeHumanEdit,
} from './merge';

const T0 = '2026-11-23T00:00:00.000Z';
const T1 = '2026-11-23T00:05:00.000Z';
const T2 = '2026-11-23T00:10:00.000Z';

describe('classifyOperationConflict and conflict priorities', () => {
  const aiBlock = createDocumentBlock({
    payload: {
      id: 'blk_ai',
      type: 'markdown',
      content: 'AI generated section with enough text to test truncation threshold safely.',
    },
    authorType: 'ai',
    authorId: 'agent_1',
    now: T0,
  });

  const humanBlock = createDocumentBlock({
    payload: {
      id: 'blk_human',
      type: 'markdown',
      content: 'Carefully hand-written architectural invariant documented by the owner.',
    },
    authorType: 'human',
    authorId: 'user_1',
    now: T0,
  });

  const lockedBlock = createDocumentBlock({
    payload: { id: 'blk_locked', type: 'markdown', content: 'Frozen compliance text.' },
    authorType: 'human',
    authorId: 'user_1',
    now: T0,
    lockedByHuman: true,
  });

  it('classifies clean, human_protected, locked, stale_conflict, and risky_delete accurately', () => {
    const base = [aiBlock, humanBlock, lockedBlock];
    const head = [...base];

    // clean update on AI block
    const clean = classifyOperationConflict(
      {
        opType: 'update',
        targetBlockId: 'blk_ai',
        expectedHash: aiBlock.contentHash,
        newBlockPayload: {
          type: 'markdown',
          content: 'AI generated section updated with fresh metrics and additional context.',
        },
      },
      base,
      head,
    );
    expect(clean.conflictState).toBe('clean');
    expect(clean.defaultDecision).toBe('accepted');

    // human_protected update on humanTouched block
    const humanProtected = classifyOperationConflict(
      {
        opType: 'update',
        targetBlockId: 'blk_human',
        expectedHash: humanBlock.contentHash,
        newBlockPayload: {
          type: 'markdown',
          content: 'Carefully hand-written architectural invariant updated by AI agent.',
        },
      },
      base,
      head,
    );
    expect(humanProtected.conflictState).toBe('human_protected');
    expect(humanProtected.defaultDecision).toBe('rejected');

    // locked block cannot be applied
    const locked = classifyOperationConflict(
      {
        opType: 'delete',
        targetBlockId: 'blk_locked',
        expectedHash: lockedBlock.contentHash,
      },
      base,
      head,
    );
    expect(locked.conflictState).toBe('locked');
    expect(locked.canApply).toBe(false);

    // risky_delete when deleting humanTouched block
    const riskyDel = classifyOperationConflict(
      {
        opType: 'delete',
        targetBlockId: 'blk_human',
        expectedHash: humanBlock.contentHash,
      },
      base,
      head,
    );
    expect(riskyDel.conflictState).toBe('risky_delete');
    expect(riskyDel.defaultDecision).toBe('rejected');

    // risky_delete when AI shrinks markdown text by >70% (LLM truncation guard)
    const riskyShrink = classifyOperationConflict(
      {
        opType: 'update',
        targetBlockId: 'blk_ai',
        expectedHash: aiBlock.contentHash,
        newBlockPayload: { type: 'markdown', content: 'Short.' },
      },
      base,
      head,
    );
    expect(riskyShrink.conflictState).toBe('risky_delete');
    expect(riskyShrink.defaultDecision).toBe('rejected');
  });

  it('detects stale_conflict when head diverged from base revision', () => {
    const base = [aiBlock];
    const head = [
      createDocumentBlock({
        payload: {
          id: 'blk_ai',
          type: 'markdown',
          content: 'Human jumped in and edited this block while AI was working on stale base.',
        },
        authorType: 'human',
        authorId: 'user_1',
        now: T1,
      }),
    ];

    const res = classifyOperationConflict(
      {
        opType: 'update',
        targetBlockId: 'blk_ai',
        expectedHash: aiBlock.contentHash,
        newBlockPayload: {
          type: 'markdown',
          content: 'AI wrote another version based on older revision before human edit.',
        },
      },
      base,
      head,
    );
    expect(res.conflictState).toBe('stale_conflict');
    expect(res.defaultDecision).toBe('rejected');
  });

  it('treats chained inserts anchored to earlier inserted blocks in the same proposal as clean', () => {
    const ops: ProposalOpInput[] = [
      {
        opType: 'insert',
        afterBlockId: null,
        newBlockPayload: { id: 'new_1', type: 'markdown', content: 'First new block' },
      },
      {
        opType: 'insert',
        afterBlockId: 'new_1',
        newBlockPayload: { id: 'new_2', type: 'markdown', content: 'Second chained block' },
      },
    ];
    const classified = classifyProposalOps(ops, [], []);
    expect(classified.map((c) => c.conflictState)).toEqual(['clean', 'clean']);
  });
});

describe('evaluateProposalPolicy (hard protection invariant)', () => {
  it('NEVER auto-applies proposals touching humanTouched or locked blocks even under protect_human', () => {
    const humanBlock = createDocumentBlock({
      payload: { id: 'b1', type: 'markdown', content: 'Human text with sufficient length here.' },
      authorType: 'human',
      authorId: 'u1',
      now: T0,
    });
    const aiBlock = createDocumentBlock({
      payload: { id: 'b2', type: 'markdown', content: 'AI text with sufficient length here.' },
      authorType: 'ai',
      authorId: 'a1',
      now: T0,
    });

    const opsTouchingHuman: ProposalOpInput[] = [
      {
        opType: 'update',
        targetBlockId: 'b1',
        expectedHash: humanBlock.contentHash,
        newBlockPayload: { type: 'markdown', content: 'AI tries to overwrite human text here.' },
      },
    ];
    const classifiedHuman = classifyProposalOps(opsTouchingHuman, [humanBlock, aiBlock], [humanBlock, aiBlock]);

    expect(
      evaluateProposalPolicy({
        policy: 'protect_human',
        isNewDocument: false,
        hasMetadataChanges: false,
        classifiedOps: classifiedHuman,
      }).shouldAutoApply,
    ).toBe(false);

    // Clean AI-only update under protect_human CAN auto-apply, but NOT under strict or with metadata changes
    const opsAiOnly: ProposalOpInput[] = [
      {
        opType: 'update',
        targetBlockId: 'b2',
        expectedHash: aiBlock.contentHash,
        newBlockPayload: { type: 'markdown', content: 'AI refreshes its own metrics text here.' },
      },
    ];
    const classifiedAi = classifyProposalOps(opsAiOnly, [humanBlock, aiBlock], [humanBlock, aiBlock]);

    expect(
      evaluateProposalPolicy({
        policy: 'protect_human',
        isNewDocument: false,
        hasMetadataChanges: false,
        classifiedOps: classifiedAi,
      }).shouldAutoApply,
    ).toBe(true);

    expect(
      evaluateProposalPolicy({
        policy: 'protect_human',
        isNewDocument: false,
        hasMetadataChanges: true,
        classifiedOps: classifiedAi,
      }).shouldAutoApply,
    ).toBe(false);

    expect(
      evaluateProposalPolicy({
        policy: 'strict',
        isNewDocument: true,
        hasMetadataChanges: false,
        classifiedOps: classifiedAi,
      }).shouldAutoApply,
    ).toBe(false);

    expect(
      evaluateProposalPolicy({
        policy: 'auto_new_docs',
        isNewDocument: true,
        hasMetadataChanges: false,
        classifiedOps: classifiedAi,
      }).shouldAutoApply,
    ).toBe(true);
  });
});

describe('applyProposalReview (cherry-pick, parallel edits, locks, stale guard)', () => {
  it('supports cherry-pick while preserving concurrent human edits to unrelated blocks', () => {
    const blockA = createDocumentBlock({
      payload: { id: 'A', type: 'markdown', content: 'AI section A initial content.' },
      authorType: 'ai',
      authorId: 'agent_1',
      now: T0,
    });
    const blockB = createDocumentBlock({
      payload: { id: 'B', type: 'markdown', content: 'Human section B carefully written.' },
      authorType: 'human',
      authorId: 'user_1',
      now: T0,
    });
    const blockD_base = createDocumentBlock({
      payload: { id: 'D', type: 'markdown', content: 'Section D old.' },
      authorType: 'ai',
      authorId: 'agent_1',
      now: T0,
    });
    // While AI worked on base, human edited D in head!
    const blockD_head = createDocumentBlock({
      payload: { id: 'D', type: 'markdown', content: 'Section D edited concurrently by human!' },
      authorType: 'human',
      authorId: 'user_1',
      now: T1,
    });

    const ops: ProposalOpInput[] = [
      {
        opType: 'update',
        targetBlockId: 'A',
        expectedHash: blockA.contentHash,
        newBlockPayload: { type: 'markdown', content: 'AI section A updated cleanly.' },
      },
      {
        opType: 'update',
        targetBlockId: 'B',
        expectedHash: blockB.contentHash,
        newBlockPayload: { type: 'markdown', content: 'AI tried to rewrite human section B.' },
      },
      {
        opType: 'insert',
        afterBlockId: 'B',
        newBlockPayload: {
          id: 'C',
          type: 'chart',
          title: 'Latency',
          content: {
            engine: 'vega-lite',
            spec: { mark: 'bar' },
            data: [{ day: 'Mon', ms: 100 }],
          },
        },
      },
    ];

    const result = applyProposalReview({
      baseBlocks: [blockA, blockB, blockD_base],
      headBlocks: [blockA, blockB, blockD_head],
      ops,
      decisions: [
        { decision: 'accepted' },
        { decision: 'rejected', reviewComment: 'Keep my wording in B' },
        { decision: 'accepted' },
      ],
      reviewerUserId: 'user_1',
      agentId: 'agent_1',
      now: T2,
    });

    expect(result.proposalStatus).toBe('partially_approved');
    expect(result.appliedCount).toBe(2);
    expect(result.rejectedCount).toBe(1);
    expect(result.nextBlocks.map((b) => b.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(result.nextBlocks[0]?.content).toBe('AI section A updated cleanly.');
    expect(result.nextBlocks[1]?.content).toBe('Human section B carefully written.');
    expect(result.nextBlocks[2]?.type).toBe('chart');
    expect(result.nextBlocks[3]?.content).toBe('Section D edited concurrently by human!');
  });

  it('preserves sticky humanTouched when accepting AI over human block and sets humanTouched on edited', () => {
    const humanBlock = createDocumentBlock({
      payload: { id: 'H', type: 'markdown', content: 'Original human content.' },
      authorType: 'human',
      authorId: 'user_1',
      now: T0,
    });
    const aiBlock = createDocumentBlock({
      payload: { id: 'A', type: 'markdown', content: 'Original AI content.' },
      authorType: 'ai',
      authorId: 'agent_1',
      now: T0,
    });

    const result = applyProposalReview({
      baseBlocks: [humanBlock, aiBlock],
      headBlocks: [humanBlock, aiBlock],
      ops: [
        {
          opType: 'update',
          targetBlockId: 'H',
          expectedHash: humanBlock.contentHash,
          newBlockPayload: { type: 'markdown', content: 'Accepted AI improvement over human.' },
        },
        {
          opType: 'update',
          targetBlockId: 'A',
          expectedHash: aiBlock.contentHash,
          newBlockPayload: { type: 'markdown', content: 'AI suggestion.' },
        },
      ],
      decisions: [
        { decision: 'accepted' },
        {
          decision: 'edited',
          humanEditedPayload: { type: 'markdown', content: 'Tweaked manually in review UI.' },
        },
      ],
      reviewerUserId: 'user_1',
      agentId: 'agent_1',
      now: T1,
    });

    expect(result.proposalStatus).toBe('approved');
    expect(result.nextBlocks[0]?.meta.humanTouched).toBe(true);
    expect(result.nextBlocks[1]?.meta.humanTouched).toBe(true);
    expect(result.nextBlocks[1]?.meta.lastEditedByType).toBe('human');
  });

  it('refuses applying to locked blocks and blocks unconfirmed stale_conflict accepts', () => {
    const locked = createDocumentBlock({
      payload: { id: 'L', type: 'markdown', content: 'Locked text.' },
      authorType: 'human',
      authorId: 'u1',
      now: T0,
      lockedByHuman: true,
    });

    expect(() =>
      applyProposalReview({
        baseBlocks: [locked],
        headBlocks: [locked],
        ops: [
          {
            opType: 'update',
            targetBlockId: 'L',
            expectedHash: locked.contentHash,
            newBlockPayload: { type: 'markdown', content: 'Attempt overwrite.' },
          },
        ],
        decisions: [{ decision: 'accepted' }],
        reviewerUserId: 'u1',
        agentId: 'a1',
      }),
    ).toThrowError(CoreMergeError);

    const staleBase = createDocumentBlock({
      payload: { id: 'S', type: 'markdown', content: 'Version 1 text.' },
      authorType: 'ai',
      authorId: 'a1',
      now: T0,
    });
    const staleHead = createDocumentBlock({
      payload: { id: 'S', type: 'markdown', content: 'Version 2 edited by user.' },
      authorType: 'human',
      authorId: 'u1',
      now: T1,
    });

    try {
      applyProposalReview({
        baseBlocks: [staleBase],
        headBlocks: [staleHead],
        ops: [
          {
            opType: 'update',
            targetBlockId: 'S',
            expectedHash: staleBase.contentHash,
            newBlockPayload: { type: 'markdown', content: 'AI stale rewrite.' },
          },
        ],
        decisions: [{ decision: 'accepted' }],
        reviewerUserId: 'u1',
        agentId: 'a1',
      });
      expect.fail('Expected CoreMergeError for unconfirmed stale_conflict');
    } catch (err) {
      expect(err).toBeInstanceOf(CoreMergeError);
      expect((err as CoreMergeError).code).toBe(ERROR_CODES.HEAD_REVISION_CONFLICT);
    }

    // Explicit forceResolveStale succeeds
    const resolved = applyProposalReview({
      baseBlocks: [staleBase],
      headBlocks: [staleHead],
      ops: [
        {
          opType: 'update',
          targetBlockId: 'S',
          expectedHash: staleBase.contentHash,
          newBlockPayload: { type: 'markdown', content: 'AI stale rewrite explicitly chosen.' },
        },
      ],
      decisions: [{ decision: 'accepted', forceResolveStale: true }],
      reviewerUserId: 'u1',
      agentId: 'a1',
    });
    expect(resolved.nextBlocks[0]?.content).toBe('AI stale rewrite explicitly chosen.');
    expect(resolved.nextBlocks[0]?.meta.humanTouched).toBe(true);
  });
});

describe('mergeHumanEdit (concurrent multi-user edits)', () => {
  it('auto-merges disjoint block edits and preserves concurrently added head blocks', () => {
    const b1 = createDocumentBlock({
      payload: { id: 'b1', type: 'markdown', content: 'Block 1 v1' },
      authorType: 'ai',
      authorId: 'a1',
      now: T0,
    });
    const b2 = createDocumentBlock({
      payload: { id: 'b2', type: 'markdown', content: 'Block 2 v1' },
      authorType: 'ai',
      authorId: 'a1',
      now: T0,
    });

    // User 2 concurrently edited b2 and added b3
    const b2_u2 = createDocumentBlock({
      payload: { id: 'b2', type: 'markdown', content: 'Block 2 edited by user 2' },
      authorType: 'human',
      authorId: 'u2',
      now: T1,
    });
    const b3_u2 = createDocumentBlock({
      payload: { id: 'b3', type: 'markdown', content: 'Block 3 added by user 2' },
      authorType: 'human',
      authorId: 'u2',
      now: T1,
    });

    // User 1 (based on [b1, b2]) edited only b1
    const merged = mergeHumanEdit({
      baseBlocks: [b1, b2],
      headBlocks: [b1, b2_u2, b3_u2],
      proposedBlocks: [
        { id: 'b1', type: 'markdown', content: 'Block 1 edited by user 1' },
        { id: 'b2', type: 'markdown', content: 'Block 2 v1' },
      ],
      editorUserId: 'u1',
      now: T2,
    });

    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.nextBlocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
      expect(merged.nextBlocks[0]?.content).toBe('Block 1 edited by user 1');
      expect(merged.nextBlocks[0]?.meta.humanTouched).toBe(true);
      expect(merged.nextBlocks[1]?.content).toBe('Block 2 edited by user 2');
      expect(merged.nextBlocks[2]?.content).toBe('Block 3 added by user 2');
    }
  });

  it('reports conflicts when two users edit the same block concurrently', () => {
    const b1 = createDocumentBlock({
      payload: { id: 'b1', type: 'markdown', content: 'Base' },
      authorType: 'ai',
      authorId: 'a1',
      now: T0,
    });
    const b1_u2 = createDocumentBlock({
      payload: { id: 'b1', type: 'markdown', content: 'User 2 version' },
      authorType: 'human',
      authorId: 'u2',
      now: T1,
    });

    const merged = mergeHumanEdit({
      baseBlocks: [b1],
      headBlocks: [b1_u2],
      proposedBlocks: [{ id: 'b1', type: 'markdown', content: 'User 1 version' }],
      editorUserId: 'u1',
      now: T2,
    });

    expect(merged.ok).toBe(false);
    if (!merged.ok) {
      expect(merged.conflicts).toHaveLength(1);
      expect(merged.conflicts[0]?.blockId).toBe('b1');
    }
  });
});
