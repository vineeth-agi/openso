/**
 * Constant-time string comparison helper.
 *
 * Uses `crypto.timingSafeEqual` on equal-length buffers. When inputs differ in
 * length the function still consumes time proportional to the longer input
 * (via `timingSafeEqual` against a same-length filler) before returning false,
 * so an attacker cannot use length-mismatch as a fast-fail oracle either.
 *
 * Use this everywhere a secret is compared (cron secrets, webhook secrets,
 * password reset tokens, OTPs). Never use `===` for secret comparison.
 */
import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

export function timingSafeEqualStr(a: string, b: string): boolean {
  // Coerce to strings defensively — `null`/`undefined` become "null"/"undefined"
  // and will compare unequal to any real secret.
  const aStr = typeof a === "string" ? a : String(a ?? "");
  const bStr = typeof b === "string" ? b : String(b ?? "");

  const aBuf = Buffer.from(aStr, "utf8");
  const bBuf = Buffer.from(bStr, "utf8");

  if (aBuf.length !== bBuf.length) {
    // Still spend time so length mismatch isn't a fast-fail oracle.
    const max = Math.max(aBuf.length, bBuf.length, 1);
    const filler = Buffer.alloc(max);
    nodeTimingSafeEqual(filler, filler);
    return false;
  }

  return nodeTimingSafeEqual(aBuf, bBuf);
}
