import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
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

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function createAuthRoutes(deps: { db: Database; allowPublicSignup: boolean }) {
  const router = new Hono<{ Variables: AppVariables }>();

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
    if (token) {
      await logoutSession(deps.db, token);
    }
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return c.json({ ok: true });
  });

  router.get('/me', requireUser(deps.db), (c) => {
    return c.json({ user: c.get('user') });
  });

  return router;
}
