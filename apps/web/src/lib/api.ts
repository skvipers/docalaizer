import type { DocumentBlock, ProposalBlockPayload } from '@docalaizer/core';
import type {
  AgentScope,
  ApprovalPolicy,
  ConflictState,
  OperationDecision,
  ProjectRole,
  ProjectScopeMode,
  ProposalStatus,
} from '@docalaizer/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!res.ok) {
        throw new ApiClientError(res.status, 'HTTP_ERROR', text.slice(0, 300));
      }
    }
  }

  if (!res.ok) {
    const errObj = (data.error ?? {}) as {
      code?: string;
      message?: string;
      details?: unknown;
    };
    throw new ApiClientError(
      res.status,
      errObj.code ?? 'HTTP_ERROR',
      errObj.message ?? `Request failed with status ${res.status}`,
      errObj.details,
    );
  }

  return data as T;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  globalRole: 'admin' | 'member';
}

export interface ProjectDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  defaultApprovalPolicy: ApprovalPolicy;
  createdAt: string;
}

export interface ProjectListItemDto {
  project: ProjectDto;
  role: ProjectRole;
  pendingProposalsCount: number;
}

export interface DocumentTreeItemDto {
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
  updatedAt: string;
}

export interface RevisionDto {
  id: string;
  documentId: string;
  parentRevisionId: string | null;
  revisionNumber: number;
  authorType: 'human' | 'ai' | 'merge';
  authorUserId: string | null;
  authorAgentId: string | null;
  proposalId: string | null;
  summary: string | null;
  blocksSnapshot: DocumentBlock[];
  createdAt: string;
}

export interface DocumentDetailDto {
  document: DocumentTreeItemDto & { approvalPolicyOverride: ApprovalPolicy | null };
  headRevision: RevisionDto | null;
  pendingProposalsCount: number;
}

export interface ProposalInboxItemDto {
  proposal: {
    id: string;
    projectId: string;
    documentId: string;
    baseRevisionId: string | null;
    agentId: string;
    title: string;
    rationale: string | null;
    status: ProposalStatus;
    createdAt: string;
    reviewedAt: string | null;
  };
  documentTitle: string;
  documentSlug: string;
  projectName: string;
  projectSlug: string;
  agentName: string;
}

export interface ProposalDetailOpDto {
  row: {
    id: string;
    opOrder: number;
    opType: 'insert' | 'update' | 'delete' | 'move';
    targetBlockId: string | null;
    afterBlockId: string | null;
    newBlockPayload: ProposalBlockPayload | null;
    conflictState: ConflictState;
    decision: OperationDecision;
    humanEditedPayload: ProposalBlockPayload | null;
    reviewComment: string | null;
  };
  liveConflictState: ConflictState;
  defaultDecision: 'accepted' | 'rejected';
  canApply: boolean;
  reasons: string[];
  baseBlock: DocumentBlock | null;
  headBlock: DocumentBlock | null;
}

export interface ProposalDetailDto {
  proposal: ProposalInboxItemDto['proposal'];
  document: DocumentTreeItemDto;
  userRole?: ProjectRole;
  ops: ProposalDetailOpDto[];
  summary: {
    total_ops: number;
    clean: number;
    human_protected: number;
    locked: number;
    stale_conflict: number;
    risky_delete: number;
  };
}

