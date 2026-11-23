import { Hono } from 'hono';
import { z } from 'zod';
import { proposalBlockPayloadSchema } from '@docalaizer/core';
import type { Database } from '@docalaizer/db';
import { PROPOSAL_STATUSES } from '@docalaizer/shared';
import { type AppVariables, requireUser } from '../middleware/auth';
import {
  getProposalWithLiveDiff,
  listProposalsForUser,
  reviewProposal,
} from '../services/proposal.service';

const reviewDecisionSchema = z.object({
  opId: z.string().uuid(),
  decision: z.enum(['accepted', 'rejected', 'edited']),
  humanEditedPayload: proposalBlockPayloadSchema.optional(),
  reviewComment: z.string().max(1000).optional(),
  forceResolveStale: z.boolean().optional(),
});

const reviewProposalSchema = z.object({
  decisions: z.array(reviewDecisionSchema),
  acceptMetadataChanges: z.boolean().optional(),
});

const statusParamSchema = z.enum(PROPOSAL_STATUSES).optional();

export function createProposalsRoutes(db: Database) {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', requireUser(db));

  router.get('/', async (c) => {
    const user = c.get('user')!;
    const projectId = c.req.query('projectId');
    const docId = c.req.query('docId');
    const rawStatus = c.req.query('status');
    const status = rawStatus ? statusParamSchema.parse(rawStatus) : undefined;

    const items = await listProposalsForUser(db, user.id, {
      ...(projectId ? { projectId } : {}),
      ...(docId ? { docId } : {}),
      ...(status ? { status } : {}),
    });
    return c.json({ proposals: items });
  });

  router.get('/:proposalId', async (c) => {
    const user = c.get('user')!;
    const data = await getProposalWithLiveDiff(db, {
      userId: user.id,
      proposalId: c.req.param('proposalId'),
    });
    return c.json(data);
  });

  router.post('/:proposalId/review', async (c) => {
    const user = c.get('user')!;
    const body = reviewProposalSchema.parse(await c.req.json());
    const result = await reviewProposal(db, {
      reviewerUserId: user.id,
      proposalId: c.req.param('proposalId'),
      decisions: body.decisions,
      acceptMetadataChanges: body.acceptMetadataChanges,
    });
    return c.json(result);
  });

  return router;
}
