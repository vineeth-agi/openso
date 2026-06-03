"use server";

import { createClient as createInsforgeClient } from "@insforge/sdk";

import { setCodeVerifierCookie } from "@/lib/insforge/cookies";

/**
 * Begin an OAuth PKCE flow with InsForge.
 *
 * Steps (per migrate-frontend-sdk SKILL):
 *   1. Call `signInWithOAuth({ provider, redirectTo, skipBrowserRedirect: true })`
 *      → returns `{ url, codeVerifier }`.
 *   2. Persist `codeVerifier` to the `insforge_code_verifier` httpOnly
 *      cookie so `/auth/callback` can read it back.
 *   3. Return `url` to the client, which calls `window.location.assign(url)`.
 *
 * `redirectTo` MUST be the app URL (NOT InsForge), per skill note —
 * InsForge appends `?insforge_code=<code>` and redirects there.
 */
export async function startOAuth(
  provider: "google",
  redirectTo: string,
): Promise<{ url: string } | { error: string }> {
  const client = createInsforgeClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_BASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
    isServerMode: true,
  } as Parameters<typeof createInsforgeClient>[0]);

  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    redirectTo,
    skipBrowserRedirect: true,
  });

  if (error || !data?.url) {
    return { error: error?.message ?? "Failed to start OAuth flow" };
  }

  if (data.codeVerifier) {
    await setCodeVerifierCookie(data.codeVerifier);
  }

  return { url: data.url };
}
