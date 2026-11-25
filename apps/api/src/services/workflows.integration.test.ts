import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  agents,
  createDb,
  documents,
  projects,
  proposals,
  revisions,
  users,
} from '@docalaizer/db';
import { ERROR_CODES } from '@docalaizer/shared';
import { createApp } from '../app';
import { AppError } from '../errors';
import { sha256 } from '../security/crypto';
import { registerUser } from './auth.service';
import {
  createDocumentAsHuman,
  rollbackDocument,
  updateBlockProtection,
  updateDocumentAsHuman,
} from './document.service';
import {
  createDocumentAsAgent,
  createProposalAsAgent,
  getProposalWithLiveDiff,
  reviewProposal,
} from './proposal.service';
import {
  authenticateAgent,
  createAgentToken,
  createProjectAsAgent,
  createProjectAsUser,
  revokeAgentToken,
} from './rbac.service';
import { upsertProjectMember } from './project.service';

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
    // Delete in FK-safe order (projects cascade docs/revisions/proposals, then agents, then users)
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

describe('Auth, RBAC, and transactional Proposal workflows (live PostgreSQL)', () => {
  it('enforces auth signup policy, HttpOnly cookie sessions, and logout via HTTP routes', async () => {
    const suffix = randomUUID().slice(0, 8);
    const appStrict = createApp({ db, allowPublicSignup: false });
    const appOpen = createApp({ db, allowPublicSignup: true });

    // Seeded DB already has at least one user, so public signup must be rejected when disabled
    const blockedRes = await appStrict.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `blocked-${suffix}@example.com`,
        name: 'Blocked User',
        password: 'password123',
      }),
    });
    expect(blockedRes.status).toBe(403);

    // Registration succeeds when allowPublicSignup = true
    const email = `user-${suffix}@example.com`;
    const regRes = await appOpen.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: 'Test Owner', password: 'password123' }),
    });
    expect(regRes.status).toBe(201);
    const regJson = (await regRes.json()) as { user: { id: string; email: string } };
    createdUserIds.push(regJson.user.id);

    const setCookieHeader = regRes.headers.get('set-cookie');
    expect(setCookieHeader).toContain('docalaizer_session=');
    const cookiePair = setCookieHeader!.split(';')[0]!;

    // /me works with session cookie
    const meRes = await appOpen.request('/api/v1/auth/me', {
      headers: { cookie: cookiePair },
    });
    expect(meRes.status).toBe(200);
    const meJson = (await meRes.json()) as { user: { id: string } };
    expect(meJson.user.id).toBe(regJson.user.id);

    // /logout revokes session
    const logoutRes = await appOpen.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { cookie: cookiePair },
    });
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await appOpen.request('/api/v1/auth/me', {
      headers: { cookie: cookiePair },
    });
    expect(meAfterLogout.status).toBe(401);
  });

  it('enforces agent scopes (projects:create, project allowlist, hashed tokens, revocation)', async () => {
    const suffix = randomUUID().slice(0, 8);
    const { user } = await registerUser(db, {
      email: `rbac-${suffix}@example.com`,
      name: 'RBAC Owner',
      password: 'password123',
      allowPublicSignup: true,
    });
    createdUserIds.push(user.id);

    const allowedProj = await createProjectAsUser(db, {
      userId: user.id,
      name: 'Allowed Project',
      slug: `allowed-${suffix}`,
    });
    const privateProj = await createProjectAsUser(db, {
      userId: user.id,
      name: 'Private Project',
      slug: `private-${suffix}`,
    });
    createdProjectIds.push(allowedProj.id, privateProj.id);

    // Agent 1: default scopes (NO projects:create), selected project scope
    const { agent: agentRow1, rawToken: token1 } = await createAgentToken(db, {
      ownerUserId: user.id,
      name: 'Restricted Agent',
      projectScopeMode: 'selected',
      allowedProjectIds: [allowedProj.id],
    });
    createdAgentIds.push(agentRow1.id);

    // Stored only as SHA-256 hash
    expect(agentRow1.tokenHash).toBe(sha256(token1));
    expect(agentRow1.tokenHash).not.toBe(token1);

    const authAgent1 = await authenticateAgent(db, token1);
    expect(authAgent1).not.toBeNull();

    // Forbidden from creating projects without `projects:create`
    await expect(
      createProjectAsAgent(db, authAgent1!, {
        name: 'Unauthorized Project',
        slug: `unauth-${suffix}`,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: ERROR_CODES.FORBIDDEN_SCOPE,
    });

    // Forbidden from creating docs in privateProj (outside allowedProjectIds)
    const { agent: agentRow2, rawToken: token2 } = await createAgentToken(db, {
      ownerUserId: user.id,
      name: 'Creator Agent',
      scopes: ['projects:read', 'projects:create', 'docs:read', 'docs:create', 'docs:propose'],
      projectScopeMode: 'selected',
      allowedProjectIds: [allowedProj.id],
    });
    createdAgentIds.push(agentRow2.id);
    const authAgent2 = (await authenticateAgent(db, token2))!;

    await expect(
      createDocumentAsAgent(db, {
        agent: authAgent2,
        projectId: privateProj.id,
        slug: 'sneaky',
        title: 'Sneaky Doc',
        blocks: [{ type: 'markdown', content: 'Nope' }],
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: ERROR_CODES.PROJECT_ACCESS_DENIED,
    });

    // Allowed to create a new project with `projects:create` AND automatically gets access to it
    const aiProject = await createProjectAsAgent(db, authAgent2, {
      name: 'AI Created Project',
      slug: `ai-proj-${suffix}`,
      defaultApprovalPolicy: 'protect_human',
    });
    createdProjectIds.push(aiProject.id);
    expect(aiProject.createdByAgentId).toBe(agentRow2.id);

    const aiDoc = await createDocumentAsAgent(db, {
      agent: authAgent2,
      projectId: aiProject.id,
      slug: 'architecture',
      title: 'Architecture',
      blocks: [
        { id: 'blk_a', type: 'markdown', content: 'AI initial section A with enough length.' },
        { id: 'blk_b', type: 'markdown', content: 'AI initial section B with enough length.' },
      ],
    });
    expect(aiDoc.status).toBe('applied');

    // Token revocation immediately blocks authentication
    await revokeAgentToken(db, user.id, agentRow1.id);
    expect(await authenticateAgent(db, token1)).toBeNull();
  });

  it('protects humanTouched and locked blocks end-to-end across protect_human auto-apply, cherry-pick, idempotency, and rollback', async () => {
    const suffix = randomUUID().slice(0, 8);
    const { user } = await registerUser(db, {
      email: `flow-${suffix}@example.com`,
      name: 'Doc Owner',
      password: 'password123',
      allowPublicSignup: true,
    });
    createdUserIds.push(user.id);

    const project = await createProjectAsUser(db, {
      userId: user.id,
      name: 'Core Docs',
      slug: `core-docs-${suffix}`,
      defaultApprovalPolicy: 'protect_human',
    });
    createdProjectIds.push(project.id);

    const { agent: agentRow, rawToken } = await createAgentToken(db, {
      ownerUserId: user.id,
      name: 'Claude Code',
      scopes: ['projects:read', 'docs:read', 'docs:create', 'docs:propose'],
      projectScopeMode: 'all_owner_projects',
    });
    createdAgentIds.push(agentRow.id);
    const agent = (await authenticateAgent(db, rawToken))!;

    // 1. AI creates doc under protect_human -> auto-published v1 (all blocks humanTouched = false)
    const created = await createDocumentAsAgent(db, {
      agent,
      projectId: project.id,
      slug: 'service-design',
      title: 'Service Design',
      blocks: [
        { id: 'blk_ai', type: 'markdown', content: 'AI managed metrics overview section.' },
        { id: 'blk_human', type: 'markdown', content: 'Architecture decisions section.' },
        { id: 'blk_other', type: 'markdown', content: 'Deployment notes section.' },
      ],
    });
    expect(created.status).toBe('applied');
    if (created.status !== 'applied') return;
    const docId = created.document.id;
    const rev1 = created.revision;

    // 2. Human edits blk_human -> creates v2 with blk_human.meta.humanTouched = true
    const humanEdit = await updateDocumentAsHuman(db, {
      userId: user.id,
      docId,
      expectedHeadRevisionId: rev1.id,
      proposedBlocks: [
        { id: 'blk_ai', type: 'markdown', content: 'AI managed metrics overview section.' },
        {
          id: 'blk_human',
          type: 'markdown',
          content: 'Human-edited critical architecture decision that AI must never overwrite!',
        },
        { id: 'blk_other', type: 'markdown', content: 'Deployment notes section.' },
      ],
      summary: 'Human refined architecture decision',
    });
    const rev2 = humanEdit.revision;
    expect(rev2.revisionNumber).toBe(2);
    expect(rev2.blocksSnapshot.find((b) => b.id === 'blk_human')?.meta.humanTouched).toBe(true);
    expect(rev2.blocksSnapshot.find((b) => b.id === 'blk_ai')?.meta.humanTouched).toBe(false);

    // 3. Invalid Vega-Lite chart is rejected BEFORE creating any Proposal
    await expect(
      createProposalAsAgent(db, {
        agent,
        docId,
        baseRevisionId: rev2.id,
        title: 'Broken chart',
        ops: [
          {
            opType: 'insert',
            afterBlockId: 'blk_ai',
            newBlockPayload: {
              type: 'chart',
              content: { engine: 'vega-lite', spec: { mark: 'nonexistent_mark' } },
            },
          },
        ],
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: ERROR_CODES.CHART_VALIDATION_ERROR,
    });

    // 4. Clean AI-only update under protect_human auto-applies -> v3
    const aiClean = await createProposalAsAgent(db, {
      agent,
      docId,
      baseRevisionId: rev2.id,
      title: 'Refresh AI metrics section',
      idempotencyKey: `auto-${suffix}`,
      ops: [
        {
          opType: 'update',
          targetBlockId: 'blk_ai',
          expectedHash: rev2.blocksSnapshot[0]!.contentHash,
          newBlockPayload: {
            type: 'markdown',
            content: 'AI managed metrics overview section refreshed with Q4 numbers.',
          },
        },
      ],
    });
    expect(aiClean.status).toBe('applied');
    if (aiClean.status !== 'applied') return;
    const rev3 = aiClean.revision;
    expect(rev3.revisionNumber).toBe(3);
    expect(rev3.proposalId).toBeTruthy();

    const autoReplay = await createProposalAsAgent(db, {
      agent,
      docId,
      baseRevisionId: rev2.id,
      title: 'Refresh AI metrics section',
      idempotencyKey: `auto-${suffix}`,
      ops: [],
    });
    expect(autoReplay).toMatchObject({ status: 'applied', revision: { id: rev3.id } });

    // 5. AI tries to touch humanTouched block + insert valid chart -> MUST become pending Proposal!
    const propResult = await createProposalAsAgent(db, {
      agent,
      docId,
      baseRevisionId: rev3.id,
      title: 'Update decisions & add latency chart',
      rationale: 'Added benchmark chart and suggested wording tweak',
      idempotencyKey: `idem-${suffix}`,
      ops: [
        {
          opType: 'update',
          targetBlockId: 'blk_human',
          expectedHash: rev3.blocksSnapshot[1]!.contentHash,
          newBlockPayload: {
            type: 'markdown',
            content: 'AI wants to replace human architecture decision with its own text.',
          },
        },
        {
          opType: 'insert',
          afterBlockId: 'blk_human',
          newBlockPayload: {
            id: 'blk_chart',
            type: 'chart',
            title: 'Latency p95',
            content: {
              engine: 'vega-lite',
              spec: { mark: 'line', encoding: { x: { field: 'd' }, y: { field: 'ms' } } },
              data: [{ d: 'Mon', ms: 90 }],
            },
          },
        },
      ],
    });
    expect(propResult.status).toBe('pending');
    if (propResult.status !== 'pending') return;
    expect(propResult.summary.human_protected).toBe(1);
    expect(propResult.summary.clean).toBe(1);
    expect(propResult.idempotentReplay).toBe(false);

    // 6. Idempotent replay returns the exact same Proposal without duplicating
    const replay = await createProposalAsAgent(db, {
      agent,
      docId,
      baseRevisionId: rev3.id,
      title: 'Update decisions & add latency chart',
      idempotencyKey: `idem-${suffix}`,
      ops: [],
    });
    expect(replay.status).toBe('pending');
    if (replay.status === 'pending') {
      expect(replay.proposal.id).toBe(propResult.proposal.id);
      expect(replay.idempotentReplay).toBe(true);
    }

    // 7. While proposal waits, human edits unrelated blk_other -> v4
    const parallelHuman = await updateDocumentAsHuman(db, {
      userId: user.id,
      docId,
      expectedHeadRevisionId: rev3.id,
      proposedBlocks: [
        {
          id: 'blk_ai',
          type: 'markdown',
          content: 'AI managed metrics overview section refreshed with Q4 numbers.',
        },
        {
          id: 'blk_human',
          type: 'markdown',
          content: 'Human-edited critical architecture decision that AI must never overwrite!',
        },
        { id: 'blk_other', type: 'markdown', content: 'Human updated deployment notes in parallel!' },
      ],
    });
    expect(parallelHuman.revision.revisionNumber).toBe(4);

    // 8. Cherry-pick review: reject human block rewrite, accept new chart -> v5 (partially_approved)
    const liveDiff = await getProposalWithLiveDiff(db, {
      userId: user.id,
      proposalId: propResult.proposal.id,
    });
    expect(liveDiff.ops[0]?.liveConflictState).toBe('human_protected');
    expect(liveDiff.ops[1]?.liveConflictState).toBe('clean');

    const reviewed = await reviewProposal(db, {
      reviewerUserId: user.id,
      proposalId: propResult.proposal.id,
      decisions: [
        {
          opId: liveDiff.ops[0]!.row.id,
          decision: 'rejected',
          reviewComment: 'Do not overwrite manual decision',
        },
        {
          opId: liveDiff.ops[1]!.row.id,
          decision: 'accepted',
        },
      ],
    });
    expect(reviewed.proposal.status).toBe('partially_approved');
    expect(reviewed.revision?.revisionNumber).toBe(5);
    expect(reviewed.revision?.blocksSnapshot.map((b) => b.id)).toEqual([
      'blk_ai',
      'blk_human',
      'blk_chart',
      'blk_other',
    ]);
    // Parallel human edit on blk_other and original blk_human both preserved!
    expect(reviewed.revision?.blocksSnapshot[1]?.content).toContain('Human-edited critical');
    expect(reviewed.revision?.blocksSnapshot[3]?.content).toBe(
      'Human updated deployment notes in parallel!',
    );

    // Double-review is blocked
    await expect(
      reviewProposal(db, {
        reviewerUserId: user.id,
        proposalId: propResult.proposal.id,
        decisions: [
          { opId: liveDiff.ops[0]!.row.id, decision: 'rejected' },
          { opId: liveDiff.ops[1]!.row.id, decision: 'rejected' },
        ],
      }),
    ).rejects.toBeInstanceOf(AppError);

    // 9. Lock blk_human -> AI proposal targeting locked block cannot be applied until unlocked
    const lockedRev = await updateBlockProtection(db, {
      userId: user.id,
      docId,
      blockId: 'blk_human',
      lockedByHuman: true,
    });
    expect(lockedRev.revision.revisionNumber).toBe(6);

    const lockedProposal = await createProposalAsAgent(db, {
      agent,
      docId,
      baseRevisionId: lockedRev.revision.id,
      title: 'Touch locked block',
      ops: [
        {
          opType: 'update',
          targetBlockId: 'blk_human',
          expectedHash: lockedRev.revision.blocksSnapshot[1]!.contentHash,
          newBlockPayload: {
            type: 'markdown',
            content: 'Attempt to edit locked compliance section with enough characters.',
          },
        },
      ],
    });
    expect(lockedProposal.status).toBe('pending');
    if (lockedProposal.status !== 'pending') return;
    expect(lockedProposal.summary.locked).toBe(1);

    await expect(
      reviewProposal(db, {
        reviewerUserId: user.id,
        proposalId: lockedProposal.proposal.id,
        decisions: [{ opId: lockedProposal.ops[0]!.id, decision: 'accepted' }],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: ERROR_CODES.BLOCK_LOCKED_WARNING,
    });

    // Ensure proposal stayed pending (transaction rolled back cleanly)
    const [stillPending] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, lockedProposal.proposal.id));
    expect(stillPending?.status).toBe('pending');

    // 10. Append-only rollback to v2 creates v7 without deleting history
    const rolled = await rollbackDocument(db, {
      userId: user.id,
      docId,
      targetRevisionId: rev2.id,
    });
    expect(rolled.revision.revisionNumber).toBe(7);

    const allRevs = await db.select().from(revisions).where(eq(revisions.documentId, docId));
    expect(allRevs).toHaveLength(7);

    const [finalDoc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(finalDoc?.headRevisionId).toBe(rolled.revision.id);
  });

  it('supports human creation and concurrent disjoint human edit 3-way merge', async () => {
    const suffix = randomUUID().slice(0, 8);
    const { user } = await registerUser(db, {
      email: `human-merge-${suffix}@example.com`,
      name: 'Human Merger',
      password: 'password123',
      allowPublicSignup: true,
    });
    createdUserIds.push(user.id);

    const project = await createProjectAsUser(db, {
      userId: user.id,
      name: 'Merge Project',
      slug: `merge-proj-${suffix}`,
    });
    createdProjectIds.push(project.id);

    const { document, revision: v1 } = await createDocumentAsHuman(db, {
      userId: user.id,
      projectId: project.id,
      slug: 'runbook',
      title: 'Runbook',
      blocks: [
        { id: 'b1', type: 'markdown', content: 'Section 1 v1' },
        { id: 'b2', type: 'markdown', content: 'Section 2 v1' },
      ],
    });

    // Save 1 modifies b2 -> v2
    const save1 = await updateDocumentAsHuman(db, {
      userId: user.id,
      docId: document.id,
      expectedHeadRevisionId: v1.id,
      proposedBlocks: [
        { id: 'b1', type: 'markdown', content: 'Section 1 v1' },
        { id: 'b2', type: 'markdown', content: 'Section 2 updated by tab 1' },
      ],
    });
    expect(save1.revision.revisionNumber).toBe(2);

    // Save 2 (still based on stale v1!) modifies ONLY b1 -> auto 3-way merge -> v3 preserving b2!
    const save2 = await updateDocumentAsHuman(db, {
      userId: user.id,
      docId: document.id,
      expectedHeadRevisionId: v1.id,
      baseRevisionId: v1.id,
      proposedBlocks: [
        { id: 'b1', type: 'markdown', content: 'Section 1 updated by tab 2' },
        { id: 'b2', type: 'markdown', content: 'Section 2 v1' },
      ],
    });
    expect(save2.revision.revisionNumber).toBe(3);
    expect(save2.revision.blocksSnapshot[0]?.content).toBe('Section 1 updated by tab 2');
    expect(save2.revision.blocksSnapshot[1]?.content).toBe('Section 2 updated by tab 1');
  });

  it('enforces same-project parentId, last-owner protection, DB healthcheck, security headers, and rate limiting', async () => {
    const suffix = randomUUID().slice(0, 8);
    const { user } = await registerUser(db, {
      email: `sec-${suffix}@example.com`,
      name: 'Security Owner',
      password: 'password123',
      allowPublicSignup: true,
    });
    createdUserIds.push(user.id);

    const projA = await createProjectAsUser(db, {
      userId: user.id,
      name: 'Project A',
      slug: `proj-a-${suffix}`,
    });
    const projB = await createProjectAsUser(db, {
      userId: user.id,
      name: 'Project B',
      slug: `proj-b-${suffix}`,
    });
    createdProjectIds.push(projA.id, projB.id);

    const { document: docInA } = await createDocumentAsHuman(db, {
      userId: user.id,
      projectId: projA.id,
      slug: 'parent-a',
      title: 'Parent in A',
      blocks: [],
    });

    // Cross-project parentId must be rejected
    await expect(
      createDocumentAsHuman(db, {
        userId: user.id,
        projectId: projB.id,
        parentId: docInA.id,
        slug: 'child-cross',
        title: 'Cross-project child',
        blocks: [],
      }),
    ).rejects.toMatchObject({ status: 404 });

    // Last owner cannot be demoted
    await expect(
      upsertProjectMember(db, user.id, projA.id, { userId: user.id, role: 'editor' }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

    // DB healthcheck + security headers
    const app = createApp({ db, allowPublicSignup: false });
    const healthRes = await app.request('/health');
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toMatchObject({ status: 'ok', db: 'ok' });
    expect(healthRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(healthRes.headers.get('x-frame-options')).toBe('DENY');
    expect(healthRes.headers.get('content-security-policy')).toContain("default-src 'none'");

    // Auth rate limit triggers 429 after 30 requests from same IP
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await app.request('/api/v1/auth/providers', {
        headers: { 'x-forwarded-for': `10.99.0.${suffix.charCodeAt(0) % 200}` },
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
