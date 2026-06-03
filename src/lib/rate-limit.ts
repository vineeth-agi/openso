/**
 * Distributed fixed-window rate limiter backed by Upstash Redis.
 *
 * Previously this used a module-level `Map`, which is per-instance in
 * Vercel's serverless model: each cold/warm instance kept its own counter,
 * so the limit scaled with the number of running instances and was
 * effectively unenforceable under load (audit API-OTP-1, P1-6). Backing it
 * with Redis makes the window shared across every instance.
 *
 * Implementation: a fixed 60s window keyed by `rl:{key}:{floor(now/60000)}`.
 * We use `INCR` (atomic) and set the TTL on the first increment of a fresh
 * window via `EXPIRE`, so the key self-expires when the window rolls over.
 * `@upstash/ratelimit` is not a dependency, so we implement this manually on
 * top of the already-configured `@upstash/redis` client — no extra package,
 * no second connection.
 *
 * Graceful degradation (fail-open): if Redis is not configured (no
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — typical in local dev)
 * or any Redis call throws, we return `{ ok: true, ... }` and log a warning.
 * Rationale/tradeoff: rate limiting is a protective layer, not a correctness
 * boundary. A Redis outage must not 500 every request and take the whole app
 * down; the auth gate and per-user `dailyLimit()` remain as other layers of
 * defense. This mirrors the best-effort pattern in `redis.ts`.
 *
 * Usage:
 *   const rl = await rateLimit(`chat:${userId}`, 10);
 *   if (!rl.ok) return Response.json({ error: "Too many requests" }, { status: 429 });
 */

import { getRedis } from "@/lib/redis";

const WINDOW_MS = 60_000; // 1 minute
const WINDOW_SECONDS = WINDOW_MS / 1000;

/**
 * Check rate limit for a given key.
 * @param key   - unique identifier (e.g. `chat:${userId}`)
 * @param limit - max requests per minute (default: 10)
 * @returns { ok, remaining, retryAfter }
 */
export async function rateLimit(
  key: string,
  limit = 10,
): Promise<{ ok: boolean; remaining: number; retryAfter: number }> {
  const redis = getRedis();

  // Fail open when Redis isn't configured (e.g. local dev). Surface a
  // warning in production so a missing config is noticed rather than
  // silently disabling the limiter.
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        `[rate-limit] rateLimit(${key}) skipped — Redis not configured; allowing.`,
      );
    }
    return { ok: true, remaining: limit, retryAfter: 0 };
  }

  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS);
  const windowKey = `rl:${key}:${windowStart}`;

  try {
    const count = await redis.incr(windowKey);
    if (count === 1) {
      // First hit of a fresh window — set the TTL so it self-expires.
      await redis.expire(windowKey, WINDOW_SECONDS);
    }

    if (count > limit) {
      // Seconds until the current fixed window ends.
      const retryAfter = Math.ceil((windowStart + 1) * WINDOW_MS - now) / 1000;
      return { ok: false, remaining: 0, retryAfter: Math.ceil(retryAfter) };
    }

    return { ok: true, remaining: Math.max(0, limit - count), retryAfter: 0 };
  } catch (err) {
    // Fail open: a Redis outage should not take down every request that
    // happens to pass through the limiter.
    console.warn(`[rate-limit] rateLimit(${key}) failed, allowing:`, err);
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
}
