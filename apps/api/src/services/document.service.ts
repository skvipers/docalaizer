import { and, desc, eq, sql } from 'drizzle-orm';
import {
  CoreMergeError,
  type DocumentBlock,
  type ProposalBlockPayload,
  createDocumentBlock,
  extractPlainTextForSearch,
  mergeHumanEdit,
  validateBlockPayload,
} from '@docalaizer/core';
import {
  type Database,
  type Document,
  type Revision,
  documents,
  proposals,
  revisions,
} from '@docalaizer/db';
import { ERROR_CODES } from '@docalaizer/shared';
import { AppError, isPgUniqueViolation } from '../errors';
import { assertProjectRole } from './rbac.service';

export function buildSearchVectorSql(title: string, blocks: readonly DocumentBlock[]) {
  const plainText = `${title}\n${extractPlainTextForSearch(blocks)}`;
  return sql`to_tsvector('simple', ${plainText})`;
}

function validateAllBlockPayloads(payloads: readonly ProposalBlockPayload[]): void {
  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i]!;
    const validation = validateBlockPayload(payload);
    if (!validation.valid) {
      throw new AppError(
        422,
        validation.code,
        `Validation failed for block #${i}.`,
        validation.details,
      );
    }
  }
}

export async function createDocumentAsHuman(
  db: Database,
  params: {
    userId: string;
    projectId: string;
    parentId?: string | null;
    slug: string;
    title: string;
    icon?: string;
    blocks: ProposalBlockPayload[];
    summary?: string;
  },
): Promise<{ document: Document; revision: Revision }> {
  await assertProjectRole(db, params.userId, params.projectId, ['owner', 'editor']);
  validateAllBlockPayloads(params.blocks);

  if (params.parentId) {
    const [parentDoc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, params.parentId), eq(documents.projectId, params.projectId)))
      .limit(1);
    if (!parentDoc) {
      throw new AppError(
        404,
        'NOT_FOUND',
        'Parent document not found in this project.',
      );
    }
  }

  const now = new Date().toISOString();
  const createdBlocks: DocumentBlock[] = params.blocks.map((payload) =>
    createDocumentBlock({
      payload,
      authorType: 'human',
      authorId: params.userId,
      now,
      humanTouched: true,
      lockedByHuman: false,
    }),
  );

  try {
    return await db.transaction(async (tx) => {
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
          authorType: 'human',
          authorUserId: params.userId,
          summary: params.summary ?? 'Initial version',
          blocksSnapshot: createdBlocks,
          searchVector: buildSearchVectorSql(doc.title, createdBlocks),
        })
        .returning();

      if (!rev) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create initial revision.');
      }

      const [updatedDoc] = await tx
        .update(documents)
        .set({ headRevisionId: rev.id, updatedAt: new Date() })
        .where(eq(documents.id, doc.id))
        .returning();

      return { document: updatedDoc ?? doc, revision: rev };
    });
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

