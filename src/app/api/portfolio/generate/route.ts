/**
 * POST /api/portfolio/generate
 *
 * Triggers AI to synthesize a PortfolioSiteConfig from the
 * authenticated user's resume_structured + github_repos.
 *
 * Requires: resume uploaded (user_profiles.resume_structured not null)
 * Optional: GitHub connected (for richer projects + socials.github)
 */

import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/insforge/server";
import { generatePortfolioConfig } from "@/lib/profile/portfolio-config-generator";

export const maxDuration = 120;

export async function POST() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = await generatePortfolioConfig(auth.user.id);

    return NextResponse.json({
      success: true,
      config,
      message: "Portfolio config generated successfully.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate portfolio";
    console.error("[/api/portfolio/generate]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
