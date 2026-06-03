import { NextResponse } from "next/server";

import { getAppUrl } from "@/lib/app-url";
import { getAuthUser } from "@/lib/insforge/server";
import { issueOAuthState } from "@/lib/security/oauth-state";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/github
 * Initiates GitHub OAuth flow.
 *
 * Security: passes a single-use random `state` nonce instead of the user's
 * UUID (Finding 5). The callback consumes-and-deletes the nonce to recover
 * the originating userId.
 */
export async function GET(_request: Request) {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user } = auth;

  if (!process.env.GITHUB_CLIENT_ID) {
    return NextResponse.json({ error: "GITHUB_CLIENT_ID not configured" }, { status: 500 });
  }

  const appUrl = getAppUrl();
  const redirectUri = `${appUrl}/api/auth/github/callback`;

  const state = await issueOAuthState(user.id, "github");

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "repo read:user user:email",
    state,
  });

  return NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`
  );
}
