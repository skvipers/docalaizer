import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createDb, users } from '@docalaizer/db';
import { createApp } from '../app';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://docalaizer:docalaizer_dev@localhost:5439/docalaizer';
const { db, pool } = createDb(DATABASE_URL);
const createdUserIds: string[] = [];

afterAll(async () => {
  try {
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  } finally {
    await pool.end();
  }
});

describe('LocuGard authentication integration', () => {
  it('maps a passkey account, revalidates its session, and logs out upstream', async () => {
    const accountId = `acc_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    let upstreamActive = true;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const path = new URL(url).pathname;
      const headers = new Headers(init?.headers);
      if (path === '/auth/login/options') {
        expect(headers.get('origin')).toBe('https://app.test');
        return Response.json({ challenge_id: 'challenge-1', options: { challenge: 'Y2hhbA' } });
      }
      if (path === '/auth/login/verify') {
        return Response.json(
          {
            account_id: accountId,
            role: 'owner',
            device_id: 'dev_test',
            csrf_token: 'csrf-test',
          },
          {
            headers: {
              'set-cookie':
                '__Host-locugard_sid=upstream-token; Max-Age=3600; Path=/; Secure; HttpOnly',
            },
          },
        );
      }
      if (path === '/api/protected/profile') {
        expect(headers.get('cookie')).toBe('__Host-locugard_sid=upstream-token');
        if (!upstreamActive) return Response.json({ error: 'session_revoked' }, { status: 401 });
        return Response.json({
          account_id: accountId,
          display_name: 'Passkey Owner',
          role: 'owner',
          device_id: 'dev_test',
          effective_mode: 2,
          network_zone: 'lan',
        });
      }
      if (path === '/auth/logout') {
        expect(headers.get('origin')).toBe('https://app.test');
        expect(headers.get('x-csrf-token')).toBe('csrf-test');
        upstreamActive = false;
        return Response.json({ status: 'logged_out' });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    });
    const app = createApp({
      db,
      locugard: {
        baseUrl: 'https://locugard.test',
        expectedOrigin: 'https://app.test',
        fetchFn: fetchMock,
      },
    });

    const providers = await app.request('/api/v1/auth/providers');
    expect(providers.status).toBe(200);
    expect(await providers.json()).toEqual({ providers: { locugard: { enabled: true } } });

    const options = await app.request('/api/v1/auth/locugard/login/options', { method: 'POST' });
    expect(options.status).toBe(200);

    const login = await app.request('/api/v1/auth/locugard/login/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: 'challenge-1', credential: { id: 'credential' } }),
    });
    expect(login.status).toBe(200);
    const loginBody = (await login.json()) as {
      user: { id: string; email: string; name: string; globalRole: string };
    };
    createdUserIds.push(loginBody.user.id);
    expect(loginBody.user).toMatchObject({
      email: `${accountId}@locugard.invalid`,
      name: 'Passkey Owner',
      globalRole: 'member',
    });
    const setCookie = login.headers.get('set-cookie') ?? '';
    const cookies = ['docalaizer_session', 'locugard_session', 'locugard_csrf'].map((name) => {
      const value = setCookie.match(new RegExp(`${name}=([^;]+)`))?.[1];
      expect(value).toBeTruthy();
      return `${name}=${value}`;
    });
    const cookie = cookies.join('; ');

    const me = await app.request('/api/v1/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);

    upstreamActive = false;
    const revoked = await app.request('/api/v1/auth/me', { headers: { cookie } });
    expect(revoked.status).toBe(401);

    upstreamActive = true;
    const logout = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { cookie },
    });
    expect(logout.status).toBe(200);
    expect(upstreamActive).toBe(false);

    const afterLogout = await app.request('/api/v1/auth/me', { headers: { cookie } });
    expect(afterLogout.status).toBe(401);
  });
});
