import { Hono } from 'hono';
import { z } from 'zod';
import { proposalBlockPayloadSchema } from '@docalaizer/core';
import type { Database } from '@docalaizer/db';
import { APPROVAL_POLICIES, PROJECT_ROLES } from '@docalaizer/shared';
import { type AppVariables, requireUser } from '../middleware/auth';
import { createDocumentAsHuman } from '../services/document.service';
import {
  deleteProjectAsUser,
  getProjectForUser,
  getProjectTree,
  listProjectMembers,
  listUserProjects,
  removeProjectMember,
  updateProjectAsUser,
  upsertProjectMember,
} from '../services/project.service';
import { assertProjectRole, createProjectAsUser } from '../services/rbac.service';

const createProjectSchema = z.object({
  name: z.string().min(1).max(140),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/i),
  description: z.string().max(1000).optional(),
  icon: z.string().max(32).optional(),
  defaultApprovalPolicy: z.enum(APPROVAL_POLICIES).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(140).optional(),
  description: z.string().max(1000).nullable().optional(),
  icon: z.string().max(32).nullable().optional(),
  defaultApprovalPolicy: z.enum(APPROVAL_POLICIES).optional(),
});

const upsertMemberSchema = z.object({
  email: z.string().email().optional(),
  userId: z.string().uuid().optional(),
  role: z.enum(PROJECT_ROLES),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(PROJECT_ROLES),
});

const createDocSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/i),
  title: z.string().min(1).max(200),
  icon: z.string().max(32).optional(),
  blocks: z.array(proposalBlockPayloadSchema).default([]),
  summary: z.string().max(300).optional(),
});

export function createProjectsRoutes(db: Database) {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', requireUser(db));

  router.get('/', async (c) => {
    const user = c.get('user')!;
    const items = await listUserProjects(db, user.id);
    return c.json({ projects: items });
  });

  router.post('/', async (c) => {
    const user = c.get('user')!;
    const body = createProjectSchema.parse(await c.req.json());
    const project = await createProjectAsUser(db, { userId: user.id, ...body });
    return c.json({ project }, 201);
  });

  router.get('/:projectId', async (c) => {
    const user = c.get('user')!;
    const result = await getProjectForUser(db, user.id, c.req.param('projectId'));
    return c.json(result);
  });

  router.patch('/:projectId', async (c) => {
    const user = c.get('user')!;
    const body = updateProjectSchema.parse(await c.req.json());
    const project = await updateProjectAsUser(db, user.id, c.req.param('projectId'), body);
    return c.json({ project });
  });

  router.delete('/:projectId', async (c) => {
    const user = c.get('user')!;
    await deleteProjectAsUser(db, user.id, c.req.param('projectId'));
    return c.json({ ok: true });
  });

  router.get('/:projectId/members', async (c) => {
    const user = c.get('user')!;
    const members = await listProjectMembers(db, user.id, c.req.param('projectId'));
    return c.json({ members });
  });

  router.post('/:projectId/members', async (c) => {
    const user = c.get('user')!;
    const body = upsertMemberSchema.parse(await c.req.json());
    const member = await upsertProjectMember(db, user.id, c.req.param('projectId'), body);
    return c.json({ member }, 201);
  });

  router.patch('/:projectId/members/:userId', async (c) => {
    const user = c.get('user')!;
    const body = updateMemberRoleSchema.parse(await c.req.json());
    const member = await upsertProjectMember(db, user.id, c.req.param('projectId'), {
      userId: c.req.param('userId'),
      role: body.role,
    });
    return c.json({ member });
  });

  router.delete('/:projectId/members/:userId', async (c) => {
    const user = c.get('user')!;
    await removeProjectMember(db, user.id, c.req.param('projectId'), c.req.param('userId'));
    return c.json({ ok: true });
  });

  router.get('/:projectId/tree', async (c) => {
    const user = c.get('user')!;
    const projectId = c.req.param('projectId');
    await assertProjectRole(db, user.id, projectId, ['owner', 'editor', 'reviewer', 'viewer']);
    const tree = await getProjectTree(db, projectId);
    return c.json({ documents: tree });
  });

  router.post('/:projectId/docs', async (c) => {
    const user = c.get('user')!;
    const body = createDocSchema.parse(await c.req.json());
    const created = await createDocumentAsHuman(db, {
      userId: user.id,
      projectId: c.req.param('projectId'),
      ...body,
    });
    return c.json(created, 201);
  });

  return router;
}