export async function updateDocumentAsHuman(
  db: Database,
  params: {
    userId: string;
    docId: string;
    expectedHeadRevisionId: string;
    baseRevisionId?: string;
    proposedBlocks: ProposalBlockPayload[];
    title?: string;
    icon?: string | null;
    summary?: string;
  },
): Promise<{ document: Document; revision: Revision }> {
  validateAllBlockPayloads(params.proposedBlocks);

  const [initialDoc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, params.docId))
    .limit(1);

  if (!initialDoc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  await assertProjectRole(db, params.userId, initialDoc.projectId, ['owner', 'editor']);

  try {
    return await db.transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, params.docId))
      .limit(1);

    if (!doc || !doc.headRevisionId) {
      throw new AppError(404, 'NOT_FOUND', 'Document or head revision not found.');
    }

    const [headRev] = await tx
      .select()
      .from(revisions)
      .where(eq(revisions.id, doc.headRevisionId))
      .limit(1);

    if (!headRev) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Head revision record is missing.');
    }

    let baseBlocks = headRev.blocksSnapshot;
    const baseRevId = params.baseRevisionId ?? params.expectedHeadRevisionId;
    if (baseRevId !== headRev.id) {
      const [baseRev] = await tx
        .select()
        .from(revisions)
        .where(and(eq(revisions.id, baseRevId), eq(revisions.documentId, doc.id)))
        .limit(1);

      if (!baseRev) {
        throw new AppError(
          404,
          ERROR_CODES.BASE_REVISION_NOT_FOUND,
          'Base revision not found for this document.',
        );
      }
      baseBlocks = baseRev.blocksSnapshot;
    }

    let merged;
    try {
      merged = mergeHumanEdit({
        baseBlocks,
        headBlocks: headRev.blocksSnapshot,
        proposedBlocks: params.proposedBlocks,
        editorUserId: params.userId,
      });
    } catch (err) {
      if (err instanceof CoreMergeError) {
        throw new AppError(422, err.code, err.message, err.details);
      }
      throw err;
    }

    if (!merged.ok) {
      throw new AppError(
        409,
        ERROR_CODES.HEAD_REVISION_CONFLICT,
        'Concurrent edits conflicted on one or more blocks.',
        { conflicts: merged.conflicts, headRevisionId: headRev.id },
      );
    }

    const nextTitle = params.title !== undefined ? params.title.trim() : doc.title;
    const nextIcon = params.icon !== undefined ? params.icon : doc.icon;

    const [nextRev] = await tx
      .insert(revisions)
      .values({
        documentId: doc.id,
        parentRevisionId: headRev.id,
        revisionNumber: headRev.revisionNumber + 1,
        authorType: 'human',
        authorUserId: params.userId,
        summary: params.summary ?? 'Manual edit',
        blocksSnapshot: merged.nextBlocks,
        searchVector: buildSearchVectorSql(nextTitle, merged.nextBlocks),
      })
      .returning();

    if (!nextRev) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to insert new revision.');
    }

    // Optimistic lock on documents.head_revision_id
    const [updatedDoc] = await tx
      .update(documents)
      .set({
        headRevisionId: nextRev.id,
        title: nextTitle,
        icon: nextIcon,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, doc.id), eq(documents.headRevisionId, headRev.id)))
      .returning();

    if (!updatedDoc) {
      throw new AppError(
        409,
        ERROR_CODES.HEAD_REVISION_CONFLICT,
        'Document was modified concurrently; please retry.',
      );
    }

    return { document: updatedDoc, revision: nextRev };
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError(
        409,
        ERROR_CODES.HEAD_REVISION_CONFLICT,
        'Document was modified concurrently; please retry.',
      );
    }
    throw err;
  }
}

export async function updateBlockProtection(
  db: Database,
  params: {
    userId: string;
    docId: string;
    blockId: string;
    lockedByHuman?: boolean;
    humanTouched?: boolean;
    summary?: string;
  },
): Promise<{ document: Document; revision: Revision }> {
  const [initialDoc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, params.docId))
    .limit(1);

  if (!initialDoc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  await assertProjectRole(db, params.userId, initialDoc.projectId, ['owner', 'editor']);

  try {
    return await db.transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, params.docId))
      .limit(1);

    if (!doc || !doc.headRevisionId) {
      throw new AppError(404, 'NOT_FOUND', 'Document has no published revision.');
    }

    const [headRev] = await tx
      .select()
      .from(revisions)
      .where(eq(revisions.id, doc.headRevisionId))
      .limit(1);

    if (!headRev) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Head revision not found.');
    }

    const idx = headRev.blocksSnapshot.findIndex((b) => b.id === params.blockId);
    if (idx === -1) {
      throw new AppError(404, 'NOT_FOUND', `Block "${params.blockId}" not found.`);
    }

    const now = new Date().toISOString();
    const nextBlocks = headRev.blocksSnapshot.map((b, i) => {
      if (i !== idx) return b;
      return {
        ...b,
        meta: {
          ...b.meta,
          lockedByHuman: params.lockedByHuman ?? b.meta.lockedByHuman,
          humanTouched: params.humanTouched ?? b.meta.humanTouched,
          lastEditedByType: 'human' as const,
          lastEditorId: params.userId,
          lastEditedAt: now,
        },
      };
    });

    const [nextRev] = await tx
      .insert(revisions)
      .values({
        documentId: doc.id,
        parentRevisionId: headRev.id,
        revisionNumber: headRev.revisionNumber + 1,
        authorType: 'human',
        authorUserId: params.userId,
        summary: params.summary ?? `Updated protection flags on block ${params.blockId}`,
        blocksSnapshot: nextBlocks,
        searchVector: buildSearchVectorSql(doc.title, nextBlocks),
      })
      .returning();

    if (!nextRev) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create revision.');
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
        'Document was modified concurrently; please retry.',
      );
    }

    return { document: updatedDoc, revision: nextRev };
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError(
        409,
        ERROR_CODES.HEAD_REVISION_CONFLICT,
        'Document was modified concurrently; please retry.',
      );
    }
    throw err;
  }
}

