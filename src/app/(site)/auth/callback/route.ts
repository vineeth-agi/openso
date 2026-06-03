import { headers, cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createClient as createInsforgeClient } from "@insforge/sdk";

import { createAdminClient } from "@/lib/insforge/admin";
import {
  clearCodeVerifierCookie,
  readCodeVerifier,
  setAuthCookies,
} from "@/lib/insforge/cookies";

/** Only allow same-origin relative paths to prevent open redirect */
function safeRedirectPath(raw: string | null, fallback = "/chat"): string {
  if (!raw) return fallback;
  // Must start with / but not // (protocol-relative) and not contain a protocol
  if (/^\/(?!\/)[^]*$/.test(raw) && !raw.includes(":")) return raw;
  return fallback;
}

/** Resolve the real origin respecting reverse proxies (ngrok, Vercel, etc.) */
async function getOrigin(request: Request): Promise<string> {
  const hdrs = await headers();
  const forwardedHost = hdrs.get("x-forwarded-host");
  const forwardedProto = hdrs.get("x-forwarded-proto") || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  const { origin } = new URL(request.url);
  return origin;
}

/**
 * OAuth callback handler — completes the InsForge PKCE flow.
 *
 * Flow:
 *   1. Read `insforge_code` (preferred) or legacy `code` from query.
 *   2. Read `insforge_code_verifier` from the httpOnly cookie set by
 *      the sign-in server action `startOAuth`.
 *   3. Call `client.auth.exchangeOAuthCode(code, codeVerifier)`.
 *   4. Persist `accessToken` and `refreshToken` to httpOnly cookies
 *      so subsequent SSR requests (`server.ts createClient`,
 *      middleware) see the user as authenticated.
 *   5. Delete the verifier cookie.
 *   6. Redirect to `redirect_to` (default `/chat`).
 *
 * Without step 4, the user would sign in successfully but every
 * SSR request afterwards would still see them as anonymous and
 * bounce them back to `/signin` — which is the bug you hit.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // InsForge OAuth uses `insforge_code`; the legacy backend used `code`.
  const code = searchParams.get("insforge_code") ?? searchParams.get("code");
  const type = searchParams.get("type"); // "recovery" | "magiclink" | null
  const redirectTo = safeRedirectPath(searchParams.get("redirect_to"));
  const origin = await getOrigin(request);

  if (!code) {
    console.error("[auth/callback] no code in query string");
    return NextResponse.redirect(`${origin}/signin?error=auth_callback_no_code`);
  }

  const codeVerifier = await readCodeVerifier();
  const allCookies = (await cookies()).getAll().map(c => `${c.name}=${c.name === "insforge_code_verifier" ? c.value : "[REDACTED]"}`);
  console.log("[auth/callback] Debugging PKCE:", {
    hasCode: !!code,
    hasVerifier: !!codeVerifier,
    codeVerifierLength: codeVerifier?.length ?? 0,
    cookies: allCookies,
    url: request.url,
  });

  const client = createInsforgeClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_BASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
    isServerMode: true,
  } as Parameters<typeof createInsforgeClient>[0]);

  try {
    const { data, error } = await client.auth.exchangeOAuthCode(
      code,
      codeVerifier!,
    );

    if (error || !data?.accessToken) {
      console.error(
        "[auth/callback] exchangeOAuthCode failed:",
        error?.message ?? "no accessToken in response",
        "verifier used:", codeVerifier ? `${codeVerifier.substring(0, 5)}...` : "undefined"
      );
      await clearCodeVerifierCookie();
      return NextResponse.redirect(
        `${origin}/signin?error=auth_callback_exchange_failed`,
      );
    }

    await setAuthCookies(data.accessToken, data.refreshToken);
    await clearCodeVerifierCookie();

    // Bootstrap the public.profiles row for first-time OAuth signups.
    //
    // Why here: this is the single chokepoint every sign-in (Google,
    // GitHub, magic link) goes through. The legacy backend setup
    // relied on the `on_auth_user_created` trigger; InsForge protects
    // the `auth` schema and silently drops user-defined triggers, so
    // without this bootstrap a brand-new user has a row in
    // `auth.users` but not in `public.profiles`. Any subsequent FK
    // insert (`connected_apps.user_id → profiles.id`,
    // `chat_session_summaries`, `agent_cron_jobs`, etc.) blows up
    // with 23503.
    //
    // We can't reuse `requireUser()` because we don't have a cookie-
    // bound SDK client yet (the cookies were just set above and the
    // SDK won't see them until the next request). Use the admin
    // client and the user we already have from the exchange.
    try {
      const exchangedUser = (data as { user?: { id: string; email?: string | null; profile?: Record<string, unknown> } }).user;
      if (exchangedUser?.id) {
        const profile = exchangedUser.profile ?? {};
        const fullName =
          (profile.full_name as string | undefined) ??
          (profile.name as string | undefined) ??
          exchangedUser.email ??
          null;
        const avatarUrl =
          (profile.avatar_url as string | undefined) ??
          (profile.picture as string | undefined) ??
          null;
        const admin = createAdminClient();
        await admin.database.from("profiles").upsert([
          {
            id: exchangedUser.id,
            email: exchangedUser.email ?? null,
            full_name: fullName,
            avatar_url: avatarUrl,
          }
        ], { onConflict: "id", ignoreDuplicates: true });
      }
    } catch (bootstrapErr) {
      // Don't fail the sign-in for a profile bootstrap issue. The
      // route handlers downstream call `requireUser()` which will
      // retry on every authenticated request.
      console.error("[auth/callback] profile bootstrap failed:", bootstrapErr);
    }

    if (type === "recovery") {
      return NextResponse.redirect(`${origin}/reset-password`);
    }
    return NextResponse.redirect(`${origin}${redirectTo}`);
  } catch (err) {
    console.error("[auth/callback] exchange threw:", err);
    await clearCodeVerifierCookie();
    return NextResponse.redirect(`${origin}/signin?error=auth_callback_error`);
  }
}
