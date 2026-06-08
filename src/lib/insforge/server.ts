import { cache } from "react";

import { createClient as createInsforgeClient } from "@insforge/sdk";

import { readAccessToken, refreshAccessTokenIfPossible } from "./cookies";

/**
 * SSR InsForge client backed by Next.js cookies. Imported as
 * `import { createClient } from "@/lib/insforge/server"` from
 * server components, route handlers, and server actions.
 *
 * Per the migrate-frontend-sdk skill's canonical SSR pattern, the
 * access token is read from the app-managed `insforge_access_token`
 * httpOnly cookie (set by `src/app/(site)/auth/callback/route.ts`
 * on OAuth completion) and forwarded as `edgeFunctionToken`. That
 * makes every `client.database.*` / `client.storage.*` call execute
 * with the signed-in user's identity (RLS applies).
 *
 * Per-request memoization (audit Finding 11): both `createClient`
 * and `getAuthUser` are wrapped with React's `cache()` so multiple
 * server components / route handlers / nested helpers in the same
 * request share a single client and a single `getCurrentUser()`
 * round-trip. This is the canonical Next.js 15 + React 19 pattern
 * (https://react.dev/reference/react/cache) — the cache is scoped
 * to one request and torn down at request end, so no cross-request
 * leakage.
 *
 * Caveat: `cache()` only works inside Server Components, Route
 * Handlers, and Server Actions (Node runtime). Do NOT call these
 * helpers from middleware — middleware runs in the Edge runtime
 * and uses its own dedicated `exchangeRefreshToken` path in
 * `./refresh.ts`.
 */

type InsforgeClient = ReturnType<typeof createInsforgeClient>;

/**
 * Build an SSR client bound to the request's access cookie.
 * Memoized per-request — callers in the same request get the same
 * instance, so we never instantiate the SDK twice for one user
 * action.
 */
export const createClient = cache(async (): Promise<InsforgeClient> => {
  const accessToken = await readAccessToken();
  return createInsforgeClient({
    baseUrl: process.env.INSFORGE_BASE_URL!,
    anonKey: process.env.INSFORGE_ANON_KEY!,
    isServerMode: true,
    edgeFunctionToken: accessToken,
  } as Parameters<typeof createInsforgeClient>[0]);
});

/**
 * Resolve the authenticated user for this request.
 *
 * Returns null when no valid session is present.
 *
 * Refresh path: if the first `getCurrentUser()` call fails (expired
 * access token, server clock skew between middleware and the route
 * handler, etc.), we try one refresh-token exchange via
 * `refreshAccessTokenIfPossible` and retry once. This mirrors the
 * middleware refresh and protects routes that are reached without
 * passing through middleware (e.g. internal RSC fetches that may
 * carry stale cookies). Audit Findings 1.1, 1.2.
 *
 * Per-request memoization (Finding 11): wrapped with `cache()` so
 * the chat / dashboard pages that resolve auth in three or four
 * places per request hit InsForge exactly once. After a successful
 * refresh the second `getCurrentUser()` call is also covered by the
 * cache for the rest of the request.
 */
export const getAuthUser = cache(async (): Promise<{
  user: { id: string; email?: string | null; [k: string]: unknown };
  db: InsforgeClient;
} | null> => {
  const client = await createClient();
  try {
    const first = await client.auth.getCurrentUser();
    if (first.data?.user && !first.error) {
      return { user: first.data.user, db: client };
    }
  } catch {
    // Fall through to refresh attempt.
  }

  const refreshed = await refreshAccessTokenIfPossible();
  if (!refreshed) return null;

  // Build a fresh client picking up the rotated cookie. We
  // intentionally create a new instance here (bypassing the cached
  // `createClient`) so the new bearer is used for the retry.
  const client2 = createInsforgeClient({
    baseUrl: process.env.INSFORGE_BASE_URL!,
    anonKey: process.env.INSFORGE_ANON_KEY!,
    isServerMode: true,
    edgeFunctionToken: refreshed,
  } as Parameters<typeof createInsforgeClient>[0]);

  try {
    const { data, error } = await client2.auth.getCurrentUser();
    if (error || !data?.user) return null;
    return { user: data.user, db: client2 };
  } catch {
    return null;
  }
});
