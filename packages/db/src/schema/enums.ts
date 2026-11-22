import { pgEnum } from 'drizzle-orm/pg-core';
import {
  APPROVAL_POLICIES,
  CONFLICT_STATES,
  OPERATION_DECISIONS,
  PROJECT_ROLES,
  PROJECT_SCOPE_MODES,
  PROPOSAL_STATUSES,
} from '@docalaizer/shared';

export const GLOBAL_ROLES = ['admin', 'member'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const REVISION_AUTHOR_TYPES = ['human', 'ai', 'merge'] as const;
export type RevisionAuthorType = (typeof REVISION_AUTHOR_TYPES)[number];

export const PROPOSAL_OP_TYPES = ['insert', 'update', 'delete', 'move'] as const;
export type ProposalOpType = (typeof PROPOSAL_OP_TYPES)[number];

export const globalRoleEnum = pgEnum('global_role', GLOBAL_ROLES);
export const projectRoleEnum = pgEnum('project_role', PROJECT_ROLES);
export const projectScopeModeEnum = pgEnum('project_scope_mode', PROJECT_SCOPE_MODES);
export const approvalPolicyEnum = pgEnum('approval_policy', APPROVAL_POLICIES);
export const revisionAuthorTypeEnum = pgEnum('revision_author_type', REVISION_AUTHOR_TYPES);
export const proposalStatusEnum = pgEnum('proposal_status', PROPOSAL_STATUSES);
export const proposalOpTypeEnum = pgEnum('proposal_op_type', PROPOSAL_OP_TYPES);
export const conflictStateEnum = pgEnum('conflict_state', CONFLICT_STATES);
export const operationDecisionEnum = pgEnum('operation_decision', OPERATION_DECISIONS);
