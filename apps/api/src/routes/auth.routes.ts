import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Database } from '@docalaizer/db';
import {
  type AppVariables,
  SESSION_COOKIE_NAME,
  requireUser,
} from '../middleware/auth';
import {
  loginUser,
  logoutSession,
  registerUser,
} from '../services/auth.service';
import {
  createLocugardSession,
  getLocugardLoginOptions,
  getLocugardProfile,
  LOCUGARD_CSRF_COOKIE,
  LOCUGARD_SESSION_COOKIE,
  logoutLocugard,
  type LocugardConfig,
  verifyLocugardLogin,
} from '../services/locugard.service';

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const locugardVerifySchema = z.object({
  challengeId: z.string().min(1).max(200),
  credential: z.record(z.unknown()),
});

export function createAuthRoutes(deps: {
  db: Database;
  allowPublicSignup: boolean;
  locugard?: LocugardConfig;
}) {
  const router = new Hono<{ Variables: AppVariables }>();

  router.get('/providers', (c) => {
    return c.json({ providers: { locugard: { enabled: Boolean(deps.locugard) } } });
  });

  router.post('/locugard/login/options', async (c) => {
    if (!deps.locugard) {
      return c.json({ error: { code: 'LOCUGARD_NOT_CONFIGURED' } }, 404);
    }
    const options = await getLocugardLoginOptions(deps.locugard);
    return c.json(options);
  });

  router.post('/locugard/login/verify', async (c) => {
    if (!deps.locugard) {
      return c.json({ error: { code: 'LOCUGARD_NOT_CONFIGURED' } }, 404);
    }
    const body = locugardVerifySchema.parse(await c.req.json());
    const verified = await verifyLocugardLogin(deps.locugard, body);
    const profile = await getLocugardProfile(deps.locugard, verified.sessionToken);
    if (profile.account_id !== verified.data.account_id) {
      return c.json({ error: { code: 'LOCUGARD_AUTH_FAILED' } }, 401);
    }
    const result = await createLocugardSession(deps.db, profile, verified.maxAgeSeconds);

    setCookie(c, SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: result.expiresAt,
    });
    setCookie(c, LOCUGARD_SESSION_COOKIE, verified.sessionToken, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/',
      expires: result.expiresAt,
    });
    setCookie(c, LOCUGARD_CSRF_COOKIE, verified.data.csrf_token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/',
      expires: result.expiresAt,
    });
    return c.json({ user: result.user });
  });

  router.post('/register', async (c) => {
    const body = registerSchema.parse(await c.req.json());
    const result = await registerUser(deps.db, {
      ...body,
      allowPublicSignup: deps.allowPublicSignup,
    });

    setCookie(c, SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: result.expiresAt,
    });

    return c.json({ user: result.user }, 201);
  });

  router.post('/login', async (c) => {
    const body = loginSchema.parse(await c.req.json());
    const result = await loginUser(deps.db, body);

    setCookie(c, SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: result.expiresAt,
    });

    return c.json({ user: result.user }, 200);
  });

  router.post('/logout', requireUser(deps.db), async (c) => {
    const token = c.get('sessionToken');
    const locugardToken = getCookie(c, LOCUGARD_SESSION_COOKIE);
    const locugardCsrf = getCookie(c, LOCUGARD_CSRF_COOKIE);
    if (deps.locugard && locugardToken && locugardCsrf) {
      await logoutLocugard(deps.locugard, locugardToken, locugardCsrf).catch(() => undefined);
    }
    if (token) {
      await logoutSession(deps.db, token);
    }
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    deleteCookie(c, LOCUGARD_SESSION_COOKIE, { path: '/' });
    deleteCookie(c, LOCUGARD_CSRF_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  router.get('/me', requireUser(deps.db), (c) => {
    return c.json({ user: c.get('user') });
  });

  return router;
}
