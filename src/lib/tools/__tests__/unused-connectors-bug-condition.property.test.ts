/**
 * Bug Condition Exploration Property Test
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5**
 *
 * This test encodes the EXPECTED behavior after the fix:
 * - For each unused provider, the codebase should NOT contain references to it.
 *
 * On UNFIXED code, this test is EXPECTED TO FAIL — failure confirms the bug exists.
 * The counterexamples document where unused connector references remain.
 */
// @vitest-environment node
import * as fc from "fast-check";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "../../../../");

/**
 * The set of unused providers that should be removed from the codebase.
 */
const UNUSED_PROVIDERS = [
  "gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_meet",
  "notion",
  "linkedin",
] as const;

type UnusedProvider = (typeof UNUSED_PROVIDERS)[number];

/**
 * Arbitrary that samples from the concrete set of unused providers.
 */
const unusedProviderArb: fc.Arbitrary<UnusedProvider> = fc.constantFrom(...UNUSED_PROVIDERS);

/**
 * Helper: Read a file's content safely.
 */
function readFileContent(filePath: string): string {
  const fullPath = path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(fullPath)) return "";
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Helper: Check if a file or directory exists.
 */
function pathExists(relativePath: string): boolean {
  return fs.existsSync(path.resolve(PROJECT_ROOT, relativePath));
}

/**
 * Map from provider slug to the native-tool builder file name.
 */
const NATIVE_TOOL_FILES: Record<UnusedProvider, string> = {
  gmail: "src/lib/tools/native-tools/gmail.ts",
  google_calendar: "src/lib/tools/native-tools/calendar.ts",
  google_docs: "src/lib/tools/native-tools/google-docs.ts",
  google_sheets: "src/lib/tools/native-tools/google-sheets.ts",
  google_meet: "src/lib/tools/native-tools/google-meet.ts",
  notion: "src/lib/tools/native-tools/notion.ts",
  linkedin: "src/lib/tools/native-tools/linkedin.ts",
};

/**
 * OAuth route files that should not exist for linkedin and notion.
 */
const OAUTH_ROUTE_FILES: Partial<Record<UnusedProvider, string[]>> = {
  linkedin: [
    "src/app/api/auth/linkedin/route.ts",
    "src/app/api/auth/linkedin/callback/route.ts",
  ],
  notion: [
    "src/app/api/connect/notion/route.ts",
    "src/app/api/connect/notion/callback/route.ts",
  ],
  gmail: [
    "src/app/api/auth/google/route.ts",
    "src/app/api/auth/google/callback/route.ts",
  ],
};

describe("Bug Condition: Unused Connectors Present in Codebase", () => {
  it("Property 1: For each unused provider, the ProviderSlug type does NOT include the provider", () => {
    const connectorsPageContent = readFileContent(
      "src/app/(site)/(dashboard)/connectors/page.tsx"
    );

    fc.assert(
      fc.property(unusedProviderArb, (provider) => {
        // The ProviderSlug type definition should NOT contain this provider
        const typeRegex = new RegExp(`["']${provider}["']`);
        const hasProviderInType = typeRegex.test(connectorsPageContent);
        expect(hasProviderInType).toBe(false);
      }),
      { numRuns: UNUSED_PROVIDERS.length * 3 }
    );
  });

  it("Property 1: For each unused provider, the APPS array does NOT contain an entry for the provider", () => {
    const connectorsPageContent = readFileContent(
      "src/app/(site)/(dashboard)/connectors/page.tsx"
    );

    fc.assert(
      fc.property(unusedProviderArb, (provider) => {
        // The APPS array should NOT have a provider entry for this slug
        const providerEntryRegex = new RegExp(
          `provider:\\s*["']${provider}["']`
        );
        const hasAppEntry = providerEntryRegex.test(connectorsPageContent);
        expect(hasAppEntry).toBe(false);
      }),
      { numRuns: UNUSED_PROVIDERS.length * 3 }
    );
  });

  it("Property 1: For each unused provider, the tool-router does NOT import or branch on the provider", () => {
    const toolRouterContent = readFileContent("src/lib/tools/tool-router.ts");

    fc.assert(
      fc.property(unusedProviderArb, (provider) => {
        // The tool-router should NOT reference this provider in imports or branches
        const providerRefRegex = new RegExp(`["']${provider}["']`);
        const hasReference = providerRefRegex.test(toolRouterContent);
        expect(hasReference).toBe(false);
      }),
      { numRuns: UNUSED_PROVIDERS.length * 3 }
    );
  });

  it("Property 1: For each unused provider, the connections Provider type does NOT include the provider", () => {
    const connectionsContent = readFileContent("src/lib/connections.ts");

    fc.assert(
      fc.property(unusedProviderArb, (provider) => {
        // The Provider type should NOT include this provider
        const typeRegex = new RegExp(`["']${provider}["']`);
        const hasProviderInType = typeRegex.test(connectionsContent);
        expect(hasProviderInType).toBe(false);
      }),
      { numRuns: UNUSED_PROVIDERS.length * 3 }
    );
  });

  it("Property 1: No OAuth route files exist for linkedin, notion, or gmail", () => {
    const providersWithRoutes: UnusedProvider[] = ["linkedin", "notion", "gmail"];
    const providerWithRoutesArb = fc.constantFrom(...providersWithRoutes);

    fc.assert(
      fc.property(providerWithRoutesArb, (provider) => {
        const routeFiles = OAUTH_ROUTE_FILES[provider] ?? [];
        for (const routeFile of routeFiles) {
          const exists = pathExists(routeFile);
          expect(exists).toBe(false);
        }
      }),
      { numRuns: providersWithRoutes.length * 3 }
    );
  });

  it("Property 1: No native-tool builder files exist for unused providers", () => {
    fc.assert(
      fc.property(unusedProviderArb, (provider) => {
        const toolFile = NATIVE_TOOL_FILES[provider];
        const exists = pathExists(toolFile);
        expect(exists).toBe(false);
      }),
      { numRuns: UNUSED_PROVIDERS.length * 3 }
    );
  });
});
