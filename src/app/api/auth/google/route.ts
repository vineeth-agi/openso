import { NextResponse } from "next/server";

import { getAppUrl } from "@/lib/app-url";
import { getAuthUser } from "@/lib/insforge/server";
import { issueOAuthState } from "@/lib/security/oauth-state";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google?provider=gmail
 * Initiates Google OAuth flow.
 *
 * Security: passes a single-use random `state` nonce (Finding 5).
 * The callback consumes-and-deletes the nonce to recover userId + provider.
 */
export async function GET(request: Request) {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user } = auth;

  const { searchParams } = new URL(request.url);
  const requestedProvider = searchParams.get("provider") ?? "gmail";

  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID not configured" }, { status: 500 });
  }

  const validProviders = ["gmail"] as const;
  const provider: (typeof validProviders)[number] = (validProviders as readonly string[]).includes(
    requestedProvider,
  )
    ? (requestedProvider as "gmail")
    : "gmail";

  // Scopes per provider
  const scopeMap: Record<string, string[]> = {
    gmail: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
  };

  const scopes = scopeMap[provider] ?? scopeMap["gmail"];
  const appUrl = getAppUrl();
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  const state = await issueOAuthState(user.id, "google", { provider });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
