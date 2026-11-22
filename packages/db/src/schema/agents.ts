import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { AgentScope } from '@docalaizer/shared';
import { projectScopeModeEnum } from './enums';
import { users } from './users';

export const DEFAULT_AGENT_SCOPES: AgentScope[] = ['projects:read', 'docs:read', 'docs:propose'];

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    scopes: jsonb('scopes').$type<AgentScope[]>().notNull().default(DEFAULT_AGENT_SCOPES),
    projectScopeMode: projectScopeModeEnum('project_scope_mode').notNull().default('selected'),
    allowedProjectIds: jsonb('allowed_project_ids').$type<string[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('agents_owner_user_id_idx').on(table.ownerUserId)],
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
