import { cookies, headers } from "next/headers";

import { exchangeRefreshToken } from "./refresh";

/**
 * Canonical cookie helpers for the InsForge SSR auth flow.
 *
 * Three app-managed httpOnly cookies, set by our server (NOT by the
 * `@insforge/sdk` browser code, which does not touch them in
 * `isServerMode: true`):
 *
 *   - `insforge_access_token` (15 min)  — sent as bearer on every
 *     authenticated DB / storage / functions call. Read by
 *     `src/lib/insforge/server.ts` and `middleware.ts`.
 *   - `insforge_refresh_token` (7 days) — used to mint new access
 *     tokens via the InsForge `/api/auth/refresh` endpoint
 *     (`exchangeRefreshToken`).
 *   - `insforge_code_verifier` (10 min) — PKCE code verifier,
 *     written before the OAuth redirect, read once on callback.
 *
 * IMPORTANT: This module must remain Edge-runtime safe — middleware
 * imports `isAccessTokenExpired` from here. Do NOT add direct
 * `@insforge/sdk` imports; if you need to talk to InsForge's auth
 * API, route the call through `./refresh.ts` (plain `fetch`).
 *
 * InsForge SSR auth cookie helpers — see project docs.
 */

export const ACCESS_COOKIE = "insforge_access_token";
export const REFRESH_COOKIE = "insforge_refresh_token";
export const CODE_VERIFIER_COOKIE = "insforge_code_verifier";

/** Access cookie lifetime — must match InsForge's access-token TTL (15 min). */
export const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 15;
export const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

async function getCookieOpts() {
  let isSecure = process.env.NODE_ENV === "production";
  if (!isSecure) {
    try {
      const h = await headers();
      const proto = h.get("x-forwarded-proto");
      isSecure = proto === "https";
    } catch {
      // ignore
    }
  }
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function setAuthCookies(
  accessToken: string,
  refreshToken: string | undefined,
) {
  const s = await cookies();
  const opts = await getCookieOpts();
  s.set(ACCESS_COOKIE, accessToken, {
    ...opts,
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  });
  if (refreshToken) {
    s.set(REFRESH_COOKIE, refreshToken, {
      ...opts,
      maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
    });
  }
}

export async function clearAuthCookies() {
  const s = await cookies();
  s.delete(ACCESS_COOKIE);
  s.delete(REFRESH_COOKIE);
  s.delete(CODE_VERIFIER_COOKIE);
}

export async function setCodeVerifierCookie(v: string) {
  const opts = await getCookieOpts();
  (await cookies()).set(CODE_VERIFIER_COOKIE, v, { ...opts, maxAge: 60 * 10 });
}

export async function readAccessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function readRefreshToken() {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}

export async function readCodeVerifier() {
  return (await cookies()).get(CODE_VERIFIER_COOKIE)?.value;
}

export async function clearCodeVerifierCookie() {
  (await cookies()).delete(CODE_VERIFIER_COOKIE);
}

// ── JWT expiry helper ──────────────────────────────────────────────

/**
 * Returns true if the token is missing, malformed, or expires within
 * the next `skewSeconds` (default 30s clock-skew margin).
 *
 * Pure parsing — does not validate the signature. Signature validation
 * happens at the data tier when the token hits InsForge.
 *
 * Edge-safe: uses `atob` (available in both Node 18+ and Edge
 * runtime) instead of `Buffer.from(..., "base64url")`. We hand-decode
 * the URL-safe base64 manually since `atob` does not accept the
 * URL-safe alphabet directly.
 */
export function isAccessTokenExpired(jwt: string | undefined, skewSeconds = 30): boolean {
  if (!jwt) return true;
  const parts = jwt.split(".");
  if (parts.length !== 3) return true;
  try {
    // Convert base64url → base64, pad, then atob.
    let b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json =
      typeof atob === "function"
        ? atob(b64)
        : Buffer.from(b64, "base64").toString("utf8");
    // `atob` returns a binary string; for ASCII JSON this round-trips
    // fine.
    const payload = JSON.parse(json);
    if (typeof payload?.exp !== "number") return true;
    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return true;
  }
}

// ── Refresh path (Node-runtime route handlers only) ────────────────

/**
 * Best-effort: exchange the stored refresh token for a fresh access
 * token + (rotated) refresh token via InsForge's `/api/auth/refresh`
 * endpoint and persist both cookies.
 *
 * Returns the new access token if rotation succeeded, else null.
 *
 * Best-practice notes:
 *   - The implementation lives in `./refresh.ts` and uses plain
 *     `fetch` so it's safe in any runtime. We import it here, but
 *     this function itself uses `next/headers` cookies which are
 *     ONLY available in Server Actions and Route Handlers (Node
 *     runtime). Middleware should call `exchangeRefreshToken`
 *     directly and write to its own response cookie jar.
 *   - Refresh-token rotation: we always overwrite the refresh
 *     cookie if InsForge returns a rotated value (refresh-token
 *     rotation, OWASP ASVS V3.3.1). Otherwise we keep the existing
 *     refresh cookie.
 *   - Idempotent and safe to call on every request — the refresh
 *     endpoint cheaply rejects an invalid token; we return null and
 *     let the caller redirect to /signin.
 */
export async function refreshAccessTokenIfPossible(): Promise<string | null> {
  const refresh = await readRefreshToken();
  if (!refresh) return null;

  const refreshed = await exchangeRefreshToken(refresh);
  if (!refreshed) {
    // Refresh token is invalid or revoked — clear both cookies so
    // the next middleware pass cleanly redirects to /signin instead
    // of looping refresh attempts.
    const s = await cookies();
    s.delete(ACCESS_COOKIE);
    s.delete(REFRESH_COOKIE);
    return null;
  }

  await setAuthCookies(refreshed.accessToken, refreshed.refreshToken ?? refresh);
  return refreshed.accessToken;
}
