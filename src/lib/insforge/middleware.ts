import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  REFRESH_COOKIE,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
  isAccessTokenExpired,
} from "./cookies";
import { exchangeRefreshToken } from "./refresh";

/**
 * Auth middleware — InsForge edition (Edge-runtime safe).
 *
 * Behaviour:
 *   - Public paths bypass auth entirely.
 *   - Non-public paths require an access-token cookie that is not
 *     expired. If the access cookie is missing or its JWT `exp`
 *     claim has lapsed (with a 30s skew margin), we attempt a
 *     refresh-token exchange in-band and write the rotated cookies
 *     onto the outgoing response. Only when refresh fails do we
 *     redirect to /signin.
 *
 * Why we do the refresh inside middleware rather than relying on
 * data-tier 401s:
 *   - `auth.getCurrentUser()` succeeds against InsForge while the
 *     access JWT is still valid, but our short 15-min cookie can
 *     outlive a stale token in the browser. Without a refresh path
 *     the user gets stuck on a "logged-in" UI whose every request
 *     401s. (Audit Findings 1.1, 1.2.)
 *   - Refreshing here keeps the redirect loop short (one hop) and
 *     avoids each protected route handler reimplementing the dance.
 *
 * Why a hand-rolled fetch via `exchangeRefreshToken` instead of
 * `client.auth.refreshSession()`:
 *   - The InsForge SDK transitively imports `socket.io-client`,
 *     which uses `new Function(...)` — forbidden in the Edge
 *     runtime. Calling the SDK from middleware breaks `next build`.
 *     `exchangeRefreshToken` talks to `/api/auth/refresh` directly
 *     using `fetch`, which is Edge-compatible.
 *
 * Cookie writes use `response.cookies.set(...)` because
 * `cookies()` from `next/headers` is read-only inside middleware
 * (Next.js 15 docs: "Cookies can only be modified in a Server
 * Action or Route Handler"). The middleware's response carries the
 * Set-Cookie header forward.
 */

const PUBLIC_PATHS = [
  "/",
  "/signin",
  "/auth",
  "/about",
  "/contact",
  "/faq",
  "/pricing",
  "/privacy",
  "/terms",
  "/profile/",
  "/portfolio",
  "/api/workflow",
  "/api/auth",
  "/api/connect",
  "/api/telegram",
  "/api/cron",
  "/api/location",
  "/api/views",
  "/api/socials",
  "/api/github-contributions",
  "/api/portfolio-chat",
];

const STATIC_PREFIXES = [
  "/_next",
  "/favicon",
  "/og-image",
  // Next.js metadata file convention: `app/opengraph-image.tsx` and
  // `app/twitter-image.tsx` are served from these public routes. They must
  // bypass auth, otherwise social scrapers (Facebook, LinkedIn, X, Slack,
  // Discord) get redirected to /signin and the preview falls back to
  // nothing — which is exactly the stale-OG bug we're fixing.
  "/opengraph-image",
  "/twitter-image",
  "/fonts",
  "/images",
];

function isPublicPath(pathname: string): boolean {
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (/\.\w{2,5}$/.test(pathname)) return true;
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + "/"),
  );
}

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname === "/portfolio") {
    return new NextResponse(null, { status: 404 });
  }

  if (pathname === "/dashboard") {
    const url = request.nextUrl.clone();
    url.pathname = "/chat";
    return NextResponse.redirect(url);
  }

  if (isPublicPath(pathname)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-user-id");
    requestHeaders.delete("x-user-email");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Non-public path: validate the access-token cookie's expiry. We
  // deliberately do NOT round-trip to InsForge here for performance —
  // signature validation still happens at the data tier on every
  // query. We only check `exp` so we can refresh proactively before
  // returning a stale token to the route handler.
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-user-id");
  requestHeaders.delete("x-user-email");

  // Happy path: token present and unexpired → forward.
  if (accessToken && !isAccessTokenExpired(accessToken)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Token missing or expired → try refresh.
  if (refreshToken) {
    const refreshed = await exchangeRefreshToken(refreshToken);
    if (refreshed) {
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      response.cookies.set(ACCESS_COOKIE, refreshed.accessToken, {
        ...COOKIE_OPTS,
        maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
      });
      if (refreshed.refreshToken) {
        response.cookies.set(REFRESH_COOKIE, refreshed.refreshToken, {
          ...COOKIE_OPTS,
          maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
        });
      }
      return response;
    }
  }

  // No refresh path available — clean signin redirect, preserving
  // the user's intended destination.
  const url = request.nextUrl.clone();
  url.pathname = "/signin";
  url.searchParams.set("redirect_to", request.nextUrl.pathname);
  const redirect = NextResponse.redirect(url);
  redirect.cookies.delete(ACCESS_COOKIE);
  redirect.cookies.delete(REFRESH_COOKIE);
  return redirect;
}
