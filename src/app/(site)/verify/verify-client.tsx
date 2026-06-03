"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  Loader2Icon,
  ShieldCheckIcon,
  MailIcon,
  ArrowLeftIcon,
} from "lucide-react";

import { FloatingPaths } from "@/components/floating-paths";
import { Button } from "@/components/ui/button";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

export default function VerifyClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN);
  const [verified, setVerified] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ── Countdown timer for resend ─────────────────────────────────────────
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // ── Focus first input on mount ─────────────────────────────────────────
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // ── Handle individual digit input ──────────────────────────────────────
  const handleChange = useCallback(
    (index: number, value: string) => {
      if (!/^[0-9]?$/.test(value)) return;
      const next = [...otp];
      next[index] = value;
      setOtp(next);
      setError(null);
      if (value && index < OTP_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [otp],
  );

  // ── Handle keyboard navigation ─────────────────────────────────────────
  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !otp[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
      if (e.key === "ArrowLeft" && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
      if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [otp],
  );

  // ── Handle paste ───────────────────────────────────────────────────────
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = Array(OTP_LENGTH).fill("");
    pasted.split("").forEach((ch, i) => (next[i] = ch));
    setOtp(next);
    setError(null);
    const focusIdx = Math.min(pasted.length, OTP_LENGTH - 1);
    inputRefs.current[focusIdx]?.focus();
  }, []);

  // ── Verify OTP (recovery only) ─────────────────────────────────────────
  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length !== OTP_LENGTH) {
      setError("Please enter the full 6-digit code.");
      return;
    }

    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token: code, type: "recovery" }),
    });
    const data = await res.json();

    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Verification failed.");
      return;
    }

    setVerified(true);

    // Redirect to reset-password with the server-issued reset token
    const resetToken = data.resetToken;
    router.push(
      `/reset-password?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(email)}`,
    );
  };

  // ── Resend OTP ─────────────────────────────────────────────────────────
  const handleResend = async () => {
    setError(null);
    setResendCooldown(RESEND_COOLDOWN);

    const res = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, type: "recovery" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to resend code.");
    }
  };

  // ── Mask email ─────────────────────────────────────────────────────────
  const maskedEmail = email
    ? email.replace(
        /^(.{2})(.*)(@.*)$/,
        (_, a, b, c) => a + "*".repeat(b.length) + c,
      )
    : "";

  return (
    <main className="relative md:h-screen md:overflow-hidden lg:grid lg:grid-cols-2">
      {/* ── Left panel ──────────────────────────────────────────────────── */}
      <div className="relative hidden h-full flex-col border-r bg-secondary p-10 lg:flex dark:bg-secondary/20">
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-background" />
        <div className="z-10 mt-auto">
          <blockquote className="space-y-2">
            <p className="text-xl">
              &ldquo;Security is not a product, but a process.&rdquo;
            </p>
            <footer className="font-mono font-semibold text-sm">
              ~ Bruce Schneier
            </footer>
          </blockquote>
        </div>
        <div className="absolute inset-0 hidden md:block">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
      </div>

      {/* ── Right panel ─────────────────────────────────────────────────── */}
      <div className="relative flex min-h-screen flex-col justify-center px-8">
        <div
          aria-hidden
          className="absolute inset-0 isolate -z-10 hidden opacity-60 contain-strict md:block"
        >
          <div className="absolute top-0 right-0 h-320 w-140 -translate-y-87.5 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,--theme(--color-foreground/.06)_0,hsla(0,0%,55%,.02)_50%,--theme(--color-foreground/.01)_80%)]" />
          <div className="absolute top-0 right-0 h-320 w-60 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)] [translate:5%_-50%]" />
          <div className="absolute top-0 right-0 h-320 w-60 -translate-y-87.5 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)]" />
        </div>

        <div className="mx-auto w-full max-w-sm space-y-6">
          {/* Icon + Heading */}
          <div className="flex flex-col items-center space-y-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              {verified ? (
                <ShieldCheckIcon className="h-7 w-7 text-primary" />
              ) : (
                <MailIcon className="h-7 w-7 text-primary" />
              )}
            </div>
            <h1 className="font-bold text-2xl tracking-wide">
              Password Recovery
            </h1>
            <p className="text-base text-muted-foreground">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-foreground">
                {maskedEmail}
              </span>
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive">
              {error}
            </div>
          )}

          {/* OTP Inputs */}
          <div className="flex justify-center gap-2" onPaste={handlePaste}>
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="h-12 w-12 min-h-[44px] min-w-[44px] rounded-lg border border-input bg-background text-center text-lg font-semibold shadow-xs transition-colors focus:border-ring focus:ring-2 focus:ring-ring/50 focus:outline-none"
                aria-label={`Digit ${i + 1}`}
              />
            ))}
          </div>

          {/* Verify Button */}
          <Button
            className="w-full"
            onClick={handleVerify}
            disabled={loading || otp.join("").length !== OTP_LENGTH}
          >
            {loading && (
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
            )}
            Verify & Reset Password
          </Button>

          {/* Resend */}
          <p className="text-center text-sm text-muted-foreground">
            Didn&apos;t receive the code?{" "}
            {resendCooldown > 0 ? (
              <span className="text-muted-foreground/70">
                Resend in {resendCooldown}s
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                className="font-medium text-primary underline underline-offset-4"
              >
                Resend Code
              </button>
            )}
          </p>

          {/* Back link */}
          <div className="text-center">
            <Link
              href="/signin"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
