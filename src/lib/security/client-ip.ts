/**
 * Client IP extraction.
 *
 * Reads the standard forwarded headers in priority order. Used as the rate-limit
 * key for unauthenticated endpoints. Falls back to "unknown" when no header is
 * present (e.g. local dev without a proxy) — callers should treat that as a
 * shared bucket.
 */
export function extractClientIp(req: Request): string {
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ];
  for (const c of candidates) {
    if (c && c.length > 0 && c.length < 64) return c;
  }
  return "unknown";
}
