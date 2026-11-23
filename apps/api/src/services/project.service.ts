import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  type Database,
  type Document,
  type Project,
  agents,
  documents,
  projectMembers,
  projects,
  proposals,
  revisions,
  users,
} from '@docalaizer/db';
import {
  type AgentScope,
  type ApprovalPolicy,
  ERROR_CODES,
  type ProjectRole,
  type ProjectScopeMode,
} from '@docalaizer/shared';
import { AppError, isPgUniqueViolation } from '../errors';
import {
  type AuthAgent,
  assertAgentScope,
  assertProjectRole,
} from './rbac.service';

export interface ProjectListItem {
  project: Project;
  role: ProjectRole;
  pendingProposalsCount: number;
}

export async function listUserProjects(
  db: Database,
  userId: string,
): Promise<ProjectListItem[]> {
  const rows = await db
    .select({
      project: projects,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projectMembers.userId, userId), eq(projects.isArchived, false)))
    .orderBy(asc(projects.name));

  if (rows.length === 0) return [];

  const projectIds = rows.map((r) => r.project.id);
  const pendingCounts = await db
    .select({
      projectId: proposals.projectId,
      count: sql<number>`count(*)::int`,
    })
    .from(proposals)
    .where(and(inArray(proposals.projectId, projectIds), eq(proposals.status, 'pending')))
    .groupBy(proposals.projectId);

  const countMap = new Map(pendingCounts.map((c) => [c.projectId, c.count]));
  return rows.map((r) => ({
    project: r.project,
    role: r.role,
    pendingProposalsCount: countMap.get(r.project.id) ?? 0,
  }));
}

export async function listAgentAccessibleProjects(
  db: Database,
  agent: AuthAgent,
  query?: string,
): Promise<Project[]> {
  assertAgentScope(agent, 'projects:read');

  const ownerProjects = await db
    .select({ project: projects })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projectMembers.userId, agent.ownerUserId), eq(projects.isArchived, false)))
    .orderBy(asc(projects.name));

  let filtered = ownerProjects.map((r) => r.project);
  if (agent.projectScopeMode === 'selected') {
    const allowed = new Set(agent.allowedProjectIds);
    filtered = filtered.filter((p) => allowed.has(p.id));
  }

  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q),
    );
  }

  return filtered;
}

export async function getProjectForUser(
  db: Database,
  userId: string,
  projectId: string,
): Promise<{ project: Project; role: ProjectRole }> {
  const role = await assertProjectRole(db, userId, projectId, [
    'owner',
    'editor',
    'reviewer',
    'viewer',
  ]);
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new AppError(404, 'NOT_FOUND', 'Project not found.');
  }
  return { project, role };
}

export async function updateProjectAsUser(
  db: Database,
  userId: string,
  projectId: string,
  patch: {
    name?: string;
    description?: string | null;
    icon?: string | null;
    defaultApprovalPolicy?: ApprovalPolicy;
  },
): Promise<Project> {
  await assertProjectRole(db, userId, projectId, ['owner']);
  const [updated] = await db
    .update(projects)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.defaultApprovalPolicy !== undefined
        ? { defaultApprovalPolicy: patch.defaultApprovalPolicy }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();

  if (!updated) {
    throw new AppError(404, 'NOT_FOUND', 'Project not found.');
  }
  return updated;
}

export async function deleteProjectAsUser(
  db: Database,
  userId: string,
  projectId: string,
): Promise<void> {
  await assertProjectRole(db, userId, projectId, ['owner']);
  const [deleted] = await db
    .delete(projects)
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id });

  if (!deleted) {
    throw new AppError(404, 'NOT_FOUND', 'Project not found.');
  }
}

export async function listProjectMembers(
  db: Database,
  userId: string,
  projectId: string,
) {
  await assertProjectRole(db, userId, projectId, ['owner', 'editor', 'reviewer', 'viewer']);
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(users.name));
}

export async function upsertProjectMember(
  db: Database,
  actorUserId: string,
  projectId: string,
  targetEmailOrUserId: { email?: string; userId?: string; role: ProjectRole },
) {
  await assertProjectRole(db, actorUserId, projectId, ['owner']);

  let targetUserId = targetEmailOrUserId.userId;
  if (!targetUserId && targetEmailOrUserId.email) {
    const [found] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, targetEmailOrUserId.email.trim().toLowerCase()))
      .limit(1);
    if (!found) {
      throw new AppError(404, 'NOT_FOUND', 'User with this email was not found.');
    }
    targetUserId = found.id;
  }

  if (!targetUserId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Provide either email or userId.');
  }

  const [member] = await db
    .insert(projectMembers)
    .values({
      projectId,
      userId: targetUserId,
      role: targetEmailOrUserId.role,
    })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role: targetEmailOrUserId.role },
    })
    .returning();

  return member;
}

export async function removeProjectMember(
  db: Database,
  actorUserId: string,
  projectId: string,
  targetUserId: string,
): Promise<void> {
  await assertProjectRole(db, actorUserId, projectId, ['owner']);
  if (actorUserId === targetUserId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Owner cannot remove themselves from the project.');
  }
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)));
}

export interface DocumentTreeNode {
  id: string;
  projectId: string;
  parentId: string | null;
  sortOrder: number;
  slug: string;
  title: string;
  icon: string | null;
  headRevisionId: string | null;
  isDraft: boolean;
  pendingProposalsCount: number;
  updatedAt: Date;
}

