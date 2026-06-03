import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";

/**
 * GET /api/auth/me
 *
 * Browser-callable endpoint that returns the current user + profile.
 *
 * Why this exists: the InsForge SDK's `auth.getCurrentUser()` and
 * `auth.refreshSession()` both need the access / refresh token. Our
 * tokens live in httpOnly cookies on `www.openso.dev`, but the SDK
 * tries to call `https://*.insforge.app/api/auth/...` (cross-origin),
 * and browsers do NOT send cookies cross-origin. So calling the
 * SDK directly from the browser returns 401.
 *
 * The server, however, can read the httpOnly cookie and forward
 * the bearer token to InsForge. This endpoint is the bridge.
 *
 * Refresh: `getAuthUser()` transparently refreshes once if the
 * access token has expired (audit Finding 1.3). The dashboard
 * shell polls this endpoint as a heartbeat, so a successful refresh
 * here also keeps the cookie hot for subsequent route hits.
 *
 * Caching: explicitly disabled — auth state must never be cached
 * by Next or any CDN in front of us (Next.js docs:
 * `dynamic = "force-dynamic"` opts out of static optimisation).
 *
 * Returns:
 *   200 { user: { id, email }, profile: { ... } | null }
 *   401 { error }   when no session
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const auth = await getAuthUser();
    if (!auth) {
      const res = NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
    const { user } = auth;

    // Fetch profile via the admin client. Uses admin to avoid RLS
    // edge cases on first-render after migration.
    let profile: {
      full_name?: string | null;
      avatar_url?: string | null;
      email?: string | null;
    } | null = null;
    try {
      const admin = createAdminClient();
      const { data: row } = await admin.database
        .from("profiles")
        .select("full_name, avatar_url, email")
        .eq("id", user.id)
        .maybeSingle();
      profile = (row as typeof profile) ?? null;
    } catch (err) {
      console.warn("[/api/auth/me] profile lookup failed", err);
    }

    const res = NextResponse.json({
      user: { id: user.id, email: user.email },
      profile,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("[/api/auth/me] failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
