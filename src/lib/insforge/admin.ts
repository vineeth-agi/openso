import { createClient } from "@insforge/sdk";

/**
 * Admin InsForge client (server-side only) using the admin API key.
 *
 * Backed by `@insforge/sdk` per the migrate-frontend-sdk skill's
 * "minimal-touch" pattern: the returned client exposes
 * `.database` / `.storage` / `.auth` surfaces that are
 * PostgREST-compatible.
 *
 * Uses the globalThis singleton pattern (industry standard for Next.js
 * serverless): survives HMR in development, reuses the same instance
 * across warm serverless invocations.
 */

type InsforgeClient = ReturnType<typeof createClient>;

const globalForInsforge = globalThis as unknown as {
  insforgeAdmin: InsforgeClient | undefined;
};

export function createAdminClient(): InsforgeClient {
  if (globalForInsforge.insforgeAdmin) {
    return globalForInsforge.insforgeAdmin;
  }

  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_BASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  const apiKey = process.env.INSFORGE_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Missing INSFORGE_BASE_URL or INSFORGE_API_KEY env variable.",
    );
  }

  const client = createClient({
    baseUrl,
    anonKey: anonKey ?? "",
    isServerMode: true,
    edgeFunctionToken: apiKey,
  } as Parameters<typeof createClient>[0]);

  globalForInsforge.insforgeAdmin = client;
  return client;
}
