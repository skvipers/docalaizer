import { relations } from 'drizzle-orm';
import { agents } from './agents';
import { documents, proposalOps, proposals, revisions } from './documents';
import { projectMembers, projects } from './projects';
import { sessions, users } from './users';

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  agents: many(agents),
  projectMemberships: many(projectMembers),
  createdProjects: many(projects),
  authoredRevisions: many(revisions),
  reviewedProposals: many(proposals),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  owner: one(users, {
    fields: [agents.ownerUserId],
    references: [users.id],
  }),
  createdProjects: many(projects),
  authoredRevisions: many(revisions),
  proposals: many(proposals),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [projects.createdByUserId],
    references: [users.id],
  }),
  createdByAgent: one(agents, {
    fields: [projects.createdByAgentId],
    references: [agents.id],
  }),
  members: many(projectMembers),
  documents: many(documents),
  proposals: many(proposals),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  project: one(projects, {
    fields: [documents.projectId],
    references: [projects.id],
  }),
  parent: one(documents, {
    fields: [documents.parentId],
    references: [documents.id],
    relationName: 'document_tree',
  }),
  children: many(documents, {
    relationName: 'document_tree',
  }),
  headRevision: one(revisions, {
    fields: [documents.headRevisionId],
    references: [revisions.id],
    relationName: 'document_head_revision',
  }),
  revisions: many(revisions, {
    relationName: 'document_revisions',
  }),
  proposals: many(proposals),
}));

export const revisionsRelations = relations(revisions, ({ one }) => ({
  document: one(documents, {
    fields: [revisions.documentId],
    references: [documents.id],
    relationName: 'document_revisions',
  }),
  parentRevision: one(revisions, {
    fields: [revisions.parentRevisionId],
    references: [revisions.id],
  }),
  authorUser: one(users, {
    fields: [revisions.authorUserId],
    references: [users.id],
  }),
  authorAgent: one(agents, {
    fields: [revisions.authorAgentId],
    references: [agents.id],
  }),
  proposal: one(proposals, {
    fields: [revisions.proposalId],
    references: [proposals.id],
    relationName: 'revision_proposal',
  }),
}));

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  project: one(projects, {
    fields: [proposals.projectId],
    references: [projects.id],
  }),
  document: one(documents, {
    fields: [proposals.documentId],
    references: [documents.id],
  }),
  baseRevision: one(revisions, {
    fields: [proposals.baseRevisionId],
    references: [revisions.id],
  }),
  agent: one(agents, {
    fields: [proposals.agentId],
    references: [agents.id],
  }),
  reviewedByUser: one(users, {
    fields: [proposals.reviewedByUserId],
    references: [users.id],
  }),
  ops: many(proposalOps),
}));

export const proposalOpsRelations = relations(proposalOps, ({ one }) => ({
  proposal: one(proposals, {
    fields: [proposalOps.proposalId],
    references: [proposals.id],
  }),
}));
