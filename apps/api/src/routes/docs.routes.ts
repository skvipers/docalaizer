import { Hono } from 'hono';
import { z } from 'zod';
import {
  proposalBlockPayloadSchema,
  serializeBlocksToAnnotatedMarkdown,
} from '@docalaizer/core';
import type { Database } from '@docalaizer/db';
import { type AppVariables, requireUser } from '../middleware/auth';
import {
  getDocumentRevisionById,
  getDocumentRevisions,
  getDocumentWithHead,
  rollbackDocument,
  updateBlockProtection,
  updateDocumentAsHuman,
} from '../services/document.service';
import {
  listUserProjects,
  moveDocumentAsUser,
  searchDocumentsByProjectIds,
} from '../services/project.service';
import { assertProjectRole } from '../services/rbac.service';

const patchDocSchema = z.object({
  expectedHeadRevisionId: z.string().uuid(),
  baseRevisionId: z.string().uuid().optional(),
  proposedBlocks: z.array(proposalBlockPayloadSchema),
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(32).nullable().optional(),
  summary: z.string().max(300).optional(),
});

const patchProtectionSchema = z.object({
  lockedByHuman: z.boolean().optional(),
  humanTouched: z.boolean().optional(),
  summary: z.string().max(300).optional(),
});

const moveDocSchema = z.object({
  parentId: z.string().uuid().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});

const rollbackSchema = z.object({
  targetRevisionId: z.string().uuid(),
  blockId: z.string().min(1).optional(),
  summary: z.string().max(300).optional(),
});

export function createDocsRoutes(db: Database) {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', requireUser(db));

  router.get('/search', async (c) => {
    const user = c.get('user')!;
    const q = c.req.query('q') ?? '';
    const projectId = c.req.query('projectId');
    const limit = Number(c.req.query('limit') ?? 25);

    let projectIds: string[];
    if (projectId) {
      await assertProjectRole(db, user.id, projectId, ['owner', 'editor', 'reviewer', 'viewer']);
      projectIds = [projectId];
    } else {
      const userProjects = await listUserProjects(db, user.id);
      projectIds = userProjects.map((p) => p.project.id);
    }

    const results = await searchDocumentsByProjectIds(db, {
      projectIds,
      query: q,
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 25,
    });
    return c.json({ results });
  });

  router.get('/:docId', async (c) => {
    const user = c.get('user')!;
    const format = c.req.query('format');
    const data = await getDocumentWithHead(db, {
      userId: user.id,
      docId: c.req.param('docId'),
    });

    return c.json({
      ...data,
      ...(format === 'annotated_markdown' && data.headRevision
        ? {
            annotatedMarkdown: serializeBlocksToAnnotatedMarkdown(
              data.headRevision.blocksSnapshot,
            ),
          }
        : {}),
    });
  });

  router.patch('/:docId', async (c) => {
    const user = c.get('user')!;
    const body = patchDocSchema.parse(await c.req.json());
    const result = await updateDocumentAsHuman(db, {
      userId: user.id,
      docId: c.req.param('docId'),
      ...body,
    });
    return c.json(result);
  });

  router.patch('/:docId/blocks/:blockId/protection', async (c) => {
    const user = c.get('user')!;
    const body = patchProtectionSchema.parse(await c.req.json());
    const result = await updateBlockProtection(db, {
      userId: user.id,
      docId: c.req.param('docId'),
      blockId: c.req.param('blockId'),
      ...body,
    });
    return c.json(result);
  });

  router.patch('/:docId/move', async (c) => {
    const user = c.get('user')!;
    const body = moveDocSchema.parse(await c.req.json());
    const document = await moveDocumentAsUser(db, user.id, c.req.param('docId'), body);
    return c.json({ document });
  });

  router.get('/:docId/revisions', async (c) => {
    const user = c.get('user')!;
    const limit = Number(c.req.query('limit') ?? 50);
    const revisionsList = await getDocumentRevisions(db, {
      userId: user.id,
      docId: c.req.param('docId'),
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
    });
    return c.json({ revisions: revisionsList });
  });

  router.get('/:docId/revisions/:revId', async (c) => {
    const user = c.get('user')!;
    const revision = await getDocumentRevisionById(db, {
      userId: user.id,
      docId: c.req.param('docId'),
      revisionId: c.req.param('revId'),
    });
    return c.json({ revision });
  });

  router.post('/:docId/rollback', async (c) => {
    const user = c.get('user')!;
    const body = rollbackSchema.parse(await c.req.json());
    const result = await rollbackDocument(db, {
      userId: user.id,
      docId: c.req.param('docId'),
      ...body,
    });
    return c.json(result);
  });

  return router;
}
