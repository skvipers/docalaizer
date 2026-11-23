import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '@docalaizer/db';
import { AGENT_SCOPES, PROJECT_SCOPE_MODES } from '@docalaizer/shared';
import { type AppVariables, requireUser } from '../middleware/auth';
import { listUserAgents, updateUserAgent } from '../services/project.service';
import { createAgentToken, revokeAgentToken } from '../services/rbac.service';

const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  scopes: z.array(z.enum(AGENT_SCOPES)).optional(),
  projectScopeMode: z.enum(PROJECT_SCOPE_MODES).optional(),
  allowedProjectIds: z.array(z.string().uuid()).optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  scopes: z.array(z.enum(AGENT_SCOPES)).optional(),
  projectScopeMode: z.enum(PROJECT_SCOPE_MODES).optional(),
  allowedProjectIds: z.array(z.string().uuid()).optional(),
});

export function createAgentsRoutes(db: Database) {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', requireUser(db));

  router.get('/', async (c) => {
    const user = c.get('user')!;
    const items = await listUserAgents(db, user.id);
    return c.json({ agents: items });
  });

  router.post('/', async (c) => {
    const user = c.get('user')!;
    const body = createAgentSchema.parse(await c.req.json());
    const { agent, rawToken } = await createAgentToken(db, {
      ownerUserId: user.id,
      ...body,
    });

    return c.json(
      {
        agent: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          tokenPrefix: agent.tokenPrefix,
          scopes: agent.scopes,
          projectScopeMode: agent.projectScopeMode,
          allowedProjectIds: agent.allowedProjectIds,
          isActive: agent.isActive,
          createdAt: agent.createdAt,
        },
        token: rawToken, // Shown once!
      },
      201,
    );
  });

  router.patch('/:agentId', async (c) => {
    const user = c.get('user')!;
    const body = updateAgentSchema.parse(await c.req.json());
    const agent = await updateUserAgent(db, user.id, c.req.param('agentId'), body);
    return c.json({ agent });
  });

  router.post('/:agentId/revoke', async (c) => {
    const user = c.get('user')!;
    await revokeAgentToken(db, user.id, c.req.param('agentId'));
    return c.json({ ok: true });
  });

  return router;
}