export interface AgentDto {
  id: string;
  name: string;
  description: string | null;
  tokenPrefix: string;
  scopes: AgentScope[];
  projectScopeMode: ProjectScopeMode;
  allowedProjectIds: string[];
  isActive: boolean;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ProjectMemberDto {
  userId: string;
  email: string;
  name: string;
  role: ProjectRole;
  createdAt: string;
}

export interface SearchResultDto {
  documentId: string;
  projectId: string;
  slug: string;
  title: string;
  icon: string | null;
  updatedAt: string;
}

export const api = {
  getApiBaseUrl: () => API_BASE,

  me: () => request<{ user: AuthUser }>('/api/v1/auth/me'),
  getAuthProviders: () =>
    request<{ providers: { locugard: { enabled: boolean } } }>('/api/v1/auth/providers'),
  getLocugardLoginOptions: () =>
    request<{ challenge_id: string; options: Record<string, unknown> }>(
      '/api/v1/auth/locugard/login/options',
      { method: 'POST' },
    ),
  verifyLocugardLogin: (body: { challengeId: string; credential: Record<string, unknown> }) =>
    request<{ user: AuthUser }>('/api/v1/auth/locugard/login/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{ user: AuthUser }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  register: (body: { email: string; name: string; password: string }) =>
    request<{ user: AuthUser }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logout: () => request<{ ok: true }>('/api/v1/auth/logout', { method: 'POST' }),

  listProjects: () => request<{ projects: ProjectListItemDto[] }>('/api/v1/projects'),
  createProject: (body: {
    name: string;
    slug: string;
    description?: string;
    icon?: string;
    defaultApprovalPolicy?: ApprovalPolicy;
  }) =>
    request<{ project: ProjectDto }>('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProject: (
    projectId: string,
    body: {
      name?: string;
      description?: string | null;
      icon?: string | null;
      defaultApprovalPolicy?: ApprovalPolicy;
    },
  ) =>
    request<{ project: ProjectDto }>(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listProjectMembers: (projectId: string) =>
    request<{ members: ProjectMemberDto[] }>(`/api/v1/projects/${projectId}/members`),
  addProjectMember: (projectId: string, body: { email: string; role: ProjectRole }) =>
    request<{ member: { projectId: string; userId: string; role: ProjectRole } }>(
      `/api/v1/projects/${projectId}/members`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  updateProjectMemberRole: (projectId: string, userId: string, role: ProjectRole) =>
    request<{ member: { projectId: string; userId: string; role: ProjectRole } }>(
      `/api/v1/projects/${projectId}/members/${userId}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    ),
  removeProjectMember: (projectId: string, userId: string) =>
    request<{ ok: true }>(`/api/v1/projects/${projectId}/members/${userId}`, {
      method: 'DELETE',
    }),

  getProjectTree: (projectId: string) =>
    request<{ documents: DocumentTreeItemDto[] }>(`/api/v1/projects/${projectId}/tree`),
  createDoc: (
    projectId: string,
    body: {
      parentId?: string | null;
      slug: string;
      title: string;
      icon?: string;
      blocks: ProposalBlockPayload[];
    },
  ) =>
    request<{ document: DocumentTreeItemDto; revision: RevisionDto }>(
      `/api/v1/projects/${projectId}/docs`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  searchDocs: (q: string, projectId?: string) => {
    const params = new URLSearchParams({ q });
    if (projectId) params.set('projectId', projectId);
    return request<{ results: SearchResultDto[] }>(`/api/v1/docs/search?${params.toString()}`);
  },
  getDoc: (docId: string) => request<DocumentDetailDto>(`/api/v1/docs/${docId}`),
  updateDoc: (
    docId: string,
    body: {
      expectedHeadRevisionId: string;
      proposedBlocks: ProposalBlockPayload[];
      title?: string;
      icon?: string | null;
      summary?: string;
    },
  ) =>
    request<{ document: DocumentTreeItemDto; revision: RevisionDto }>(`/api/v1/docs/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  updateBlockProtection: (
    docId: string,
    blockId: string,
    body: { lockedByHuman?: boolean; humanTouched?: boolean },
  ) =>
    request<{ document: DocumentTreeItemDto; revision: RevisionDto }>(
      `/api/v1/docs/${docId}/blocks/${blockId}/protection`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  getDocRevisions: (docId: string) =>
    request<{ revisions: RevisionDto[] }>(`/api/v1/docs/${docId}/revisions`),
  rollbackDoc: (docId: string, body: { targetRevisionId: string; blockId?: string }) =>
    request<{ document: DocumentTreeItemDto; revision: RevisionDto }>(
      `/api/v1/docs/${docId}/rollback`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listProposals: (filters: { projectId?: string; status?: ProposalStatus } = {}) => {
    const params = new URLSearchParams();
    if (filters.projectId) params.set('projectId', filters.projectId);
    if (filters.status) params.set('status', filters.status);
    const qs = params.toString();
    return request<{ proposals: ProposalInboxItemDto[] }>(
      `/api/v1/proposals${qs ? `?${qs}` : ''}`,
    );
  },
  getProposal: (proposalId: string) =>
    request<ProposalDetailDto>(`/api/v1/proposals/${proposalId}`),
  reviewProposal: (
    proposalId: string,
    body: {
      decisions: Array<{
        opId: string;
        decision: 'accepted' | 'rejected' | 'edited';
        humanEditedPayload?: ProposalBlockPayload;
        reviewComment?: string;
        forceResolveStale?: boolean;
      }>;
    },
  ) =>
    request<{
      proposal: ProposalInboxItemDto['proposal'];
      revision: RevisionDto | null;
      appliedCount: number;
      rejectedCount: number;
    }>(`/api/v1/proposals/${proposalId}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listAgents: () => request<{ agents: AgentDto[] }>('/api/v1/agents'),
  createAgent: (body: {
    name: string;
    description?: string;
    scopes: AgentScope[];
    projectScopeMode: ProjectScopeMode;
    allowedProjectIds: string[];
  }) =>
    request<{ agent: AgentDto; token: string }>('/api/v1/agents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  revokeAgent: (agentId: string) =>
    request<{ ok: true }>(`/api/v1/agents/${agentId}/revoke`, { method: 'POST' }),
};
