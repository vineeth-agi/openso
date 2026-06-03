// Server-side in-memory OTP store (dev / single-instance)
// Production: replace with Redis or a DB table with TTL.
//
// Security note (Finding 13): Maps are per-process; rate limits and OTP
// lookups split across serverless instances. This file documents the
// limitation. Currently only the password-recovery flow uses these helpers.

import crypto from "crypto";

import { timingSafeEqualStr } from "@/lib/security/timing-safe";

// ── OTP Store ────────────────────────────────────────────────────────────────

interface OtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
  type: "recovery";
}

const otpStore = new Map<string, OtpEntry>();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

/** Generate a cryptographically random 6-digit OTP, store it, return the code. */
export function generateOtp(email: string, type: "recovery"): string {
  const code = String(crypto.randomInt(100000, 999999));
  otpStore.set(email.toLowerCase(), {
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    type,
  });
  return code;
}

/** Verify an OTP. Returns true if valid, or an error message string. */
export function verifyOtp(
  email: string,
  token: string,
  type: "recovery",
): true | string {
  const key = email.toLowerCase();
  const entry = otpStore.get(key);
  if (!entry) return "No OTP found for this email. Please request a new code.";
  if (entry.type !== type) return "Invalid OTP type.";
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(key);
    return "OTP expired. Please request a new code.";
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(key);
    return "Too many attempts. Please request a new code.";
  }
  entry.attempts++;
  // Constant-time compare so byte-by-byte timing leaks aren't possible.
  if (!timingSafeEqualStr(entry.code, String(token))) {
    const left = MAX_ATTEMPTS - entry.attempts;
    return `Invalid code. ${left} attempt${left === 1 ? "" : "s"} remaining.`;
  }
  otpStore.delete(key); // single-use
  return true;
}

// ── Reset Token Store ────────────────────────────────────────────────────────
// Short-lived tokens issued after OTP verification for password reset.

interface ResetTokenEntry {
  email: string;
  expiresAt: number;
}

const resetTokenStore = new Map<string, ResetTokenEntry>();
const RESET_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Generate a cryptographic reset token and store it. */
export function generateResetToken(email: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  resetTokenStore.set(token, {
    email: email.toLowerCase(),
    expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
  });
  return token;
}

/** Verify and consume a reset token (single-use). */
export function verifyResetToken(token: string, email: string): boolean {
  const entry = resetTokenStore.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    resetTokenStore.delete(token);
    return false;
  }
  if (!timingSafeEqualStr(entry.email, email.toLowerCase())) return false;
  resetTokenStore.delete(token); // single-use
  return true;
}
