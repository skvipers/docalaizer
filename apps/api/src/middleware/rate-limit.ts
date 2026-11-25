import type { Context, MiddlewareHandler } from 'hono';

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  keyGenerator?: (c: Context) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function getClientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = c.req.header('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'local';
}

export function createRateLimiter(options: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  let lastCleanup = Date.now();

  return async (c, next) => {
    const now = Date.now();
    if (now - lastCleanup > Math.max(options.windowMs, 60_000)) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) {
          buckets.delete(key);
        }
      }
      lastCleanup = now;
    }

    const identity = options.keyGenerator ? options.keyGenerator(c) : getClientIp(c);
    const key = `${options.keyPrefix}:${identity}`;
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      await next();
      return;
    }

    existing.count++;
    if (existing.count > options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please retry later.',
          },
        },
        429,
      );
    }

    await next();
  };
}
