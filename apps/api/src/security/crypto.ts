import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}

export function generateSessionToken(): { rawToken: string; tokenHash: string } {
  const rawToken = `doca_sess_${randomBytes(32).toString('hex')}`;
  return { rawToken, tokenHash: sha256(rawToken) };
}

export function generateAgentToken(): {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const rawToken = `doca_live_${randomBytes(32).toString('hex')}`;
  return {
    rawToken,
    tokenHash: sha256(rawToken),
    tokenPrefix: rawToken.slice(0, 16),
  };
}
