/**
 * Edge-runtime-safe refresh-token exchange.
 *
 * Why a hand-rolled fetch instead of `client.auth.refreshSession()`:
 *   - The InsForge SDK's `index.mjs` transitively imports
 *     `socket.io-client` → `engine.io-client`, which uses
 *     `new Function(...)` for ESM globals. Next.js middleware runs
 *     in the Edge runtime by default, where dynamic code evaluation
 *     is forbidden (`Dynamic Code Evaluation … not allowed in Edge
 *     Runtime`). Importing the SDK from middleware therefore breaks
 *     `next build`.
 *   - This module talks to the public `/api/auth/refresh` endpoint
 *     directly using `fetch`, which works in both Edge and Node
 *     runtimes. The endpoint shape mirrors the SDK's
 *     `auth.refreshSession({ refreshToken })` in `isServerMode`:
 *       POST {baseUrl}/api/auth/refresh?client_type=mobile
 *       Authorization: Bearer {anonKey}
 *       Content-Type: application/json
 *       Body: { refresh_token: "<token>" }
 *     Response: { accessToken, refreshToken?, user, csrfToken? }
 *   - Source: node_modules/@insforge/sdk/dist/index.mjs:1137 (public
 *     refreshSession) and 788 (internal refreshAccessToken).
 *
 * No cookie writes here — the caller is responsible for persisting
 * the rotated tokens on the appropriate jar (`next/headers` cookies
 * for route handlers, `response.cookies` inside middleware).
 */

export interface RefreshedSession {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Exchange a refresh token for a new access token (and possibly a
 * rotated refresh token) against InsForge.
 *
 * Returns null on any failure — no special-casing of error codes,
 * because the only correct response to "refresh failed" is to clear
 * the cookie and redirect to /signin. Caller decides which jar to
 * mutate.
 */
export async function exchangeRefreshToken(
  refreshToken: string,
): Promise<RefreshedSession | null> {
  const baseUrl = process.env.INSFORGE_BASE_URL;
  const anonKey = process.env.INSFORGE_ANON_KEY;
  if (!baseUrl || !anonKey || !refreshToken) return null;

  const url = `${baseUrl.replace(/\/$/, "")}/api/auth/refresh?client_type=mobile`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      // We deliberately do NOT forward browser cookies — InsForge is
      // cross-origin from the app. The bearer + body carry all auth.
      cache: "no-store",
    });

    if (!res.ok) return null;

    const data = (await res.json()) as Partial<RefreshedSession> | null;
    if (!data?.accessToken) return null;

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
  } catch {
    return null;
  }
}
