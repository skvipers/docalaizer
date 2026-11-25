import { serve } from '@hono/node-server';
import { createDb } from '@docalaizer/db';
import { createApp } from './app';
import { locugardConfigFromEnv } from './services/locugard.service';

const port = Number(process.env.API_PORT ?? 3001);
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://docalaizer:docalaizer_dev@localhost:5439/docalaizer';
const allowPublicSignup = process.env.ALLOW_PUBLIC_SIGNUP === 'true';
const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const appBaseUrl = process.env.APP_BASE_URL ?? allowedOrigins[0] ?? 'http://localhost:3000';

const { db, pool } = createDb(databaseUrl);
const app = createApp({
  db,
  allowPublicSignup,
  allowedOrigins,
  appBaseUrl,
  locugard: locugardConfigFromEnv(),
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Docalaizer API listening on http://localhost:${info.port}`);
});

const shutdown = () => {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
