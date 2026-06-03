import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest configuration for the project's unit and property tests.
 *
 *   - The `@vitejs/plugin-react` plugin enables JSX/TSX parsing inside tests.
 *   - The `@/` alias mirrors the production `tsconfig.json` so imports inside
 *     tests resolve identically.
 *   - The default `environment` is `jsdom` so React component tests work
 *     out-of-the-box. Pure-Node tests can opt out via the
 *     `// @vitest-environment node` directive at the top of the file, but
 *     for our property/unit suite jsdom is a safe superset (jsdom exposes
 *     `URL`, `setInterval`, etc., that the pure-utility tests also use).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,property.test}.{ts,tsx}"],
    exclude: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "src/lib/open-agent/agent/**",
      "src/lib/open-agent/sandbox/**",
      "src/lib/open-agent/shared/**",
    ],
  },
});
