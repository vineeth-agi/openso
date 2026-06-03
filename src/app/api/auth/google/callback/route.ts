import { NextResponse } from "next/server";

import { getAppUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth/require-user";
import { upsertConnection } from "@/lib/connections";
import { consumeOAuthState } from "@/lib/security/oauth-state";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/callback?code=...&state=<nonce>
 * Handles Google OAuth callback.
 *
 * Security: validates `state` against the server-side nonce store (Finding 5).
 * The userId is recovered from the consumed nonce, never trusted from the URL.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const appUrl = getAppUrl();

  if (error || !code || !state) {
    console.error("[Google OAuth] Error or missing params:", error);
    return NextResponse.redirect(`${appUrl}/connectors?error=google_oauth_failed`);
  }

  // Validate-and-consume the state nonce.
  const consumed = await consumeOAuthState(state, "google");
  if (!consumed) {
    console.warn("[Google OAuth] Invalid or expired state nonce");
    return NextResponse.redirect(`${appUrl}/connectors?error=invalid_state`);
  }
  const userId = consumed.userId;
  const validGoogleProviders = ["gmail"] as const;
  const provider: "gmail" = (validGoogleProviders as readonly string[]).includes(
    String(consumed.metadata?.provider ?? ""),
  )
    ? (consumed.metadata.provider as "gmail")
    : "gmail";

  // Bootstrap the profile row before any FK-bearing insert
  // (`connected_apps.user_id` references `profiles.id`). On InsForge
  // the `auth.users` insert trigger does not fire, so this is the
  // place we materialise the row for first-time OAuth users. See
  // `src/lib/auth/require-user.ts`.
  await requireUser();

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(`${appUrl}/connectors?error=google_not_configured`);
  }

  try {
    // 1. Exchange code for tokens
    const redirectUri = `${appUrl}/api/auth/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("[Google OAuth] Token exchange failed:", err);
      return NextResponse.redirect(`${appUrl}/connectors?error=token_exchange_failed`);
    }

    const tokens = await tokenRes.json();
    const expiryDate = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null;

    // 2. Fetch user profile from Google
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : {};

    // 3. Store in connected_apps
    await upsertConnection(userId, provider, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expiry_date: expiryDate ?? undefined,
      scope: tokens.scope ?? null,
      account_email: profile.email ?? null,
      account_name: profile.name ?? null,
      account_avatar: profile.picture ?? null,
    });

    console.log(`[Google OAuth] Connected ${provider} for user ${userId} (${profile.email})`);
    return NextResponse.redirect(`${appUrl}/connectors?connected=${provider}`);
  } catch (err) {
    console.error("[Google OAuth] Callback error:", err);
    return NextResponse.redirect(`${appUrl}/connectors?error=google_callback_failed`);
  }
}
