import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";

/**
 * GET /api/profile/status
 * Returns the current state of the user's profile:
 * - has resume, has github, has synthesized profile
 * - timestamps for each
 */
export async function GET() {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user } = auth;

  const admin = createAdminClient();

  // Fetch user_profiles
  const { data: profile } = await admin
    .database.from("user_profiles")
    .select("resume_uploaded_at, github_analyzed_at, profile_synthesized_at, tech_stack_summary, skills_verified")
    .eq("user_id", user.id)
    .single();

  // Fetch github connection status from profiles
  const { data: ghProfile } = await admin
    .database.from("profiles")
    .select("github_connected, github_username")
    .eq("id", user.id)
    .single();

  // Count memory facts by source
  const { count: resumeFactCount } = await admin
    .database.from("memory_facts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("source", "resume")
    .eq("is_latest", true);

  const { count: githubFactCount } = await admin
    .database.from("memory_facts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("source", "github")
    .eq("is_latest", true);

  return NextResponse.json({
    hasResume: !!profile?.resume_uploaded_at,
    hasGitHub: !!profile?.github_analyzed_at,
    hasProfile: !!profile?.profile_synthesized_at,
    resumeUploadedAt: profile?.resume_uploaded_at ?? null,
    githubAnalyzedAt: profile?.github_analyzed_at ?? null,
    profileSynthesizedAt: profile?.profile_synthesized_at ?? null,
    githubConnected: !!ghProfile?.github_connected,
    githubUsername: ghProfile?.github_username ?? null,
    techStack: profile?.tech_stack_summary ?? [],
    resumeFactCount: resumeFactCount ?? 0,
    githubFactCount: githubFactCount ?? 0,
    skillsVerified: profile?.skills_verified ?? null,
  });
}
