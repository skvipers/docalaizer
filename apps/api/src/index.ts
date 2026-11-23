import { serve } from '@hono/node-server';
import { createDb } from '@docalaizer/db';
import { createApp } from './app';

const port = Number(process.env.API_PORT ?? 3001);
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://docalaizer:docalaizer_dev@localhost:5439/docalaizer';
const allowPublicSignup = process.env.ALLOW_PUBLIC_SIGNUP === 'true';
const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const { db, pool } = createDb(databaseUrl);
const app = createApp({ db, allowPublicSignup, allowedOrigins });

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
