/**
 * Single source of truth for the app's public origin.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_APP_URL  — explicit override (production + dev tunnels)
 *   2. VERCEL_URL           — auto-injected by Vercel on every deploy
 *   3. NEXT_PUBLIC_VERCEL_URL — public-side variant available in browser
 *   4. http://localhost:3000 — dev fallback
 *
 * In production we *refuse* to silently fall back to localhost. A bad env
 * config used to send users from openso.dev/signin → google → localhost:3000
 * after auth, with the ?code= still attached. That class of bug is
 * unrecoverable for the user, so we throw at startup instead.
 */

const LOCALHOST = "http://localhost:3000";

function isLocalhost(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url);
}

function normalize(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * Returns the canonical origin for this deployment.
 *
 * Throws in production if no public origin can be determined.
 */
export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return normalize(explicit);

  // Vercel auto-injects VERCEL_URL on every deployment.
  // Prefer NEXT_PUBLIC_VERCEL_URL when present (browser-readable).
  const vercel =
    process.env.NEXT_PUBLIC_VERCEL_URL?.trim() ||
    process.env.VERCEL_URL?.trim();
  if (vercel) return normalize(`https://${vercel}`);

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[app-url] NEXT_PUBLIC_APP_URL is not set in production. " +
        "Set it to your deployed origin (e.g. https://openso.dev) " +
        "to avoid OAuth redirects landing on localhost.",
    );
  }

  return LOCALHOST;
}

/**
 * Returns the canonical origin, but never throws — falls back to localhost.
 *
 * Use this in code paths that must not crash even with broken env (e.g.
 * top-level metadata for the marketing site). Prefer `getAppUrl()` everywhere
 * else.
 */
export function getAppUrlOrLocalhost(): string {
  try {
    return getAppUrl();
  } catch {
    return LOCALHOST;
  }
}

/**
 * Helper to detect the localhost-in-production foot-gun for tests + scripts.
 * Returns true only if the configured origin is a localhost variant.
 */
export function isLocalhostOrigin(url: string = getAppUrlOrLocalhost()): boolean {
  return isLocalhost(url);
}