export async function getProjectTree(
  db: Database,
  projectId: string,
): Promise<DocumentTreeNode[]> {
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), eq(documents.isArchived, false)))
    .orderBy(asc(documents.sortOrder), asc(documents.title));

  if (docs.length === 0) return [];

  const pendingCounts = await db
    .select({
      documentId: proposals.documentId,
      count: sql<number>`count(*)::int`,
    })
    .from(proposals)
    .where(and(eq(proposals.projectId, projectId), eq(proposals.status, 'pending')))
    .groupBy(proposals.documentId);

  const countMap = new Map(pendingCounts.map((c) => [c.documentId, c.count]));

  return docs.map((d) => ({
    id: d.id,
    projectId: d.projectId,
    parentId: d.parentId,
    sortOrder: d.sortOrder,
    slug: d.slug,
    title: d.title,
    icon: d.icon,
    headRevisionId: d.headRevisionId,
    isDraft: d.isDraft,
    pendingProposalsCount: countMap.get(d.id) ?? 0,
    updatedAt: d.updatedAt,
  }));
}

export async function moveDocumentAsUser(
  db: Database,
  userId: string,
  docId: string,
  params: { parentId: string | null; sortOrder?: number },
): Promise<Document> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
  if (!doc) {
    throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  }

  await assertProjectRole(db, userId, doc.projectId, ['owner', 'editor']);

  if (params.parentId === doc.id) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A document cannot be its own parent.');
  }

  if (params.parentId !== null) {
    const projectDocs = await db
      .select({ id: documents.id, parentId: documents.parentId })
      .from(documents)
      .where(eq(documents.projectId, doc.projectId));

    const parentMap = new Map(projectDocs.map((d) => [d.id, d.parentId]));
    if (!parentMap.has(params.parentId)) {
      throw new AppError(404, 'NOT_FOUND', 'Target parent document not found in this project.');
    }

    // Cycle check: walk up from params.parentId to root
    let cursor: string | null | undefined = params.parentId;
    while (cursor) {
      if (cursor === doc.id) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Cannot move a document under its own descendant.');
      }
      cursor = parentMap.get(cursor) ?? null;
    }
  }

  try {
    const [updated] = await db
      .update(documents)
      .set({
        parentId: params.parentId,
        ...(params.sortOrder !== undefined ? { sortOrder: params.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id))
      .returning();

    return updated ?? doc;
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError(409, 'CONFLICT', 'Document move caused a uniqueness conflict.');
    }
    throw err;
  }
}

export async function searchDocumentsByProjectIds(
  db: Database,
  params: { projectIds: string[]; query: string; limit?: number },
) {
  if (params.projectIds.length === 0 || !params.query.trim()) {
    return [];
  }

  const trimmed = params.query.trim();
  const likePattern = `%${trimmed}%`;

  return db
    .select({
      documentId: documents.id,
      projectId: documents.projectId,
      slug: documents.slug,
      title: documents.title,
      icon: documents.icon,
      headRevisionId: documents.headRevisionId,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(revisions, eq(documents.headRevisionId, revisions.id))
    .where(
      and(
        inArray(documents.projectId, params.projectIds),
        eq(documents.isArchived, false),
        or(
          sql`${revisions.searchVector} @@ plainto_tsquery('simple', ${trimmed})`,
          sql`${documents.title} ILIKE ${likePattern}`,
        ),
      ),
    )
    .orderBy(desc(documents.updatedAt))
    .limit(params.limit ?? 25);
}

export async function listUserAgents(db: Database, ownerUserId: string) {
  return db
    .select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      tokenPrefix: agents.tokenPrefix,
      scopes: agents.scopes,
      projectScopeMode: agents.projectScopeMode,
      allowedProjectIds: agents.allowedProjectIds,
      isActive: agents.isActive,
      revokedAt: agents.revokedAt,
      lastUsedAt: agents.lastUsedAt,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .where(eq(agents.ownerUserId, ownerUserId))
    .orderBy(desc(agents.createdAt));
}

export async function updateUserAgent(
  db: Database,
  ownerUserId: string,
  agentId: string,
  patch: {
    name?: string;
    description?: string | null;
    scopes?: AgentScope[];
    projectScopeMode?: ProjectScopeMode;
    allowedProjectIds?: string[];
  },
) {
  if (patch.projectScopeMode === 'selected' && patch.allowedProjectIds?.length) {
    const memberships = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, ownerUserId),
          inArray(projectMembers.projectId, patch.allowedProjectIds),
        ),
      );
    const accessible = new Set(memberships.map((m) => m.projectId));
    const denied = patch.allowedProjectIds.filter((id) => !accessible.has(id));
    if (denied.length > 0) {
      throw new AppError(
        403,
        ERROR_CODES.PROJECT_ACCESS_DENIED,
        `Cannot grant access to projects you do not belong to: ${denied.join(', ')}`,
      );
    }
  }

  const [updated] = await db
    .update(agents)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.scopes !== undefined ? { scopes: patch.scopes } : {}),
      ...(patch.projectScopeMode !== undefined ? { projectScopeMode: patch.projectScopeMode } : {}),
      ...(patch.allowedProjectIds !== undefined
        ? { allowedProjectIds: patch.allowedProjectIds }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(agents.id, agentId), eq(agents.ownerUserId, ownerUserId)))
    .returning({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      tokenPrefix: agents.tokenPrefix,
      scopes: agents.scopes,
      projectScopeMode: agents.projectScopeMode,
      allowedProjectIds: agents.allowedProjectIds,
      isActive: agents.isActive,
      revokedAt: agents.revokedAt,
      lastUsedAt: agents.lastUsedAt,
      createdAt: agents.createdAt,
    });

  if (!updated) {
    throw new AppError(404, 'NOT_FOUND', 'Agent not found.');
  }
  return updated;
}
