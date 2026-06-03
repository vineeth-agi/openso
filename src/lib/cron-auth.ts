/**
 * Cron auth verification — server-only.
 *
 * Kept in a separate module from `@/lib/cron` so that pulling the
 * client-safe helpers (`cronToHuman`, `computeNextRunAt`, etc.) does not
 * also pull `node:crypto` into the browser bundle.
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { timingSafeEqualStr } from "@/lib/security/timing-safe";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Verify that an incoming request carries a valid CRON_SECRET.
 * Checks the `authorization` header in constant time.
 *
 * @returns `null` if authorized, or a 401 NextResponse if not
 */
export function verifyCronAuth(req: NextRequest | Request): NextResponse | null {
  if (!CRON_SECRET) {
    // Fail closed: a missing secret means we cannot authenticate.
    // Previously the cron module allowed access in non-production builds —
    // that opened any preview / staging deployment to unauthenticated cron
    // triggers (Finding 11). Now we require the secret in every environment.
    console.error("[cron-auth] CRON_SECRET is not set — rejecting request.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authHeader =
    req.headers.get("authorization") ?? req.headers.get("Authorization");

  if (authHeader && timingSafeEqualStr(authHeader, `Bearer ${CRON_SECRET}`)) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
