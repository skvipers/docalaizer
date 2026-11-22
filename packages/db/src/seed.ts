import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { DocumentBlock } from '@docalaizer/core';
import { createDb } from './index';
import {
  agents,
  documents,
  projectMembers,
  projects,
  revisions,
  users,
} from './schema';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashBlockContent(content: unknown): string {
  return `sha256:${sha256(JSON.stringify(content))}`;
}

async function seed() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgresql://docalaizer:docalaizer_dev@localhost:5432/docalaizer';
  const { db, pool } = createDb(databaseUrl);

  try {
    const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@docalaizer.local').toLowerCase();
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'docalaizer_dev_password';

    let [admin] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
    if (!admin) {
      [admin] = await db
        .insert(users)
        .values({
          email: adminEmail,
          name: 'Docalaizer Admin',
          passwordHash: hashPassword(adminPassword),
          globalRole: 'admin',
        })
        .returning();
      console.log(`Created admin user: ${adminEmail}`);
    }

    if (!admin) {
      throw new Error('Failed to create or find admin user');
    }

    let [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, 'docalaizer-demo'))
      .limit(1);

    if (!project) {
      [project] = await db
        .insert(projects)
        .values({
          slug: 'docalaizer-demo',
          name: 'Docalaizer Demo',
          description: 'Демо-проект с документацией, Mermaid-диаграммой и Vega-Lite графиком',
          icon: '📘',
          defaultApprovalPolicy: 'strict',
          createdByUserId: admin.id,
        })
        .returning();

      if (project) {
        await db
          .insert(projectMembers)
          .values({
            projectId: project.id,
            userId: admin.id,
            role: 'owner',
          })
          .onConflictDoNothing();
        console.log(`Created demo project: ${project.slug}`);
      }
    }

    if (!project) {
      throw new Error('Failed to create or find demo project');
    }

    const existingDocs = await db
      .select()
      .from(documents)
      .where(eq(documents.projectId, project.id));

    if (existingDocs.length === 0) {
      const now = new Date().toISOString();
      const blocks: DocumentBlock[] = [
        {
          id: 'blk_seed_intro',
          type: 'markdown',
          content:
            '# Добро пожаловать в Docalaizer\n\nЭтот блок отредактирован вручную — AI-агенты не смогут перезаписать его без вашего аппрува в Review Inbox.',
          contentHash: hashBlockContent(
            '# Добро пожаловать в Docalaizer\n\nЭтот блок отредактирован вручную — AI-агенты не смогут перезаписать его без вашего аппрува в Review Inbox.',
          ),
          meta: {
            origin: 'human',
            lastEditedByType: 'human',
            lastEditorId: admin.id,
            lastEditedAt: now,
            humanTouched: true,
            lockedByHuman: false,
          },
        },
        {
          id: 'blk_seed_diagram',
          type: 'diagram',
          title: 'Поток аппрува правок AI',
          content: {
            engine: 'mermaid',
            source:
              'flowchart LR\n  Agent[AI Agent] -->|MCP Proposal| Inbox[Review Inbox]\n  Inbox -->|Approve| Main[(Main Revisions)]',
          },
          contentHash: hashBlockContent({
            engine: 'mermaid',
            source:
              'flowchart LR\n  Agent[AI Agent] -->|MCP Proposal| Inbox[Review Inbox]\n  Inbox -->|Approve| Main[(Main Revisions)]',
          }),
          meta: {
            origin: 'ai',
            lastEditedByType: 'ai',
            lastEditorId: 'seed',
            lastEditedAt: now,
            humanTouched: false,
            lockedByHuman: false,
          },
        },
        {
          id: 'blk_seed_chart',
          type: 'chart',
          title: 'Latency p95 (ms)',
          content: {
            engine: 'vega-lite',
            spec: {
              $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
              mark: { type: 'line', point: true },
              encoding: {
                x: { field: 'day', type: 'ordinal', title: 'День' },
                y: { field: 'p95_ms', type: 'quantitative', title: 'p95 (ms)' },
              },
            },
            data: [
              { day: 'Mon', p95_ms: 210 },
              { day: 'Tue', p95_ms: 175 },
              { day: 'Wed', p95_ms: 118 },
            ],
          },
          contentHash: hashBlockContent({
            engine: 'vega-lite',
            spec: {
              $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
              mark: { type: 'line', point: true },
              encoding: {
                x: { field: 'day', type: 'ordinal', title: 'День' },
                y: { field: 'p95_ms', type: 'quantitative', title: 'p95 (ms)' },
              },
            },
            data: [
              { day: 'Mon', p95_ms: 210 },
              { day: 'Tue', p95_ms: 175 },
              { day: 'Wed', p95_ms: 118 },
            ],
          }),
          meta: {
            origin: 'ai',
            lastEditedByType: 'ai',
            lastEditorId: 'seed',
            lastEditedAt: now,
            humanTouched: false,
            lockedByHuman: false,
          },
        },
      ];

      await db.transaction(async (tx) => {
        const [doc] = await tx
          .insert(documents)
          .values({
            projectId: project.id,
            slug: 'overview',
            title: 'Обзор архитектуры',
            icon: '🧭',
            sortOrder: 0,
            isDraft: false,
          })
          .returning();

        if (!doc) {
          throw new Error('Failed to create seed document');
        }

        const [rev] = await tx
          .insert(revisions)
          .values({
            documentId: doc.id,
            revisionNumber: 1,
            authorType: 'human',
            authorUserId: admin.id,
            summary: 'Initial seeded revision',
            blocksSnapshot: blocks,
            searchVector: sql`to_tsvector('simple', ${'Обзор архитектуры Добро пожаловать в Docalaizer'})`,
          })
          .returning();

        if (!rev) {
          throw new Error('Failed to create seed revision');
        }

        await tx
          .update(documents)
          .set({ headRevisionId: rev.id })
          .where(eq(documents.id, doc.id));
      });
      console.log('Created initial demo document with v1 revision.');
    }

    const existingAgents = await db
      .select()
      .from(agents)
      .where(eq(agents.ownerUserId, admin.id));

    if (existingAgents.length === 0) {
      const rawToken = `doca_dev_${randomBytes(24).toString('hex')}`;
      await db.insert(agents).values({
        ownerUserId: admin.id,
        name: 'Local Dev Agent',
        description: 'Тестовый AI-агент (без права projects:create по умолчанию)',
        tokenHash: sha256(rawToken),
        tokenPrefix: rawToken.slice(0, 16),
        projectScopeMode: 'selected',
        allowedProjectIds: [project.id],
      });
      console.log(`Created demo AI agent. Save this token (shown once): ${rawToken}`);
    }
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
