import type { NextConfig } from "next";

/**
 * Content-Security-Policy (audit P1-4 + P2-6).
 *
 * Rollout strategy — one policy, two modes, switched by a single env var:
 *   - Default (CSP_ENFORCE unset or anything other than the string "true"):
 *     emitted as `Content-Security-Policy-Report-Only`. Browsers report
 *     violations but never block — this is the safe report-only rollout
 *     (P1-4). Wire up a report sink and watch for false positives.
 *   - CSP_ENFORCE === "true": the SAME policy string is emitted as the
 *     enforcing `Content-Security-Policy` header (P2-6). Flipping the env var
 *     in the deployment environment is the only change needed to enforce —
 *     no code edit, no redeploy of new logic.
 *
 * OPERATOR NOTE: `CSP_ENFORCE` must be added to the deployment environment
 * (Vercel project settings) and to the local `.env.example` so the switch is
 * discoverable. It is intentionally NOT defaulted to "true" here.
 *
 * Host list rationale — only BROWSER-originated connections belong in a CSP.
 * Server-to-server calls made from Route Handlers / server libs (GitHub API,
 * Google OAuth, Upstash QStash/Redis, Voyage, Firecrawl, Telegram, Daytona,
 * Codeforces, fxtwitter, alfa-leetcode) go out from the Node runtime and are
 * NOT subject to the browser CSP, so they are deliberately omitted:
 *   - img-src:    plain <img> avatars + next/image remotePatterns hosts —
 *                 GitHub (github.com, avatars.githubusercontent.com),
 *                 cdn.simpleicons.org, api.dicebear.com, storage.efferd.com,
 *                 and InsForge storage (*.insforge.app). `data:`/`blob:` cover
 *                 inline SVG/data-URI avatars and client-side upload previews.
 *   - connect-src: the browser InsForge SDK (@/lib/insforge/client) talks
 *                 directly to *.insforge.app for auth/database/storage.
 *                 Everything else is proxied through same-origin /api routes
 *                 (covered by 'self').
 */
const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com https://github.com https://cdn.simpleicons.org https://api.dicebear.com https://storage.efferd.com https://*.insforge.app",
  // TODO: replace with nonce-based script-src once middleware emits a per-request nonce
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://*.insforge.app",
];

// Build the policy string once. HTTP header values cannot contain raw
// newlines, so join the directives into a single line with "; ".
const CSP_VALUE = CSP_DIRECTIVES.join("; ");

/**
 * Returns the CSP header entry. Report-only by default; enforced only when
 * the operator sets `CSP_ENFORCE=true` in the environment.
 */
function cspHeader(): { key: string; value: string } {
  const enforce = process.env.CSP_ENFORCE === "true";
  return {
    key: enforce
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only",
    value: CSP_VALUE,
  };
}

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "ts", "tsx"],
  allowedDevOrigins: ["local.openso.dev"],
  /**
   * Exclude the Open Agents reference clone (`vendor/open-agents/`) and any
   * future read-only reference clones under `vendor/` from the Next.js build
   * output. Spec: open-agents-integration, Requirement 1.3.
   *
   * `outputFileTracingExcludes` removes the directory from the file-tracing
   * graph that Next.js uses to compute the production bundle's required
   * assets, so the clone never lands in `.next/` or in serverless function
   * payloads even when present on disk.
   */
  outputFileTracingExcludes: {
    "*": ["vendor/**"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "storage.efferd.com" },
      { protocol: "https", hostname: "github.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "cdn.simpleicons.org" },
    ],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    // cdn.simpleicons.org serves image/svg+xml. Next.js refuses SVGs by
    // default (XSS risk). Enable SVG handling with a strict CSP that blocks
    // any scripts or external resources inside the SVG, per Next.js docs.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  serverExternalPackages: [
    "@daytonaio/sdk",
    "import-in-the-middle",
    "@modelcontextprotocol/sdk",
    "unpdf",
    "mammoth",
  ],
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "react-icons",
      "@radix-ui/*",
      "date-fns",
      "@tanstack/react-table",
    ],
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  /**
   * Webpack-side guard for the Open Agents reference clone. Spec:
   * open-agents-integration, Requirement 1.3.
   *
   * `outputFileTracingExcludes` (above) keeps `vendor/**` out of the build
   * output, but webpack still scans the workspace for module resolution.
   * The `IgnorePlugin` below tells webpack to drop any module request that
   * resolves into a path containing `/vendor/`, so an accidental import of
   * `vendor/open-agents/...` from production code (which Requirement 1.4
   * forbids) fails fast at build time rather than silently bundling the
   * reference clone.
   */
  webpack: (config, { webpack }) => {
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /[\\/]vendor[\\/]/,
      }),
    );
    return config;
  },
  /**
   * Global security headers (Finding 14). HSTS, MIME sniffing, framing,
   * referrer policy, permissions policy, and now a Content-Security-Policy.
   *
   * The CSP ships in two modes via the `CSP_ENFORCE` env var (see the
   * `cspHeader()` / `CSP_DIRECTIVES` block at the top of this file):
   *   - Report-only by default (safe rollout, P1-4) — violations are
   *     reported but nothing is blocked.
   *   - Enforced when `CSP_ENFORCE=true` (P2-6) — the same policy becomes
   *     a blocking `Content-Security-Policy`.
   * `script-src` keeps `'unsafe-inline' 'unsafe-eval'` for now because the
   * Next.js 15 App Router emits inline bootstrap scripts; a nonce-based
   * policy needs middleware changes tracked separately. A working
   * report-only CSP we can tighten later beats a broken enforced one.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          cspHeader(),
        ],
      },
    ];
  },
};

export default nextConfig;
