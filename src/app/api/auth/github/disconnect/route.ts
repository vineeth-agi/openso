import { NextResponse } from "next/server";

import { disconnectApp, getConnectionAdmin } from "@/lib/connections";
import { getAuthUser } from "@/lib/insforge/server";

/**
 * POST /api/auth/github/disconnect
 *
 * End-to-end disconnect flow:
 *   1. Best-effort revoke the GitHub OAuth grant on github.com using
 *      the access token stored in `connected_apps`. The previous
 *      implementation read this from a `github_token` cookie that no
 *      code path ever sets, so the grant was never actually revoked
 *      (audit Finding 4.1).
 *   2. Cancel in-flight ingestion jobs, wipe memory tables, and null
 *      the stored tokens via `disconnectApp` (audit Findings 4.2, 4.3).
 *      `disconnectApp` is the single source of truth — same code path
 *      runs from `/api/connections?provider=github` (DELETE).
 *   3. Clear `profiles.github_*` flags so the dashboard reflects the
 *      disconnect immediately.
 *
 * Token revocation uses GitHub's OAuth Apps "Delete an app
 * authorization" endpoint (DELETE /applications/{client_id}/grant)
 * authenticated with HTTP Basic (client_id:client_secret). See:
 *   https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-authorization
 *
 * The grant deletion makes the user see a fresh consent screen on
 * the next OAuth flow.
 */
export async function POST() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user } = auth;

  // 1. Revoke at GitHub. Read the encrypted token from `connected_apps`.
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    try {
      const conn = await getConnectionAdmin(user.id, "github");
      const ghToken = conn?.access_token;
      if (ghToken) {
        const basic = Buffer.from(
          `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`,
        ).toString("base64");
        const res = await fetch(
          `https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/grant`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Basic ${basic}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ access_token: ghToken }),
          },
        );
        if (!res.ok && res.status !== 204 && res.status !== 404) {
          console.warn(
            `[github/disconnect] GitHub grant revocation returned ${res.status}`,
          );
        }
      }
    } catch (err) {
      // Don't fail disconnect if revocation fails — local state still
      // gets cleaned up by step 2.
      console.warn("[github/disconnect] Failed to revoke GitHub grant:", err);
    }
  }

  // 2. Cancel jobs, wipe memory, null tokens, flip status.
  try {
    await disconnectApp(user.id, "github");
  } catch (err) {
    console.error("[github/disconnect] disconnectApp failed:", err);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 },
    );
  }

  // 3. Clear profile flags. Best-effort; not critical for security.
  try {
    const { createAdminClient } = await import("@/lib/insforge/admin");
    const adminDb = createAdminClient();
    await adminDb.database.from("profiles")
      .update({
        github_connected: false,
        github_username: null,
        github_languages: null,
        github_stats: null,
        github_summary: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);
  } catch (err) {
    console.warn("[github/disconnect] Failed to clear profile flags:", err);
  }

  return NextResponse.json({ success: true });
}
