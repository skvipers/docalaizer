import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { BlockType, DocumentBlock } from '@docalaizer/core';
import { agents } from './agents';
import {
  approvalPolicyEnum,
  conflictStateEnum,
  operationDecisionEnum,
  proposalOpTypeEnum,
  proposalStatusEnum,
  revisionAuthorTypeEnum,
} from './enums';
import { projects } from './projects';
import { users } from './users';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export interface ProposalMetadataChanges {
  title?: string;
  slug?: string;
  parentId?: string | null;
  icon?: string | null;
}

export interface ProposalBlockPayload {
  id?: string;
  type: BlockType;
  title?: string;
  content: DocumentBlock['content'];
}

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => documents.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    icon: text('icon'),
    headRevisionId: uuid('head_revision_id').references((): AnyPgColumn => revisions.id, {
      onDelete: 'set null',
    }),
    approvalPolicyOverride: approvalPolicyEnum('approval_policy_override'),
    isDraft: boolean('is_draft').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('documents_project_slug_uidx').on(table.projectId, table.slug),
    index('documents_project_parent_sort_idx').on(
      table.projectId,
      table.parentId,
      table.sortOrder,
    ),
    index('documents_head_revision_id_idx').on(table.headRevisionId),
  ],
);

export const revisions = pgTable(
  'revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    parentRevisionId: uuid('parent_revision_id').references((): AnyPgColumn => revisions.id, {
      onDelete: 'set null',
    }),
    revisionNumber: integer('revision_number').notNull(),
    authorType: revisionAuthorTypeEnum('author_type').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    authorAgentId: uuid('author_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    proposalId: uuid('proposal_id').references((): AnyPgColumn => proposals.id, {
      onDelete: 'set null',
    }),
    summary: text('summary'),
    blocksSnapshot: jsonb('blocks_snapshot').$type<DocumentBlock[]>().notNull(),
    searchVector: tsvector('search_vector'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('revisions_document_number_uidx').on(table.documentId, table.revisionNumber),
    index('revisions_document_created_idx').on(table.documentId, table.createdAt),
    index('revisions_search_vector_idx').using('gin', table.searchVector),
  ],
);

export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    baseRevisionId: uuid('base_revision_id').references(() => revisions.id, {
      onDelete: 'set null',
    }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key'),
    title: text('title').notNull(),
    rationale: text('rationale'),
    metadataChanges: jsonb('metadata_changes').$type<ProposalMetadataChanges | null>(),
    status: proposalStatusEnum('status').notNull().default('pending'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('proposals_agent_doc_idempotency_uidx')
      .on(table.agentId, table.documentId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index('proposals_project_status_created_idx').on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    index('proposals_document_status_idx').on(table.documentId, table.status),
  ],
);

export const proposalOps = pgTable(
  'proposal_ops',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    opOrder: integer('op_order').notNull(),
    opType: proposalOpTypeEnum('op_type').notNull(),
    targetBlockId: text('target_block_id'),
    afterBlockId: text('after_block_id'),
    expectedHash: text('expected_hash'),
    newBlockPayload: jsonb('new_block_payload').$type<ProposalBlockPayload | null>(),
    conflictState: conflictStateEnum('conflict_state').notNull().default('clean'),
    decision: operationDecisionEnum('decision').notNull().default('pending'),
    humanEditedPayload: jsonb('human_edited_payload').$type<ProposalBlockPayload | null>(),
    reviewComment: text('review_comment'),
  },
  (table) => [
    uniqueIndex('proposal_ops_proposal_order_uidx').on(table.proposalId, table.opOrder),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Revision = typeof revisions.$inferSelect;
export type NewRevision = typeof revisions.$inferInsert;
export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
export type ProposalOp = typeof proposalOps.$inferSelect;
export type NewProposalOp = typeof proposalOps.$inferInsert;
