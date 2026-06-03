import { ImageResponse } from "next/og";

import { readFile } from "node:fs/promises";
import path from "node:path";


import { getCachedPortfolio } from "@/lib/portfolio-data";
import type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";

/**
 * Per-user dynamic OG image for /portfolio/[username].
 *
 * Shows the user's name, title/tagline, bio, and avatar over a dark card
 * that matches the site's forced-dark theme. Falls back gracefully when
 * fields are missing (new users who haven't filled everything out yet).
 */

export const alt = "Developer Portfolio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFont(file: string): Promise<ArrayBuffer> {
  const fontPath = path.join(process.cwd(), "fonts", "dm-sans", file);
  const buf = await readFile(fontPath);
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

export default async function PortfolioOGImage({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<ImageResponse> {
  const { username } = await params;
  const data = await getCachedPortfolio(username);

  const config = data?.site_config as unknown as PortfolioSiteConfig | null;
  const name =
    data?.display_name ?? config?.identity?.name ?? username;
  const title = config?.identity?.title ?? "";
  const tagline = config?.identity?.tagline ?? "";
  const bio =
    data?.bio ??
    config?.identity?.bio ??
    "";
  const avatarUrl = data?.avatar_url ?? (config as any)?.avatarUrl ?? null;

  const [regular, semibold, bold] = await Promise.all([
    loadFont("DMSans-Regular.ttf"),
    loadFont("DMSans-SemiBold.ttf"),
    loadFont("DMSans-Bold.ttf"),
  ]);

  // Truncate bio to ~120 chars for readability at OG size
  const shortBio =
    bio.length > 120 ? bio.slice(0, 117).trimEnd() + "…" : bio;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0B0D0E",
          backgroundImage:
            "radial-gradient(circle at 25% 30%, rgba(148,163,184,0.14) 0%, rgba(11,13,14,0) 50%), radial-gradient(circle at 85% 80%, rgba(94,234,212,0.08) 0%, rgba(11,13,14,0) 45%)",
          color: "#FFFFFF",
          fontFamily: "DM Sans",
          padding: "64px 80px",
          position: "relative",
        }}
      >
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#FFFFFF",
            }}
          >
            openso
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 18px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.18)",
              backgroundColor: "rgba(255,255,255,0.06)",
              fontSize: 16,
              fontWeight: 500,
              color: "rgba(255,255,255,0.8)",
            }}
          >
            Developer Portfolio
          </div>
        </div>

        {/* Main content */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flex: 1,
            gap: 56,
            marginTop: 24,
          }}
        >
          {/* Avatar */}
          {avatarUrl ? (
            <img
              src={avatarUrl}
              width={180}
              height={180}
              style={{
                borderRadius: "50%",
                border: "4px solid rgba(255,255,255,0.12)",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                width: 180,
                height: 180,
                borderRadius: "50%",
                backgroundColor: "rgba(255,255,255,0.08)",
                border: "4px solid rgba(255,255,255,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 72,
                fontWeight: 700,
                color: "rgba(255,255,255,0.5)",
              }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}

          {/* Text */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              gap: 12,
            }}
          >
            {/* Name */}
            <div
              style={{
                display: "flex",
                fontSize: 56,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
                color: "#FFFFFF",
              }}
            >
              {name}
            </div>

            {/* Title + tagline */}
            {(title || tagline) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontSize: 24,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                {title}
                {title && tagline && (
                  <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
                )}
                {tagline}
              </div>
            )}

            {/* Bio */}
            {shortBio && (
              <div
                style={{
                  display: "flex",
                  fontSize: 20,
                  fontWeight: 400,
                  color: "rgba(255,255,255,0.55)",
                  lineHeight: 1.5,
                  marginTop: 8,
                  maxWidth: 700,
                }}
              >
                {shortBio}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            fontSize: 20,
            fontWeight: 500,
            color: "rgba(255,255,255,0.45)",
            letterSpacing: "0.02em",
          }}
        >
          openso.dev/portfolio/{username}
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