export async function rollbackDocument(
  db: Database,
  params: {
    userId: string;
    docId: string;
    targetRevisionId: string;
    blockId?: string;
    summary?: string;
  },
): Promise<{ document: Document; revision: Revision }> {
  const [initialDoc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, params.docId))
    .limit(1);

  if (!initialDoc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  await assertProjectRole(db, params.userId, initialDoc.projectId, ['owner', 'editor']);

  try {
    return await db.transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, params.docId))
      .limit(1);

    if (!doc || !doc.headRevisionId) {
      throw new AppError(404, 'NOT_FOUND', 'Document has no revisions.');
    }

    const [headRev] = await tx
      .select()
      .from(revisions)
      .where(eq(revisions.id, doc.headRevisionId))
      .limit(1);

    const [targetRev] = await tx
      .select()
      .from(revisions)
      .where(and(eq(revisions.id, params.targetRevisionId), eq(revisions.documentId, doc.id)))
      .limit(1);

    if (!headRev || !targetRev) {
      throw new AppError(404, 'NOT_FOUND', 'Target revision not found for this document.');
    }

    let nextBlocks: DocumentBlock[];
    if (params.blockId) {
      const restoredBlock = targetRev.blocksSnapshot.find((b) => b.id === params.blockId);
      if (!restoredBlock) {
        throw new AppError(
          404,
          'NOT_FOUND',
          `Block "${params.blockId}" does not exist in target revision v${targetRev.revisionNumber}.`,
        );
      }
      const existingIdx = headRev.blocksSnapshot.findIndex((b) => b.id === params.blockId);
      nextBlocks = [...headRev.blocksSnapshot];
      if (existingIdx === -1) {
        nextBlocks.push(restoredBlock);
      } else {
        nextBlocks[existingIdx] = restoredBlock;
      }
    } else {
      nextBlocks = targetRev.blocksSnapshot;
    }

    // Append-only history invariant: rollback creates v(N+1)
    const [nextRev] = await tx
      .insert(revisions)
      .values({
        documentId: doc.id,
        parentRevisionId: headRev.id,
        revisionNumber: headRev.revisionNumber + 1,
        authorType: 'human',
        authorUserId: params.userId,
        summary:
          params.summary ??
          (params.blockId
            ? `Rolled back block ${params.blockId} to v${targetRev.revisionNumber}`
            : `Rolled back document to v${targetRev.revisionNumber}`),
        blocksSnapshot: nextBlocks,
        searchVector: buildSearchVectorSql(doc.title, nextBlocks),
      })
      .returning();

    if (!nextRev) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create rollback revision.');
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
        'Document was modified concurrently during rollback.',
      );
    }

    return { document: updatedDoc, revision: nextRev };
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError(
        409,
        ERROR_CODES.HEAD_REVISION_CONFLICT,
        'Document was modified concurrently; please retry.',
      );
    }
    throw err;
  }
}

export async function getDocumentWithHead(
  db: Database,
  params: { userId: string; docId: string },
): Promise<{
  document: Document;
  headRevision: Revision | null;
  pendingProposalsCount: number;
}> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, params.docId))
    .limit(1);

  if (!doc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  await assertProjectRole(db, params.userId, doc.projectId, [
    'owner',
    'editor',
    'reviewer',
    'viewer',
  ]);

  const headRevision = doc.headRevisionId
    ? (
        await db
          .select()
          .from(revisions)
          .where(eq(revisions.id, doc.headRevisionId))
          .limit(1)
      )[0] ?? null
    : null;

  const [pendingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(proposals)
    .where(and(eq(proposals.documentId, doc.id), eq(proposals.status, 'pending')));

  return {
    document: doc,
    headRevision,
    pendingProposalsCount: pendingRow?.count ?? 0,
  };
}

export async function getDocumentRevisionById(
  db: Database,
  params: { userId: string; docId: string; revisionId: string },
): Promise<Revision> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, params.docId))
    .limit(1);

  if (!doc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  await assertProjectRole(db, params.userId, doc.projectId, [
    'owner',
    'editor',
    'reviewer',
    'viewer',
  ]);

  const [rev] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, params.revisionId), eq(revisions.documentId, doc.id)))
    .limit(1);

  if (!rev) {
    throw new AppError(404, 'NOT_FOUND', 'Revision not found.');
  }
  return rev;
}

export async function getDocumentRevisions(
  db: Database,
  params: { userId: string; docId: string; limit?: number },
): Promise<Revision[]> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, params.docId))
    .limit(1);

  if (!doc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  await assertProjectRole(db, params.userId, doc.projectId, [
    'owner',
    'editor',
    'reviewer',
    'viewer',
  ]);

  return db
    .select()
    .from(revisions)
    .where(eq(revisions.documentId, doc.id))
    .orderBy(desc(revisions.revisionNumber))
    .limit(params.limit ?? 50);
}
