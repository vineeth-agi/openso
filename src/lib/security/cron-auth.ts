/**
 * Cron request authentication helper.
 *
 * Centralizes inbound cron-secret validation for Worker_Endpoints under
 * `src/app/api/**` that are invoked by external schedulers (InsForge schedules
 * after migration, Vercel Cron / pg_net during the dual-fire overlap window).
 *
 * Two header shapes are accepted, both compared in constant time via
 * {@link timingSafeEqualStr}:
 *   - `x-cron-secret: <CRON_SECRET>`        (InsForge schedule format)
 *   - `Authorization: Bearer <CRON_SECRET>` (legacy Vercel/pg_cron format)
 *
 * The shared secret is read from `process.env.CRON_SECRET`. When the
 * `false` — no header value can authorize the request without a configured
 * server-side secret.
 *
 * Runtime note: this module relies on `node:crypto` and therefore must run in
 * the Next.js Node.js runtime. Route handlers that import it must NOT set
 * `export const runtime = "edge"`.
 *
 * Validates: Requirements 6.5
 */
import { timingSafeEqualStr } from "@/lib/security/timing-safe";

/**
 * Resolve the configured cron shared secret from the environment.
 *
 * Reads `process.env.CRON_SECRET` — the single source of truth defined
 * in `.env.local` and on Vercel.
 *
 * @returns the secret, or `null` when unset or empty.
 */
export function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    return null;
  }
  return secret;
}

/**
 * Validate an inbound cron request.
 *
 * Accepts either an `x-cron-secret` header whose value equals the configured
 * `CRON_SECRET`, or an `Authorization` header equal to
 * `Bearer <CRON_SECRET>`. Both comparisons are performed in constant
 * time via {@link timingSafeEqualStr}.
 *
 * Header lookups go through the standard Web `Headers` interface
 * (`req.headers.get(...)`) which is case-insensitive per the WHATWG Fetch
 * specification, so callers do not need to normalize header names.
 *
 * Returns `false` when:
 *   - the configured secret is missing or empty,
 *   - neither recognized header is present, or
 *   - the presented value does not match the configured secret.
 *
 * @param req the incoming standard Web `Request` (Next.js Route Handler input).
 *
 * Validates: Requirements 6.5
 */
export function validateCronRequest(req: Request): boolean {
  const secret = getCronSecret();
  if (secret === null) {
    return false;
  }

  const xCronSecret = req.headers.get("x-cron-secret");
  if (xCronSecret !== null && timingSafeEqualStr(xCronSecret, secret)) {
    return true;
  }

  const authorization = req.headers.get("authorization");
  if (
    authorization !== null &&
    timingSafeEqualStr(authorization, `Bearer ${secret}`)
  ) {
    return true;
  }

  return false;
}
