/**
 * Upstash Redis client + small caching helpers.
 *
 * Used to cache read-heavy endpoints whose data is refreshed by background
 * QStash workflows (open-source repos/issues). The client is the REST-based `@upstash/redis` SDK so it works in
 * both Node and Edge runtimes.
 *
 * Graceful degradation: when `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN` are unset (typical in `npm run dev` against
 * `.env.local`), `getRedis()` returns `null` and the helpers
 * below transparently bypass the cache. That way feature work never blocks
 * on Redis being configured locally — only production gets the speedup.
 *
 * Failure mode: if Redis is configured but the network call fails, we log
 * and fall back to the source-of-truth fetcher rather than 5xx. Caches are
 * an optimisation, not a correctness boundary.
 */

import { Redis } from "@upstash/redis";

let _client: Redis | null | undefined;

/**
 * Lazily build (and memoise) the Redis client. Returns `null` when the
 * env vars are missing — callers should treat that as "no cache available"
 * and just hit the underlying source.
 */
export function getRedis(): Redis | null {
  if (_client !== undefined) return _client;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[redis] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing — caching disabled.",
      );
    }
    _client = null;
    return _client;
  }

  _client = new Redis({ url, token });
  return _client;
}

/**
 * Read a cached JSON value. Returns `null` when the key isn't set, when
 * Redis isn't configured, or when the call fails. Never throws — caching
 * failures must not break the request.
 *
 * The Upstash REST SDK auto-deserialises JSON, so callers receive the
 * value as `T` directly.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const value = (await redis.get(key)) as T | null;
    return value ?? null;
  } catch (err) {
    console.warn(`[redis] cacheGet(${key}) failed:`, err);
    return null;
  }
}

/**
 * Write a JSON value with a TTL (seconds). Silently succeeds when Redis
 * isn't configured or when the call fails — caching is best-effort.
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.warn(`[redis] cacheSet(${key}) failed:`, err);
  }
}

/**
 * Delete one or more cache keys. Used by background workflows to bust
 * caches after they refresh the underlying data.
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(...keys);
  } catch (err) {
    console.warn(`[redis] cacheDel(${keys.join(", ")}) failed:`, err);
  }
}

/**
 * Delete every key that matches a glob pattern. Useful for parameterised
 * cache namespaces like `jobs:list:*` where we don't know every variant
 * up-front. Uses SCAN so we don't block Redis on large key spaces.
 */
export async function cacheDelByPattern(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  try {
    let cursor: string | number = 0;
    let deleted = 0;
    do {
      const [next, keys] = (await redis.scan(cursor, {
        match: pattern,
        count: 200,
      })) as [string, string[]];
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
      cursor = next;
    } while (String(cursor) !== "0");

    return deleted;
  } catch (err) {
    console.warn(`[redis] cacheDelByPattern(${pattern}) failed:`, err);
    return 0;
  }
}

/**
 * Read-through cache helper. If the key is hit, returns the cached value;
 * otherwise calls `loader`, caches the result, and returns it.
 *
 * `loader` is only invoked on a miss, so callers can put expensive DB
 * queries inside it without paying the cost on hot paths.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<{ data: T; cached: boolean }> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return { data: cached, cached: true };
  }

  const data = await loader();
  // Fire-and-forget: don't block the response on the cache write.
  void cacheSet(key, data, ttlSeconds);
  return { data, cached: false };
}

/**
 * Stable string key for an object of query params. Sorts keys so that
 * `?a=1&b=2` and `?b=2&a=1` collapse to the same cache entry. Values are
 * coerced to strings; arrays are serialised as comma-joined sorted lists
 * so multi-select filters (e.g. `country=US,IN`) hash predictably.
 */
export function stableQueryKey(
  prefix: string,
  params: Record<string, string | number | boolean | string[] | null | undefined>,
): string {
  const parts: string[] = [];
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    const raw = params[key];
    if (raw === null || raw === undefined || raw === "") continue;

    let value: string;
    if (Array.isArray(raw)) {
      const cleaned = raw
        .map((v) => String(v).trim())
        .filter((v) => v !== "")
        .sort();
      if (cleaned.length === 0) continue;
      value = cleaned.join(",");
    } else {
      value = String(raw).trim();
      if (value === "") continue;
    }

    parts.push(`${key}=${value}`);
  }

  return parts.length === 0 ? prefix : `${prefix}:${parts.join("&")}`;
}

// ── Cache key namespaces ───────────────────────────────────────────────
//
// Centralise the namespaces here so the route handlers and the workflows
// that invalidate them stay in sync. If you change a prefix, update both
// sides.

export const CACHE_KEYS = {
  /** Open-source repo catalog. Single global key — refreshed by the
   *  open-issues-sync workflow. */
  openSourceRepos: "os:repos:v1",

  /** Open-source actionable issues feed. Single global key — refreshed
   *  by the open-issues-sync workflow. */
  openSourceIssues: "os:issues:v1",
} as const;

// ── Per-user daily counter ─────────────────────────────────────────────
//
// Used to bound expensive per-user actions (e.g. AI generations) at a
// 24-hour budget on top of the per-IP `rateLimit()`. Atomic via Redis
// `INCR` + `EXPIRE`-on-first-increment so concurrent requests can't race
// past the cap.
//
// Failure mode: caching is best-effort everywhere else in this file, but
// this is a budget guard. Still, if Redis is unreachable or unconfigured
// we fail-open (return ok=true) and log a warning — a Redis outage must
// not lock every user out. The per-IP rate limit + the auth gate remain
// in place as the other layers of defense.

const DAILY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Per-user daily counter. Increments `key` and returns whether the new
 * value is within `limit`. The first increment of a fresh key sets a
 * 24-hour TTL so the counter rolls over automatically.
 *
 * Returns `{ ok: true, used: 0, limit }` when Redis is unavailable or
 * the call fails — the budget cannot be enforced without Redis, but we
 * don't want a Redis outage to break the route.
 */
export async function dailyLimit(
  key: string,
  limit: number,
): Promise<{ ok: boolean; used: number; limit: number }> {
  const redis = getRedis();
  if (!redis) {
    // No Redis configured (typical in `npm run dev`). Allow through but
    // surface a warning in production so this is noticed.
    if (process.env.NODE_ENV === "production") {
      console.warn(
        `[redis] dailyLimit(${key}) skipped — Redis not configured; allowing.`,
      );
    }
    return { ok: true, used: 0, limit };
  }

  try {
    const used = await redis.incr(key);
    if (used === 1) {
      // First hit of a fresh key — set the rolling 24h window.
      await redis.expire(key, DAILY_TTL_SECONDS);
    }
    return { ok: used <= limit, used, limit };
  } catch (err) {
    console.warn(`[redis] dailyLimit(${key}) failed, allowing:`, err);
    return { ok: true, used: 0, limit };
  }
}
