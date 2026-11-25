import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Database } from '@docalaizer/db';
import { AppError } from '../errors';
import { type AuthUser, getUserBySessionToken } from '../services/auth.service';
import { type AuthAgent, authenticateAgent } from '../services/rbac.service';
import {
  getLocugardProfile,
  isLocugardEmail,
  LOCUGARD_SESSION_COOKIE,
  locugardEmail,
  type LocugardConfig,
} from '../services/locugard.service';

export const SESSION_COOKIE_NAME = 'docalaizer_session';

export interface AppVariables {
  user?: AuthUser;
  agent?: AuthAgent;
  sessionToken?: string;
  locugard?: LocugardConfig;
}

export function requireUser(db: Database): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!cookieToken) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const user = await getUserBySessionToken(db, cookieToken);
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Session is invalid or expired.');
    }

    if (isLocugardEmail(user.email)) {
      const config = c.get('locugard');
      const locugardToken = getCookie(c, LOCUGARD_SESSION_COOKIE);
      if (!config || !locugardToken) {
        throw new AppError(401, 'UNAUTHORIZED', 'LocuGard session is required.');
      }
      const profile = await getLocugardProfile(config, locugardToken);
      if (locugardEmail(profile.account_id) !== user.email) {
        throw new AppError(401, 'UNAUTHORIZED', 'LocuGard identity does not match the session.');
      }
    }

    c.set('user', user);
    c.set('sessionToken', cookieToken);
    await next();
  };
}

export function requireAgent(db: Database): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Bearer agent token is required.');
    }

    const rawToken = authHeader.slice('Bearer '.length).trim();
    if (!rawToken) {
      throw new AppError(401, 'UNAUTHORIZED', 'Bearer agent token is empty.');
    }

    const agent = await authenticateAgent(db, rawToken);
    if (!agent) {
      throw new AppError(401, 'UNAUTHORIZED', 'Agent token is invalid or revoked.');
    }

    c.set('agent', agent);
    await next();
  };
}
