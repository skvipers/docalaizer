import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('API skeleton', () => {
  it('responds to /health', async () => {
    const app = createApp();
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'docalaizer-api' });
  });

  it('restricts CORS with credentials to explicitly allowed origins', async () => {
    const app = createApp({ allowedOrigins: ['http://localhost:3000'] });

    const allowed = await app.request('/health', {
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');

    const blocked = await app.request('/health', {
      headers: { origin: 'https://evil.example' },
    });
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
  });
});
