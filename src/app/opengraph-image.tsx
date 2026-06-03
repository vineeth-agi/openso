import { ImageResponse } from "next/og";

import { readFile } from "node:fs/promises";
import path from "node:path";


/**
 * Dynamic Open Graph image for the marketing site.
 *
 * Why this file exists:
 *   Next.js maps `app/opengraph-image.tsx` to a generated 1200x630 PNG that
 *   automatically populates `og:image` (and `twitter:image` when paired with
 *   `twitter-image.tsx`). Because the URL is content-addressed by Next.js
 *   (`/opengraph-image-<hash>.png`), social scrapers cache by hash, so any
 *   redesign of this component invalidates external caches automatically —
 *   no need to manually purge Facebook/LinkedIn/Twitter debuggers.
 *
 * Visual:
 *   We mirror the live header look — the "openso" wordmark, the
 *   "AI-Powered Open Source Platform" pill from the hero, the H1, and a
 *   short tagline — over a dark background that matches the site theme
 *   (forced dark mode in `(site)/layout.tsx`).
 *
 * Runtime:
 *   `nodejs` (default for the App Router file convention). We deliberately
 *   avoid `runtime = "edge"` so we can `readFile()` DM Sans from disk.
 *   At ISR / build time the function runs once per deploy and the result
 *   is cached on the edge.
 */

export const alt =
  "Openso — The everything platform for open-source devs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFont(file: string): Promise<ArrayBuffer> {
  const fontPath = path.join(process.cwd(), "fonts", "dm-sans", file);
  const buf = await readFile(fontPath);
  // Node's Buffer is a Uint8Array; copy into a plain ArrayBuffer for Satori.
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

export default async function OpenGraphImage(): Promise<ImageResponse> {
  const [regular, semibold, bold] = await Promise.all([
    loadFont("DMSans-Regular.ttf"),
    loadFont("DMSans-SemiBold.ttf"),
    loadFont("DMSans-Bold.ttf"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0B0D0E",
          // Subtle radial highlight matching the dark theme.
          backgroundImage:
            "radial-gradient(circle at 30% 20%, rgba(148,163,184,0.18) 0%, rgba(11,13,14,0) 55%), radial-gradient(circle at 80% 90%, rgba(94,234,212,0.10) 0%, rgba(11,13,14,0) 50%)",
          color: "#FFFFFF",
          fontFamily: "DM Sans",
          padding: "72px 80px",
          position: "relative",
        }}
      >
        {/* Top bar: mimics the floating header pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {/* Wordmark */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#FFFFFF",
            }}
          >
            openso
          </div>

          {/* "Get Started" chip — same affordance as the live header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 22px",
              borderRadius: 999,
              backgroundColor: "#FFFFFF",
              color: "#0B0D0E",
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            Get Started →
          </div>
        </div>

        {/* Centerpiece */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            textAlign: "center",
            width: "100%",
            marginTop: 8,
          }}
        >
          {/* Hero pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 18px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.04)",
              fontSize: 18,
              color: "rgba(255,255,255,0.85)",
              marginBottom: 36,
            }}
          >
            <span style={{ fontSize: 16 }}>🚀</span>
            <span>AI-Powered Open Source Platform</span>
          </div>

          {/* H1 — verbatim from src/components/marketing/hero-1.tsx */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "#FFFFFF",
              maxWidth: 1000,
            }}
          >
            <span>The everything platform</span>
            <span>for open-source devs</span>
          </div>

          {/* Sub-tagline */}
          <div
            style={{
              display: "flex",
              fontSize: 26,
              fontWeight: 400,
              color: "rgba(255,255,255,0.72)",
              marginTop: 28,
              maxWidth: 920,
              textAlign: "center",
            }}
          >
            Find issues, get matched with jobs, and chat with any GitHub repo.
          </div>
        </div>

        {/* Footer URL — anchors the brand */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            fontSize: 22,
            fontWeight: 500,
            color: "rgba(255,255,255,0.55)",
            letterSpacing: "0.02em",
          }}
        >
          openso.dev
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "DM Sans", data: regular, weight: 400, style: "normal" },
        { name: "DM Sans", data: semibold, weight: 600, style: "normal" },
        { name: "DM Sans", data: bold, weight: 700, style: "normal" },
      ],
    },
  );
}
