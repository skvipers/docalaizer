import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { CoreMergeError } from '@docalaizer/core';
import type { Database } from '@docalaizer/db';
import { AppError } from './errors';
import { handleMcpHttpRequest } from './mcp/server';
import { type AppVariables, requireAgent } from './middleware/auth';
import { createAgentsRoutes } from './routes/agents.routes';
import { createAuthRoutes } from './routes/auth.routes';
import { createDocsRoutes } from './routes/docs.routes';
import { createProjectsRoutes } from './routes/projects.routes';
import { createProposalsRoutes } from './routes/proposals.routes';

export interface CreateAppOptions {
  db?: Database;
  allowPublicSignup?: boolean;
  allowedOrigins?: string[];
}

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<{ Variables: AppVariables }>();
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);

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

  app.get('/health', (c) => {
    return c.json({ status: 'ok', service: 'docalaizer-api' });
  });

  app.get('/api/v1/health', (c) => {
    return c.json({ status: 'ok', version: 'v1' });
  });

  if (options.db) {
    const db = options.db;
    app.route(
      '/api/v1/auth',
      createAuthRoutes({
        db,
        allowPublicSignup: options.allowPublicSignup ?? false,
      }),
    );
    app.route('/api/v1/projects', createProjectsRoutes(db));
    app.route('/api/v1/docs', createDocsRoutes(db));
    app.route('/api/v1/proposals', createProposalsRoutes(db));
    app.route('/api/v1/agents', createAgentsRoutes(db));

    app.all('/mcp', requireAgent(db), async (c) => {
      const agent = c.get('agent')!;
      return handleMcpHttpRequest(db, agent, c.req.raw);
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
