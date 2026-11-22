import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_POLICIES,
  CONFLICT_STATES,
  OPERATION_DECISIONS,
  PROJECT_ROLES,
  PROJECT_SCOPE_MODES,
  PROPOSAL_STATUSES,
} from '@docalaizer/shared';
import {
  DEFAULT_AGENT_SCOPES,
  agents,
  approvalPolicyEnum,
  conflictStateEnum,
  documents,
  operationDecisionEnum,
  projectMembers,
  projectRoleEnum,
  projectScopeModeEnum,
  projects,
  proposalOps,
  proposalStatusEnum,
  proposals,
  revisions,
  sessions,
  users,
} from './schema';

describe('PostgreSQL Drizzle schema', () => {
  it('keeps DB enums synchronized with @docalaizer/shared constants', () => {
    expect(projectRoleEnum.enumValues).toEqual([...PROJECT_ROLES]);
    expect(projectScopeModeEnum.enumValues).toEqual([...PROJECT_SCOPE_MODES]);
    expect(approvalPolicyEnum.enumValues).toEqual([...APPROVAL_POLICIES]);
    expect(proposalStatusEnum.enumValues).toEqual([...PROPOSAL_STATUSES]);
    expect(conflictStateEnum.enumValues).toEqual([...CONFLICT_STATES]);
    expect(operationDecisionEnum.enumValues).toEqual([...OPERATION_DECISIONS]);
  });

  it('enforces security invariants on agents defaults (no projects:create by default, hashed tokens)', () => {
    expect(DEFAULT_AGENT_SCOPES).not.toContain('projects:create');

    const agentsConfig = getTableConfig(agents);
    const columnNames = agentsConfig.columns.map((c) => c.name);
    expect(columnNames).toContain('token_hash');
    expect(columnNames).toContain('token_prefix');
    expect(columnNames).not.toContain('token');

    const projectScopeCol = agentsConfig.columns.find((c) => c.name === 'project_scope_mode');
    expect(projectScopeCol?.default).toBe('selected');
  });

  it('defines required indexes and constraints for documents, revisions, and proposals', () => {
    const docsConfig = getTableConfig(documents);
    expect(docsConfig.indexes.map((i) => i.config.name)).toEqual(
      expect.arrayContaining([
        'documents_project_slug_uidx',
        'documents_project_parent_sort_idx',
        'documents_head_revision_id_idx',
      ]),
    );

    const revisionsConfig = getTableConfig(revisions);
    const revIndexMap = new Map(revisionsConfig.indexes.map((i) => [i.config.name, i.config]));
    expect(revIndexMap.get('revisions_document_number_uidx')?.unique).toBe(true);
    expect(revIndexMap.get('revisions_search_vector_idx')?.method).toBe('gin');

    const proposalsConfig = getTableConfig(proposals);
    const idempotencyIdx = proposalsConfig.indexes.find(
      (i) => i.config.name === 'proposals_agent_doc_idempotency_uidx',
    );
    expect(idempotencyIdx?.config.unique).toBe(true);
    expect(idempotencyIdx?.config.where).toBeDefined();

    const opsConfig = getTableConfig(proposalOps);
    expect(opsConfig.indexes.map((i) => i.config.name)).toContain(
      'proposal_ops_proposal_order_uidx',
    );
  });

  it('uses strict approval policy by default on projects and composite PK on project_members', () => {
    const projectsConfig = getTableConfig(projects);
    const policyCol = projectsConfig.columns.find((c) => c.name === 'default_approval_policy');
    expect(policyCol?.default).toBe('strict');

    const membersConfig = getTableConfig(projectMembers);
    expect(membersConfig.primaryKeys).toHaveLength(1);
    expect(membersConfig.primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      'project_id',
      'user_id',
    ]);

    const usersConfig = getTableConfig(users);
    const sessionsConfig = getTableConfig(sessions);
    expect(usersConfig.name).toBe('users');
    expect(sessionsConfig.foreignKeys).toHaveLength(1);
  });
});
