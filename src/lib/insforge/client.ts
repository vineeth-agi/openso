import { createClient as createInsforgeClient } from "@insforge/sdk";

/**
 * Browser InsForge client. Imported as
 * `import { createClient } from "@/lib/insforge/client"` from
 * client components and other browser-side modules.
 */
export function createClient() {
  return createInsforgeClient({
    baseUrl: process.env.INSFORGE_BASE_URL!,
    anonKey: process.env.INSFORGE_ANON_KEY!,
  });
}
