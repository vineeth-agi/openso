import { NextResponse } from "next/server";

import { createClient as createInsforgeClient } from "@insforge/sdk";

import {
  clearAuthCookies,
  readAccessToken,
  readRefreshToken,
} from "@/lib/insforge/cookies";

/**
 * POST /api/auth/signout
 *
 * Two-step sign-out:
 *   1. Best-effort `auth.signOut()` against InsForge so the refresh
 *      token is server-side invalidated. Even if this fails (network
 *      blip, expired token), we still proceed to step 2 — the local
 *      cookies must be cleared.
 *   2. Clear the app-managed httpOnly auth cookies on this origin.
 *
 * Why both steps matter (audit Finding 2.1): without step 1 the
 * refresh token remains valid for up to 7 days. If it ever leaks
 * (XSS in a future regression, restored cookie-jar backup) the
 * attacker could keep minting access tokens. Calling `signOut()`
 * here closes that window.
 *
 * SameSite=Lax already mitigates cross-site CSRF on this POST in
 * modern browsers. As defense-in-depth (audit API-CRSF-1) we also
 * verify the Origin header matches the request Host when present.
 * Requests with NO Origin header (server-side calls, some same-origin
 * navigations) are allowed through — we only reject when an Origin is
 * present AND its host differs from the request host.
 */
export async function POST(req: Request) {
  // Origin/Referer defense-in-depth (audit API-CRSF-1).
  // Allow missing Origin (server-side / non-browser callers); only reject
  // a present Origin whose host does not match the request host.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host !== host) {
        return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Bad origin" }, { status: 403 });
    }
  }

  // 1. Best-effort revoke at InsForge.
  try {
    const accessToken = await readAccessToken();
    const refreshToken = await readRefreshToken();
    if (accessToken || refreshToken) {
      const client = createInsforgeClient({
        baseUrl: process.env.NEXT_PUBLIC_INSFORGE_BASE_URL!,
        anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
        isServerMode: true,
        edgeFunctionToken: accessToken,
      } as Parameters<typeof createInsforgeClient>[0]);
      await client.auth.signOut().catch((err: unknown) => {
        console.warn("[auth/signout] InsForge signOut() failed:", err);
      });
    }
  } catch (err) {
    console.warn("[auth/signout] revoke step threw:", err);
  }

  // 2. Always clear local cookies.
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
