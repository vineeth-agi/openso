/**
 * Preservation Property Tests — Retained Connectors Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * These tests capture the baseline behavior of the retained connectors
 * (GitHub, Resume, Telegram) on the UNFIXED code. They must PASS
 * both before and after the fix, confirming no regressions.
 *
 * Observation-first methodology:
 * - GitHub OAuth route functions correctly (separate route, untouched)
 * - Connection management functions accept "github"
 * - fetchNativeAppTools correctly loads GitHub tools
 * - Connectors page renders GitHub, Resume, and Telegram cards
 */
// @vitest-environment node
import * as fc from "fast-check";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "../../../../");

/**
 * The set of valid/retained OAuth providers.
 */
const VALID_PROVIDERS = ["github"] as const;
type ValidProvider = (typeof VALID_PROVIDERS)[number];

/**
 * Arbitrary that samples from the valid provider set.
 */
const validProviderArb: fc.Arbitrary<ValidProvider> = fc.constantFrom(...VALID_PROVIDERS);

/**
 * Arbitrary that generates random strings that are NOT valid providers.
 * These should be rejected by the system.
 */
const invalidProviderArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(
    (s) =>
      s !== "github" &&
      s !== "google_calendar" &&
      s !== "google_docs" &&
      s !== "google_sheets" &&
      s !== "google_meet" &&
      s !== "notion" &&
      s !== "linkedin"
  );

/**
 * Helper: Read a file's content safely.
 */
function readFileContent(filePath: string): string {
  const fullPath = path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(fullPath)) return "";
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Helper: Check if a file exists.
 */
function pathExists(relativePath: string): boolean {
  return fs.existsSync(path.resolve(PROJECT_ROOT, relativePath));
}

