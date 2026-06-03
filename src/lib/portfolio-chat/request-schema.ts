/**
 * Request schema and IP-extraction helper for the Portfolio Recruiter Chatbot.
 *
 * The schema is the single validation boundary for the public
 * `/api/portfolio-chat` route. It mirrors the "Chat Request Schema" in the
 * design doc exactly:
 *
 * ```ts
 * z.object({
 *   username: z.string().min(1).max(100),
 *   messages: z.array(z.object({
 *     id: z.string(),
 *     role: z.enum(["user", "assistant"]),
 *     content: z.string().optional(),
 *     parts: z.array(z.any()).optional(),
 *   })).min(1),
 * })
 * ```
 *
 * `extractClientIp` resolves the recruiter's IP for rate-limit keying. Public
 * traffic is unauthenticated, so the IP is the only identity signal we have.
 * The header fallback chain matches the route's deployment behind a
 * reverse proxy (Vercel / Next.js): the first hop in `x-forwarded-for`
 * is the original client; `x-real-ip` is a fallback for proxies that only
 * set that header; `"unknown"` is used when neither header is present so
 * the rate limiter still gets a deterministic (if shared) key rather than
 * crashing on `undefined`.
 *
 * See `.kiro/specs/portfolio-recruiter-chatbot/design.md`
 *  - "Chat Request Schema"
 *  - "Failure Matrix" rows #1, #2 (400 invalid_request)
 *  - "Failure Matrix" row #5 (429 rate_limited keyed on IP)
 *  - "Logging and Privacy" (IPs must be hashed before logging)
 */

import { z } from "zod";

// ── Request schema ─────────────────────────────────────────────────────────
//
// The message shape intentionally accepts both the legacy `content` string
// and the AI SDK v6 `parts` array because `useChat` may send either depending
// on configuration. At least one of the two is expected to be present in
// practice, but the schema does not enforce that — `convertToModelMessages`
// downstream handles missing/empty bodies gracefully.

export const PortfolioChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string().optional(),
  parts: z.array(z.any()).optional(),
});

export const PortfolioChatRequestSchema = z.object({
  username: z.string().min(1).max(100),
  messages: z.array(PortfolioChatMessageSchema).min(1),
});

export type PortfolioChatRequest = z.infer<typeof PortfolioChatRequestSchema>;
export type PortfolioChatMessage = z.infer<typeof PortfolioChatMessageSchema>;

// ── IP extraction ──────────────────────────────────────────────────────────

/**
 * Extract the originating client IP from a `Request`'s headers.
 *
 * Order of precedence:
 *  1. First hop of `x-forwarded-for` (set by Vercel / most reverse proxies).
 *  2. `x-real-ip` (set by some proxies as a single-value fallback).
 *  3. The literal string `"unknown"` so callers can always use the result
 *     as a rate-limit key without null-checking.
 *
 * The first hop is the leftmost entry in the comma-separated list — this is
 * the original client per the standard. We also `trim()` it because some
 * proxies emit `"1.2.3.4, 5.6.7.8"` with a leading space after the comma.
 */
export function extractClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstHop = forwardedFor.split(",")[0]?.trim();
    if (firstHop) {
      return firstHop;
    }
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return "unknown";
}
