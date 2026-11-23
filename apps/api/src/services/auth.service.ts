import { and, count, eq, gt } from 'drizzle-orm';
import { type Database, type GlobalRole, sessions, users } from '@docalaizer/db';
import { AppError, isPgUniqueViolation } from '../errors';
import {
  generateSessionToken,
  hashPassword,
  sha256,
  verifyPassword,
} from '../security/crypto';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  globalRole: GlobalRole;
}

export interface AuthSessionResult {
  user: AuthUser;
  sessionToken: string;
  expiresAt: Date;
}

export async function registerUser(
  db: Database,
  params: {
    email: string;
    name: string;
    password: string;
    allowPublicSignup: boolean;
  },
): Promise<AuthSessionResult> {
  const normalizedEmail = params.email.trim().toLowerCase();
  if (params.password.length < 8) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters long.');
  }

  const [countRow] = await db.select({ total: count() }).from(users);
  const isFirstUser = Number(countRow?.total ?? 0) === 0;

  if (!isFirstUser && !params.allowPublicSignup) {
    throw new AppError(403, 'SIGNUP_DISABLED', 'Public registration is disabled on this server.');
  }

  const passwordHash = hashPassword(params.password);
  const { rawToken, tokenHash } = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  try {
    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: normalizedEmail,
          name: params.name.trim(),
          passwordHash,
          globalRole: isFirstUser ? 'admin' : 'member',
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          globalRole: users.globalRole,
        });

      if (!user) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create user.');
      }

      await tx.insert(sessions).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      return user;
    });

    return { user: created, sessionToken: rawToken, expiresAt };
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'A user with this email already exists.');
    }
    throw err;
  }
}

export async function loginUser(
  db: Database,
  params: { email: string; password: string },
): Promise<AuthSessionResult> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (!user || !user.isActive || !user.passwordHash) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (!verifyPassword(params.password, user.passwordHash)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const { rawToken, tokenHash } = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      globalRole: user.globalRole,
    },
    sessionToken: rawToken,
    expiresAt,
  };
}

export async function getUserBySessionToken(
  db: Database,
  rawToken: string,
): Promise<AuthUser | null> {
  const tokenHash = sha256(rawToken);
  const now = new Date();

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      globalRole: users.globalRole,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    globalRole: row.globalRole,
  };
}

export async function logoutSession(db: Database, rawToken: string): Promise<void> {
  const tokenHash = sha256(rawToken);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}
