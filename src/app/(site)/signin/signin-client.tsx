"use client";

import React, { useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { startOAuth } from "./actions";

import { AuthLayout, AuthFooter, GoogleIcon } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";

export default function SignInClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const successMsg =
    searchParams.get("message") === "password_updated"
      ? "Password updated successfully. Sign in with your new password."
      : null;
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleOAuth = async (provider: "google") => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const rawRedirect = searchParams.get("redirect_to");
      const intendedPath =
        rawRedirect && /^\/(?!\/)[^]*$/.test(rawRedirect) && !rawRedirect.includes(":")
          ? rawRedirect
          : "/chat";
      const callbackUrl = new URL(`${window.location.origin}/auth/callback`);
      callbackUrl.searchParams.set("redirect_to", intendedPath);

      // PKCE flow: server action issues the OAuth URL + stores the
      // code verifier in an httpOnly cookie. Browser then redirects
      // to the provider; provider redirects back to /auth/callback
      // with `?insforge_code=...`, which exchanges the code and sets
      // the access/refresh cookies before redirecting to /chat.
      const result = await startOAuth(provider, callbackUrl.toString());
      if ("error" in result) {
        setError(result.error);
        setIsLoading(false);
        return;
      }
      window.location.assign(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="flex flex-col space-y-1">
        <h1 className="font-bold text-2xl tracking-wide">
          Welcome Back
        </h1>
        <p className="text-base text-muted-foreground">
          Sign in to continue to your dashboard.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="rounded-md border border-green-500/50 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          {successMsg}
        </div>
      )}

      <div className="space-y-2">
        <Button
          className="w-full"
          variant="outline"
          onClick={() => handleOAuth("google")}
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              Connecting...
            </span>
          ) : (
            <>
              <GoogleIcon className="mr-2 h-5 w-5" />
              Continue with Google
            </>
          )}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        By continuing, you agree to our{" "}
        <Link href="/terms" className="underline hover:text-foreground">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <span className="text-foreground">Just continue with Google above — your account is created automatically.</span>
      </p>

      <AuthFooter />
    </AuthLayout>
  );
}
