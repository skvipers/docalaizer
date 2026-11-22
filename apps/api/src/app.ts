import { Hono } from 'hono';
import { cors } from 'hono/cors';

export function createApp() {
  const app = new Hono();

  app.use('*', cors());

  app.get('/health', (c) => {
    return c.json({ status: 'ok', service: 'docalaizer-api' });
  });

  app.get('/api/v1/health', (c) => {
    return c.json({ status: 'ok', version: 'v1' });
  });

  app.post('/mcp', (c) => {
    return c.json(
      {
        error: 'MCP_NOT_INITIALIZED',
        message: 'MCP Streamable HTTP endpoint skeleton is ready; tools will be wired in Stage 1.',
      },
      501,
    );
  });

  return app;
}
