import { NextResponse } from "next/server";

import { getAppUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth/require-user";
import { upsertConnection } from "@/lib/connections";
import { createIngestionJob } from "@/lib/github-memory";
import { createAdminClient } from "@/lib/insforge/admin";
import { consumeOAuthState } from "@/lib/security/oauth-state";
import { workflowClient, workflowUrl } from "@/lib/workflow/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/github/callback?code=...&state=<nonce>
 * Handles GitHub OAuth callback.
 *
 * Security: validates `state` against the server-side nonce store (Finding 5).
 * The userId is recovered from the consumed nonce, never trusted from the
 * URL directly.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const appUrl = getAppUrl();

  if (error || !code || !state) {
    console.error("[GitHub OAuth] Error or missing params:", error);
    return NextResponse.redirect(`${appUrl}/connectors?error=github_oauth_failed`);
  }

  // Validate-and-consume the OAuth state nonce. Recover the originating userId.
  const consumed = await consumeOAuthState(state, "github");
  if (!consumed) {
    console.warn("[GitHub OAuth] Invalid or expired state nonce");
    return NextResponse.redirect(`${appUrl}/connectors?error=invalid_state`);
  }
  const userId = consumed.userId;

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return NextResponse.redirect(`${appUrl}/connectors?error=github_not_configured`);
  }

  // Bootstrap the profile row before any FK-bearing insert
  // (`connected_apps.user_id` references `profiles.id`). On InsForge
  // the `auth.users` insert trigger does not fire, so this is the
  // place we materialise the row for first-time OAuth users. See
  // `src/lib/auth/require-user.ts`.
  await requireUser();

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${appUrl}/api/auth/github/callback`,
      }),
    });

    if (!tokenRes.ok) {
      console.error("[GitHub OAuth] Token exchange failed:", tokenRes.status);
      return NextResponse.redirect(`${appUrl}/connectors?error=token_exchange_failed`);
    }

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error("[GitHub OAuth] Token error:", tokenData.error_description);
      return NextResponse.redirect(`${appUrl}/connectors?error=github_token_denied`);
    }

    const accessToken: string = tokenData.access_token;
    const scope: string = tokenData.scope ?? "";

    // 2. Fetch GitHub user profile
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!userRes.ok) {
      console.error("[GitHub OAuth] Failed to fetch user profile");
      return NextResponse.redirect(`${appUrl}/connectors?error=github_profile_failed`);
    }

    const ghUser = await userRes.json();

    // 3. Fetch primary email if not public
    let email = ghUser.email;
    if (!email) {
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github.v3+json" },
      });
      if (emailRes.ok) {
        const emails: { email: string; primary: boolean; verified: boolean }[] = await emailRes.json();
        email = emails.find(e => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
      }
    }

    // 4. Store in connected_apps
    await upsertConnection(userId, "github", {
      access_token: accessToken,
      scope,
      account_email: email ?? null,
      account_name: ghUser.name ?? ghUser.login,
      account_avatar: ghUser.avatar_url ?? null,
      github_username: ghUser.login,
    });

    // 5. Persist ingest-pending state, then trigger the Upstash
    //    Workflow. If the trigger fails (QStash unreachable, bad
    //    token, schedule misconfigured), the row is left in a
    //    'retrying' state with `next_retry_at` set so the
    //    `github-memory-retry` workflow picks it up on its next
    //    30-min tick (audit Finding 3.2).
    const jobId = await createIngestionJob(userId).catch((err) => {
      console.warn("[GitHub OAuth] createIngestionJob failed:", err);
      return null;
    });

    const triggered = await workflowClient
      .trigger({
        url: workflowUrl("github-memory-ingest"),
        body: { userId },
        retries: 3,
      })
      .then(() => true, (err: unknown) => {
        console.warn(
          "[GitHub OAuth] Failed to trigger GitHub Memory ingestion:",
          err,
        );
        return false;
      });

    if (!triggered && jobId) {
      try {
        const admin = createAdminClient();
        await admin.database.from("github_ingestion_jobs")
          .update({
            status: "retrying",
            next_retry_at: new Date(Date.now() + 60_000).toISOString(),
            last_error: "initial trigger failed",
            last_error_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      } catch (e) {
        console.warn("[GitHub OAuth] Failed to mark job for retry:", e);
      }
    }

    console.log(`[GitHub OAuth] Connected github for user ${userId} (${ghUser.login})`);
    return NextResponse.redirect(`${appUrl}/connectors?connected=github`);
  } catch (err) {
    console.error("[GitHub OAuth] Callback error:", err);
    return NextResponse.redirect(`${appUrl}/connectors?error=github_callback_failed`);
  }
}
