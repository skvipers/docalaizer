import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  DEFAULT_AGENT_SCOPES,
  type Database,
  type Project,
  agents,
  projectMembers,
  projects,
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
import { generateAgentToken, sha256 } from '../security/crypto';

export interface AuthAgent {
  id: string;
  ownerUserId: string;
  name: string;
  scopes: AgentScope[];
  projectScopeMode: ProjectScopeMode;
  allowedProjectIds: string[];
}

export async function getUserProjectRole(
  db: Database,
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  return membership?.role ?? null;
}

export async function assertProjectRole(
  db: Database,
  userId: string,
  projectId: string,
  allowedRoles: readonly ProjectRole[],
): Promise<ProjectRole> {
  const role = await getUserProjectRole(db, userId, projectId);
  if (!role || !allowedRoles.includes(role)) {
    throw new AppError(
      403,
      ERROR_CODES.PROJECT_ACCESS_DENIED,
      'You do not have sufficient permissions for this project.',
    );
  }
  return role;
}

export async function authenticateAgent(
  db: Database,
  rawBearerToken: string,
): Promise<AuthAgent | null> {
  const tokenHash = sha256(rawBearerToken);
  const rows = await db
    .select({
      id: agents.id,
      ownerUserId: agents.ownerUserId,
      name: agents.name,
      scopes: agents.scopes,
      projectScopeMode: agents.projectScopeMode,
      allowedProjectIds: agents.allowedProjectIds,
      ownerActive: users.isActive,
    })
    .from(agents)
    .innerJoin(users, eq(agents.ownerUserId, users.id))
    .where(
      and(
        eq(agents.tokenHash, tokenHash),
        eq(agents.isActive, true),
        isNull(agents.revokedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.ownerActive) {
    return null;
  }

  await db
    .update(agents)
    .set({ lastUsedAt: new Date() })
    .where(eq(agents.id, row.id));

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    scopes: row.scopes,
    projectScopeMode: row.projectScopeMode,
    allowedProjectIds: row.allowedProjectIds,
  };
}

export function assertAgentScope(agent: AuthAgent, requiredScope: AgentScope): void {
  if (!agent.scopes.includes(requiredScope)) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN_SCOPE,
      `Agent "${agent.name}" does not have required scope "${requiredScope}".`,
    );
  }
}

/**
 * Enforces both agent-level project scope restrictions AND owner's project role
 * so an agent can never escalate beyond its owner's permissions.
 */
export async function assertAgentProjectAccess(
  db: Database,
  agent: AuthAgent,
  projectId: string,
  requiredOwnerRoles: readonly ProjectRole[] = ['owner', 'editor', 'reviewer', 'viewer'],
): Promise<ProjectRole> {
  if (
    agent.projectScopeMode === 'selected' &&
    !agent.allowedProjectIds.includes(projectId)
  ) {
    throw new AppError(
      403,
      ERROR_CODES.PROJECT_ACCESS_DENIED,
      `Agent "${agent.name}" is not allowed to access project "${projectId}".`,
    );
  }

  return assertProjectRole(db, agent.ownerUserId, projectId, requiredOwnerRoles);
}

export async function createAgentToken(
  db: Database,
  params: {
    ownerUserId: string;
    name: string;
    description?: string;
    scopes?: AgentScope[];
    projectScopeMode?: ProjectScopeMode;
    allowedProjectIds?: string[];
  },
): Promise<{
  agent: typeof agents.$inferSelect;
  rawToken: string;
}> {
  const scopes = params.scopes ?? [...DEFAULT_AGENT_SCOPES];
  const projectScopeMode = params.projectScopeMode ?? 'selected';
  const allowedProjectIds = params.allowedProjectIds ?? [];

  if (projectScopeMode === 'selected' && allowedProjectIds.length > 0) {
    const memberships = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, params.ownerUserId),
          inArray(projectMembers.projectId, allowedProjectIds),
        ),
      );
    const accessible = new Set(memberships.map((m) => m.projectId));
    const denied = allowedProjectIds.filter((id) => !accessible.has(id));
    if (denied.length > 0) {
      throw new AppError(
        403,
        ERROR_CODES.PROJECT_ACCESS_DENIED,
        `Cannot grant agent access to projects you do not belong to: ${denied.join(', ')}`,
      );
    }
  }

  const { rawToken, tokenHash, tokenPrefix } = generateAgentToken();

  const [created] = await db
    .insert(agents)
    .values({
      ownerUserId: params.ownerUserId,
      name: params.name.trim(),
      description: params.description,
      tokenHash,
      tokenPrefix,
      scopes,
      projectScopeMode,
      allowedProjectIds,
    })
    .returning();

  if (!created) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create agent token.');
  }

  return { agent: created, rawToken };
}

export async function revokeAgentToken(
  db: Database,
  ownerUserId: string,
  agentId: string,
): Promise<void> {
  const [updated] = await db
    .update(agents)
    .set({ isActive: false, revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.ownerUserId, ownerUserId)))
    .returning({ id: agents.id });

  if (!updated) {
    throw new AppError(404, 'NOT_FOUND', 'Agent not found.');
  }
}

export async function createProjectAsUser(
  db: Database,
  params: {
    userId: string;
    name: string;
    slug: string;
    description?: string;
    icon?: string;
    defaultApprovalPolicy?: ApprovalPolicy;
  },
): Promise<Project> {
  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          name: params.name.trim(),
          slug: params.slug.trim().toLowerCase(),
          description: params.description,
          icon: params.icon,
          defaultApprovalPolicy: params.defaultApprovalPolicy ?? 'strict',
          createdByUserId: params.userId,
        })
        .returning();

      if (!project) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create project.');
      }

      await tx.insert(projectMembers).values({
        projectId: project.id,
        userId: params.userId,
        role: 'owner',
      });

      return project;
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError(409, 'SLUG_ALREADY_EXISTS', `Project slug "${params.slug}" already exists.`);
    }
    throw err;
  }
}

/**
 * Allows an AI agent to create a project ONLY when `projects:create` scope is explicitly granted.
 * Automatically adds the owner as `owner` and grants the agent access to the newly created project.
 */
export async function createProjectAsAgent(
  db: Database,
  agent: AuthAgent,
  params: {
    name: string;
    slug: string;
    description?: string;
    icon?: string;
    defaultApprovalPolicy?: ApprovalPolicy;
  },
): Promise<Project> {
  assertAgentScope(agent, 'projects:create');

  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          name: params.name.trim(),
          slug: params.slug.trim().toLowerCase(),
          description: params.description,
          icon: params.icon,
          defaultApprovalPolicy: params.defaultApprovalPolicy ?? 'strict',
          createdByUserId: agent.ownerUserId,
          createdByAgentId: agent.id,
        })
        .returning();

      if (!project) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create project.');
      }

      await tx.insert(projectMembers).values({
        projectId: project.id,
        userId: agent.ownerUserId,
        role: 'owner',
      });

      if (agent.projectScopeMode === 'selected') {
        const nextAllowed = Array.from(new Set([...agent.allowedProjectIds, project.id]));
        await tx
          .update(agents)
          .set({ allowedProjectIds: nextAllowed, updatedAt: new Date() })
          .where(eq(agents.id, agent.id));
        agent.allowedProjectIds = nextAllowed;
      }

      return project;
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError(409, 'SLUG_ALREADY_EXISTS', `Project slug "${params.slug}" already exists.`);
    }
    throw err;
  }
}
