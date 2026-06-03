"use client";

import React, { useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  LockKeyholeIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  ShieldCheckIcon,
} from "lucide-react";

import { FloatingPaths } from "@/components/floating-paths";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

export default function ResetPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resetToken = searchParams.get("token") ?? "";
  const email = searchParams.get("email") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect away if no token/email (page accessed directly)
  if (!resetToken || !email) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">
            Invalid or expired reset link.
          </p>
          <Link
            href="/signin"
            className="text-primary underline underline-offset-4"
          >
            Back to Sign In
          </Link>
        </div>
      </main>
    );
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("Password must contain at least one uppercase letter.");
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError("Password must contain at least one lowercase letter.");
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError("Password must contain at least one number.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, resetToken }),
    });
    const data = await res.json();

    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to reset password.");
      return;
    }

    router.push("/signin?message=password_updated");
  };

  // Password strength indicator
  const getStrength = () => {
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[a-z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  };
  const strength = getStrength();
  const strengthLabel = [
    "",
    "Weak",
    "Fair",
    "Good",
    "Strong",
    "Very Strong",
  ][strength];
  const strengthColor = [
    "",
    "bg-destructive",
    "bg-orange-500",
    "bg-yellow-500",
    "bg-green-500",
    "bg-green-600",
  ][strength];

  return (
    <main className="relative md:h-screen md:overflow-hidden lg:grid lg:grid-cols-2">
      <div className="relative hidden h-full flex-col border-r bg-secondary p-10 lg:flex dark:bg-secondary/20">
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-background" />
        <div className="z-10 mt-auto">
          <blockquote className="space-y-2">
            <p className="text-xl">
              &ldquo;A strong password is your first line of defence.&rdquo;
            </p>
            <footer className="font-mono font-semibold text-sm">
              ~ NIST Guidelines
            </footer>
          </blockquote>
        </div>
        <div className="absolute inset-0 hidden md:block">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
      </div>

      <div className="relative flex min-h-screen flex-col justify-center px-8">
        <div
          aria-hidden
          className="absolute inset-0 isolate -z-10 hidden opacity-60 contain-strict md:block"
        >
          <div className="absolute top-0 right-0 h-320 w-140 -translate-y-87.5 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,--theme(--color-foreground/.06)_0,hsla(0,0%,55%,.02)_50%,--theme(--color-foreground/.01)_80%)]" />
          <div className="absolute top-0 right-0 h-320 w-60 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)] [translate:5%_-50%]" />
          <div className="absolute top-0 right-0 h-320 w-60 -translate-y-87.5 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)]" />
        </div>

        <div className="mx-auto w-full max-w-sm space-y-5">
          <div className="flex flex-col items-center space-y-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheckIcon className="h-7 w-7 text-primary" />
            </div>
            <h1 className="font-bold text-2xl tracking-wide">
              Set New Password
            </h1>
            <p className="text-base text-muted-foreground">
              Create a strong password for your account.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleReset} className="space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-sm font-medium leading-none"
              >
                New Password
              </label>
              <InputGroup>
                <InputGroupInput
                  id="password"
                  placeholder="Enter new password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  required
                  minLength={8}
                />
                <InputGroupAddon align="inline-start">
                  <LockKeyholeIcon className="h-4 w-4" />
                </InputGroupAddon>
                <InputGroupAddon align="inline-end">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOffIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                </InputGroupAddon>
              </InputGroup>

              {/* Strength bar */}
              {password.length > 0 && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <div
                        key={n}
                        className={`h-1 flex-1 rounded-full transition-colors ${n <= strength ? strengthColor : "bg-muted"}`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {strengthLabel}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="confirm"
                className="text-sm font-medium leading-none"
              >
                Confirm Password
              </label>
              <InputGroup>
                <InputGroupInput
                  id="confirm"
                  placeholder="Confirm new password"
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError(null);
                  }}
                  required
                  minLength={8}
                />
                <InputGroupAddon align="inline-start">
                  <LockKeyholeIcon className="h-4 w-4" />
                </InputGroupAddon>
                <InputGroupAddon align="inline-end">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={
                      showConfirm ? "Hide password" : "Show password"
                    }
                  >
                    {showConfirm ? (
                      <EyeOffIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                </InputGroupAddon>
              </InputGroup>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-destructive">
                  Passwords do not match
                </p>
              )}
            </div>

            <div className="space-y-1 rounded-md border bg-muted/50 px-3 py-2">
              <p className="text-xs font-medium">Password requirements:</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                <li
                  className={
                    password.length >= 8
                      ? "text-green-600 dark:text-green-400"
                      : ""
                  }
                >
                  {password.length >= 8 ? "\u2713" : "\u25CB"} At least 8
                  characters
                </li>
                <li
                  className={
                    /[A-Z]/.test(password)
                      ? "text-green-600 dark:text-green-400"
                      : ""
                  }
                >
                  {/[A-Z]/.test(password) ? "\u2713" : "\u25CB"} One uppercase
                  letter
                </li>
                <li
                  className={
                    /[a-z]/.test(password)
                      ? "text-green-600 dark:text-green-400"
                      : ""
                  }
                >
                  {/[a-z]/.test(password) ? "\u2713" : "\u25CB"} One lowercase
                  letter
                </li>
                <li
                  className={
                    /[0-9]/.test(password)
                      ? "text-green-600 dark:text-green-400"
                      : ""
                  }
                >
                  {/[0-9]/.test(password) ? "\u2713" : "\u25CB"} One number
                </li>
              </ul>
            </div>

            <Button
              className="w-full"
              type="submit"
              disabled={loading || password !== confirmPassword}
            >
              {loading && (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              )}
              Update Password
            </Button>
          </form>

          <div className="text-center">
            <Link
              href="/signin"
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
