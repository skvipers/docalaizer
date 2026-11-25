import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Database, sessions, users } from '@docalaizer/db';
import { AppError } from '../errors';
import { generateSessionToken } from '../security/crypto';
import { SESSION_TTL_MS, type AuthSessionResult, type AuthUser } from './auth.service';

export const LOCUGARD_SESSION_COOKIE = 'locugard_session';
export const LOCUGARD_CSRF_COOKIE = 'locugard_csrf';
const LOCUGARD_UPSTREAM_COOKIE = '__Host-locugard_sid';
const LOCUGARD_EMAIL_DOMAIN = '@locugard.invalid';

export interface LocugardConfig {
  baseUrl: string;
  expectedOrigin: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const loginOptionsSchema = z.object({
  challenge_id: z.string().min(1),
  options: z.record(z.unknown()),
});

const loginVerifySchema = z.object({
  account_id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128),
  role: z.string().min(1),
  device_id: z.string().min(1),
  csrf_token: z.string().min(1),
});

const profileSchema = z.object({
  account_id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128),
  display_name: z.string().max(120).optional(),
  role: z.string().min(1),
  device_id: z.string().min(1),
  effective_mode: z.number().int(),
  network_zone: z.string(),
});

export type LocugardProfile = z.infer<typeof profileSchema>;

interface LocugardRequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  sessionToken?: string;
  csrfToken?: string;
}

async function requestLocugard<T>(
  config: LocugardConfig,
  schema: z.ZodType<T>,
  options: LocugardRequestOptions,
): Promise<{ data: T; response: Response }> {
  let response: Response;
  try {
    response = await (config.fetchFn ?? fetch)(`${config.baseUrl}${options.path}`, {
      method: options.method,
      headers: {
        ...(options.method === 'POST' ? { origin: config.expectedOrigin } : {}),
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.sessionToken
          ? { cookie: `${LOCUGARD_UPSTREAM_COOKIE}=${options.sessionToken}` }
          : {}),
        ...(options.csrfToken ? { 'x-csrf-token': options.csrfToken } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
    });
  } catch {
    throw new AppError(502, 'LOCUGARD_UNAVAILABLE', 'LocuGard is unavailable.');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AppError(401, 'LOCUGARD_AUTH_FAILED', 'LocuGard authentication failed.');
    }
    if (response.status === 429) {
      throw new AppError(429, 'LOCUGARD_RATE_LIMITED', 'LocuGard rate limit exceeded.');
    }
    throw new AppError(502, 'LOCUGARD_ERROR', 'LocuGard returned an unexpected response.');
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AppError(502, 'LOCUGARD_ERROR', 'LocuGard returned invalid JSON.');
  }

  try {
    return { data: schema.parse(json), response };
  } catch {
    throw new AppError(502, 'LOCUGARD_ERROR', 'LocuGard returned an invalid response schema.');
  }
}

export function locugardConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LocugardConfig | undefined {
  const baseUrl = env.LOCUGARD_URL?.trim().replace(/\/$/, '');
  const expectedOrigin = env.LOCUGARD_ORIGIN?.trim().replace(/\/$/, '');
  if (!baseUrl && !expectedOrigin) return undefined;
  if (!baseUrl || !expectedOrigin) {
    throw new Error('LOCUGARD_URL and LOCUGARD_ORIGIN must be configured together.');
  }
  for (const value of [baseUrl, expectedOrigin]) {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      throw new Error('LocuGard integration requires HTTPS URLs.');
    }
  }
  return { baseUrl, expectedOrigin };
}

export async function getLocugardLoginOptions(config: LocugardConfig) {
  const { data } = await requestLocugard(config, loginOptionsSchema, {
    method: 'POST',
    path: '/auth/login/options',
  });
  return data;
}

export async function verifyLocugardLogin(
  config: LocugardConfig,
  body: { challengeId: string; credential: Record<string, unknown> },
) {
  const { data, response } = await requestLocugard(config, loginVerifySchema, {
    method: 'POST',
    path: '/auth/login/verify',
    body: { challenge_id: body.challengeId, credential: body.credential },
  });
  const setCookie = response.headers.get('set-cookie') ?? '';
  const sessionToken = setCookie.match(/(?:^|;\s*)__Host-locugard_sid=([^;]+)/)?.[1];
  if (!sessionToken) {
    throw new AppError(502, 'LOCUGARD_ERROR', 'LocuGard did not return a session cookie.');
  }
  const maxAgeValue = setCookie.match(/(?:^|;\s*)max-age=(\d+)/i)?.[1];
  const maxAgeSeconds = maxAgeValue ? Number(maxAgeValue) : undefined;
  return { data, sessionToken, maxAgeSeconds };
}

export async function getLocugardProfile(config: LocugardConfig, sessionToken: string) {
  const { data } = await requestLocugard(config, profileSchema, {
    method: 'GET',
    path: '/api/protected/profile',
    sessionToken,
  });
  return data;
}

export async function logoutLocugard(
  config: LocugardConfig,
  sessionToken: string,
  csrfToken: string,
) {
  await requestLocugard(config, z.object({ status: z.string() }), {
    method: 'POST',
    path: '/auth/logout',
    sessionToken,
    csrfToken,
  });
}

export function locugardEmail(accountId: string): string {
  return `${accountId.toLowerCase()}${LOCUGARD_EMAIL_DOMAIN}`;
}

export function isLocugardEmail(email: string): boolean {
  return email.endsWith(LOCUGARD_EMAIL_DOMAIN);
}

export async function createLocugardSession(
  db: Database,
  profile: LocugardProfile,
  maxAgeSeconds?: number,
): Promise<AuthSessionResult> {
  const email = locugardEmail(profile.account_id);
  const name = profile.display_name?.trim() || `LocuGard ${profile.account_id}`;
  const { rawToken, tokenHash } = generateSessionToken();
  const ttlSeconds = Math.min(
    Math.max(Math.floor(maxAgeSeconds ?? SESSION_TTL_MS / 1000), 1),
    SESSION_TTL_MS / 1000,
  );
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const user = await db.transaction(async (tx): Promise<AuthUser> => {
    const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    let row = existing;
    if (!row) {
      const [created] = await tx
        .insert(users)
        .values({ email, name, globalRole: 'member' })
        .onConflictDoNothing()
        .returning();
      row = created ?? (await tx.select().from(users).where(eq(users.email, email)).limit(1))[0];
    }
    if (!row || !row.isActive) {
      throw new AppError(401, 'LOCUGARD_AUTH_FAILED', 'This LocuGard account is disabled.');
    }
    if (row.name !== name) {
      const [updated] = await tx
        .update(users)
        .set({ name, updatedAt: new Date() })
        .where(eq(users.id, row.id))
        .returning();
      row = updated ?? row;
    }
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      globalRole: row.globalRole,
    };
  });

  await db.insert(sessions).values({ userId: user.id, tokenHash, expiresAt });
  return { user, sessionToken: rawToken, expiresAt };
}
