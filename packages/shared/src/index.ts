export const PROJECT_ROLES = ['owner', 'editor', 'reviewer', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const AGENT_SCOPES = [
  'projects:read',
  'projects:create',
  'docs:read',
  'docs:create',
  'docs:propose',
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const PROJECT_SCOPE_MODES = ['all_owner_projects', 'selected'] as const;
export type ProjectScopeMode = (typeof PROJECT_SCOPE_MODES)[number];

export const APPROVAL_POLICIES = ['strict', 'protect_human', 'auto_new_docs'] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const PROPOSAL_STATUSES = [
  'pending',
  'partially_approved',
  'approved',
  'rejected',
  'superseded',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const CONFLICT_STATES = [
  'clean',
  'human_protected',
  'locked',
  'stale_conflict',
  'risky_delete',
] as const;
export type ConflictState = (typeof CONFLICT_STATES)[number];

export const OPERATION_DECISIONS = ['pending', 'accepted', 'rejected', 'edited'] as const;
export type OperationDecision = (typeof OPERATION_DECISIONS)[number];

export const ERROR_CODES = {
  FORBIDDEN_SCOPE: 'FORBIDDEN_SCOPE',
  PROJECT_ACCESS_DENIED: 'PROJECT_ACCESS_DENIED',
  CHART_VALIDATION_ERROR: 'CHART_VALIDATION_ERROR',
  BASE_REVISION_NOT_FOUND: 'BASE_REVISION_NOT_FOUND',
  BLOCK_LOCKED_WARNING: 'BLOCK_LOCKED_WARNING',
  HEAD_REVISION_CONFLICT: 'HEAD_REVISION_CONFLICT',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