describe("Preservation: Retained Connectors (GitHub, Resume, Telegram) Unchanged", () => {
  describe("Connection management functions accept valid providers", () => {
    it("Property 2: For all valid provider inputs, the Provider type includes them in connections.ts", () => {
      const connectionsContent = readFileContent("src/lib/connections.ts");

      fc.assert(
        fc.property(validProviderArb, (provider) => {
          // The Provider type MUST include "github"
          const typeRegex = new RegExp(`["']${provider}["']`);
          const hasProvider = typeRegex.test(connectionsContent);
          expect(hasProvider).toBe(true);
        }),
        { numRuns: VALID_PROVIDERS.length * 5 }
      );
    });

    it("Property 2: For all valid provider inputs, the connections API route accepts them", () => {
      const connectionsRouteContent = readFileContent(
        "src/app/api/connections/route.ts"
      );

      fc.assert(
        fc.property(validProviderArb, (provider) => {
          // The validProviders array in the connections route MUST include this provider
          const providerRegex = new RegExp(`["']${provider}["']`);
          const hasProvider = providerRegex.test(connectionsRouteContent);
          expect(hasProvider).toBe(true);
        }),
        { numRuns: VALID_PROVIDERS.length * 5 }
      );
    });
  });

  describe("Tool router loads correct native tools for valid providers", () => {
    it("Property 2: For all valid provider inputs, the tool router has a branch to load their tools", () => {
      const toolRouterContent = readFileContent("src/lib/tools/tool-router.ts");

      fc.assert(
        fc.property(validProviderArb, (provider) => {
          // The tool router MUST have a conditional branch for this provider
          const branchRegex = new RegExp(`["']${provider}["']`);
          const hasBranch = branchRegex.test(toolRouterContent);
          expect(hasBranch).toBe(true);
        }),
        { numRuns: VALID_PROVIDERS.length * 5 }
      );
    });

    it("Property 2: For all valid provider inputs, native tool builder files exist", () => {
      const RETAINED_TOOL_FILES: Record<ValidProvider, string> = {
        github: "src/lib/tools/native-tools/github.ts",
      };

      fc.assert(
        fc.property(validProviderArb, (provider) => {
          const toolFile = RETAINED_TOOL_FILES[provider];
          const exists = pathExists(toolFile);
          expect(exists).toBe(true);
        }),
        { numRuns: VALID_PROVIDERS.length * 5 }
      );
    });
  });

  describe("Invalid providers are rejected by the system", () => {
    it("Property 2: For any random provider string NOT in the valid set, the connections API validProviders array does not include it", () => {
      const connectionsRouteContent = readFileContent(
        "src/app/api/connections/route.ts"
      );

      // Extract the validProviders array from the source
      const validProvidersMatch = connectionsRouteContent.match(
        /const validProviders\s*=\s*\[([\s\S]*?)\]/
      );
      expect(validProvidersMatch).not.toBeNull();

      const validProvidersArrayStr = validProvidersMatch![1];

      fc.assert(
        fc.property(invalidProviderArb, (randomProvider) => {
          // A random string that is not a known provider should NOT appear
          // in the validProviders array as a quoted string
          const exactMatch = new RegExp(`["']${escapeRegex(randomProvider)}["']`);
          const isInArray = exactMatch.test(validProvidersArrayStr);
          expect(isInArray).toBe(false);
        }),
        { numRuns: 50 }
      );
    });
  });

  describe("APPS array contains GitHub OAuth entry", () => {
    it("Property 2: The APPS array contains entry for GitHub", () => {
      const connectorsPageContent = readFileContent(
        "src/app/(site)/(dashboard)/connectors/page.tsx"
      );

      fc.assert(
        fc.property(validProviderArb, (provider) => {
          // The APPS array MUST have a provider entry for github
          const providerEntryRegex = new RegExp(
            `provider:\\s*["']${provider}["']`
          );
          const hasAppEntry = providerEntryRegex.test(connectorsPageContent);
          expect(hasAppEntry).toBe(true);
        }),
        { numRuns: VALID_PROVIDERS.length * 5 }
      );
    });

    it("Property 2: The APPS array currently contains at least 1 OAuth entry (GitHub)", () => {
      const connectorsPageContent = readFileContent(
        "src/app/(site)/(dashboard)/connectors/page.tsx"
      );

      // Count all provider entries in the APPS array
      const providerEntries = connectorsPageContent.match(
        /provider:\s*["'][a-z_]+["']/g
      );
      expect(providerEntries).not.toBeNull();
      expect(providerEntries!.length).toBeGreaterThanOrEqual(1);

      // Specifically verify GitHub is among them
      const githubEntry = providerEntries!.some((e) => e.includes("github"));
      expect(githubEntry).toBe(true);
    });
  });

  describe("Connectors page total count reflects retained apps", () => {
    it("Property 2: The connectors page includes Resume and Telegram cards (non-OAuth)", () => {
      const connectorsPageContent = readFileContent(
        "src/app/(site)/(dashboard)/connectors/page.tsx"
      );

      // The page must render a ResumeCard component
      expect(connectorsPageContent).toContain("ResumeCard");
      expect(connectorsPageContent).toContain("<ResumeCard");

      // The page must render a TelegramCard component
      expect(connectorsPageContent).toContain("TelegramCard");
      expect(connectorsPageContent).toContain("<TelegramCard");
    });

    it("Property 2: The totalApps calculation includes APPS.length + 2 (for Resume and Telegram)", () => {
      const connectorsPageContent = readFileContent(
        "src/app/(site)/(dashboard)/connectors/page.tsx"
      );

      // The totalApps must be computed as APPS.length + 2 (or a fixed value of 3 after fix)
      // On unfixed code: APPS.length + 2 = 8 + 2 = 10
      // After fix: APPS.length + 2 = 1 + 2 = 3
      // Preservation: the formula includes +2 for Resume and Telegram
      const hasTotalAppsCalc = /totalApps\s*=\s*APPS\.length\s*\+\s*2/.test(
        connectorsPageContent
      );
      // After fix, it might be a literal 3 instead
      const hasLiteralTotal = /totalApps\s*=\s*3/.test(connectorsPageContent);

      expect(hasTotalAppsCalc || hasLiteralTotal).toBe(true);
    });
  });



  describe("GitHub OAuth route is preserved", () => {
    it("Property 2: GitHub OAuth route file exists", () => {
      const exists = pathExists("src/app/api/auth/github/route.ts");
      expect(exists).toBe(true);
    });

    it("Property 2: GitHub OAuth callback route file exists", () => {
      const exists = pathExists("src/app/api/auth/github/callback/route.ts");
      expect(exists).toBe(true);
    });
  });
});

/**
 * Helper: Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
