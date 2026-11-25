import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { CoreMergeError } from '@docalaizer/core';
import type { Database } from '@docalaizer/db';
import { AppError } from './errors';
import { handleMcpHttpRequest } from './mcp/server';
import { type AppVariables, requireAgent } from './middleware/auth';
import { createRateLimiter, getClientIp } from './middleware/rate-limit';
import { sha256 } from './security/crypto';
import type { LocugardConfig } from './services/locugard.service';
import { createAgentsRoutes } from './routes/agents.routes';
import { createAuthRoutes } from './routes/auth.routes';
import { createDocsRoutes } from './routes/docs.routes';
import { createProjectsRoutes } from './routes/projects.routes';
import { createProposalsRoutes } from './routes/proposals.routes';

export interface CreateAppOptions {
  db?: Database;
  allowPublicSignup?: boolean;
  allowedOrigins?: string[];
  appBaseUrl?: string;
  locugard?: LocugardConfig;
  disableRateLimit?: boolean;
}

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const AUTH_BODY_LIMIT_BYTES = 64 * 1024; // 64 KB
const DEFAULT_BODY_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<{ Variables: AppVariables }>();
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  const appBaseUrl = options.appBaseUrl ?? options.allowedOrigins?.[0] ?? 'http://localhost:3000';

  app.use('*', async (c, next) => {
    if (options.locugard) c.set('locugard', options.locugard);
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  });

  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return '';
        return allowedOrigins.has(origin) ? origin : '';
      },
      credentials: true,
    }),
  );

  const onBodyLimit = (c: { json: (body: unknown, status: 413) => Response }) =>
    c.json(
      {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds allowed size limit.',
        },
      },
      413,
    );

  app.use('/api/v1/auth/*', bodyLimit({ maxSize: AUTH_BODY_LIMIT_BYTES, onError: onBodyLimit }));
  app.use('/api/v1/*', bodyLimit({ maxSize: DEFAULT_BODY_LIMIT_BYTES, onError: onBodyLimit }));
  app.use('/mcp', bodyLimit({ maxSize: DEFAULT_BODY_LIMIT_BYTES, onError: onBodyLimit }));

  if (!options.disableRateLimit) {
    app.use(
      '/api/v1/auth/*',
      createRateLimiter({
        windowMs: 60_000,
        maxRequests: 30,
        keyPrefix: 'auth',
      }),
    );
    app.use(
      '/mcp',
      createRateLimiter({
        windowMs: 60_000,
        maxRequests: 120,
        keyPrefix: 'mcp',
        keyGenerator: (c) => {
          const auth = c.req.header('authorization');
          if (auth) return `tok:${sha256(auth).slice(0, 16)}`;
          return `ip:${getClientIp(c)}`;
        },
      }),
    );
    app.use(
      '/api/v1/*',
      createRateLimiter({
        windowMs: 60_000,
        maxRequests: 300,
        keyPrefix: 'api',
      }),
    );
  }

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        },
        err.status,
      );
    }

    if (err instanceof CoreMergeError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        },
        409,
      );
    }

    if (err instanceof ZodError) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed.',
            details: err.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
        400,
      );
    }

    console.error('Unhandled API error:', err);
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error.',
        },
      },
      500,
    );
  });

  app.get('/health', async (c) => {
    if (options.db) {
      try {
        await options.db.execute(sql`SELECT 1`);
      } catch {
        return c.json({ status: 'degraded', service: 'docalaizer-api', db: 'error' }, 503);
      }
      return c.json({ status: 'ok', service: 'docalaizer-api', db: 'ok' });
    }
    return c.json({ status: 'ok', service: 'docalaizer-api' });
  });

  app.get('/api/v1/health', async (c) => {
    if (options.db) {
      try {
        await options.db.execute(sql`SELECT 1`);
      } catch {
        return c.json({ status: 'degraded', version: 'v1', db: 'error' }, 503);
      }
      return c.json({ status: 'ok', version: 'v1', db: 'ok' });
    }
    return c.json({ status: 'ok', version: 'v1' });
  });

  if (options.db) {
    const db = options.db;
    app.route(
      '/api/v1/auth',
      createAuthRoutes({
        db,
        allowPublicSignup: options.allowPublicSignup ?? false,
        locugard: options.locugard,
      }),
    );
    app.route('/api/v1/projects', createProjectsRoutes(db));
    app.route('/api/v1/docs', createDocsRoutes(db));
    app.route('/api/v1/proposals', createProposalsRoutes(db));
    app.route('/api/v1/agents', createAgentsRoutes(db));

    app.all('/mcp', requireAgent(db), async (c) => {
      const agent = c.get('agent')!;
      return handleMcpHttpRequest(db, agent, c.req.raw, { appBaseUrl });
    });
  } else {
    app.post('/mcp', (c) => {
      return c.json(
        {
          error: 'MCP_DB_NOT_CONFIGURED',
          message: 'Database is not configured on this app instance.',
        },
        503,
      );
    });
  }

  return app;
}
