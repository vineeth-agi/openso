/**
 * Safe error response helpers.
 *
 * Goals:
 *   1. Never echo InsForge / PostgREST error messages (or raw `Error.message`)
 *      back to clients — they leak schema details and aid attacker recon.
 *   2. Always log the underlying error server-side with a request id so ops
 *      can still correlate user reports with internal traces.
 *   3. Accept an optional `clientHint` string for cases where a specific
 *      user-facing message is genuinely safe (e.g. "Username already taken").
 */
import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";

type LogLevel = "warn" | "error";

interface SafeErrorOptions {
  /** Stable identifier prepended to the server log line (e.g. "/api/portfolio/me"). */
  scope: string;
  /** Optional user-facing hint. If omitted, a generic message is returned. */
  clientHint?: string;
  /** HTTP status code. Defaults to 500. */
  status?: number;
  /** Log level. Defaults to "error". */
  level?: LogLevel;
}

const GENERIC_MESSAGE = "Internal error. Please try again.";

/** Build a JSON error response that leaks no internal detail. */
export function safeErrorResponse(
  err: unknown,
  options: SafeErrorOptions,
): NextResponse {
  const requestId = randomUUID();
  const status = options.status ?? 500;
  const level = options.level ?? "error";

  const detail =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : JSON.stringify(err);

  // Server-side log only — never returned to the client.
  const logLine = `[${options.scope}] requestId=${requestId} ${detail}`;
  if (level === "warn") {
    console.warn(logLine);
  } else {
    console.error(logLine);
  }

  return NextResponse.json(
    {
      error: options.clientHint ?? GENERIC_MESSAGE,
      requestId,
    },
    { status },
  );
}
