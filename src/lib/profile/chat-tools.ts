/**
 * Profile Chat Tools — usable from chat, Telegram, and agent.
 *
 * Provides tools for:
 * - Checking profile status (resume + GitHub)
 * - Analyzing GitHub repos and writing to memory
 * - Extracting resume from uploaded text
 * - Viewing synthesized profile markdown
 */

import { tool } from "ai";
import { z } from "zod";

import { ingestGitHub } from "./github-analyzer";
import { ingestResume } from "./resume-extractor";
import { synthesizeProfile } from "./synthesizer";

import { createAdminClient } from "@/lib/insforge/admin";

export function buildProfileTools(userId: string) {
  // ── Tool 1: checkProfileStatus ──────────────────────────
  const checkProfileStatus = tool({
    description: "Check the user's profile readiness: whether resume is uploaded, GitHub is analyzed, and profile is synthesized. Use this to know what data is available for job matching.",
    inputSchema: z.object({}),
    execute: async () => {
      const db = createAdminClient();

      const { data: up } = await db.database.from("user_profiles")
        .select("resume_uploaded_at, github_analyzed_at, profile_synthesized_at, tech_stack_summary")
        .eq("user_id", userId)
        .single();

      const { data: profile } = await db.database.from("profiles")
        .select("github_connected, github_username")
        .eq("id", userId)
        .single();

      const { count: resumeFacts } = await db.database.from("memory_facts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("source", "resume")
        .eq("is_latest", true);

      const { count: githubFacts } = await db.database.from("memory_facts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("source", "github")
        .eq("is_latest", true);

      return {
        hasResume: !!up?.resume_uploaded_at,
        hasGitHub: !!up?.github_analyzed_at,
        hasProfile: !!up?.profile_synthesized_at,
        resumeUploadedAt: up?.resume_uploaded_at ?? null,
        githubAnalyzedAt: up?.github_analyzed_at ?? null,
        githubConnected: !!profile?.github_connected,
        githubUsername: profile?.github_username ?? null,
        techStack: up?.tech_stack_summary ?? [],
        resumeFactCount: resumeFacts ?? 0,
        githubFactCount: githubFacts ?? 0,
      };
    },
  });

  // ── Tool 2: analyzeGitHubProfile ────────────────────────
  const analyzeGitHubProfile = tool({
    description: "Analyze the user's connected GitHub account: fetches all repos, languages, tech stacks, contributions, merged PRs — then writes structured facts to memory. Must have GitHub connected first.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const result = await ingestGitHub(userId);
        if (!result) {
          return { error: "GitHub not connected. The user needs to connect GitHub from their profile settings first." };
        }

        return {
          success: true,
          username: result.profile.username,
          repoCount: result.profile.repos.length,
          topLanguages: result.profile.contributions.topLanguages.slice(0, 8),
          totalCommits: result.profile.contributions.totalCommits,
          mergedPRs: result.profile.contributions.mergedPRs,
          factsAdded: result.factsAdded,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "GitHub analysis failed" };
      }
    },
  });

  // ── Tool 3: ingestResumeText ────────────────────────────
  const ingestResumeText = tool({
    description: "Extract structured data from resume text (already extracted from PDF/DOCX) and write to memory facts. Pass the full resume text. This is used when a user sends their resume content via chat or Telegram.",
    inputSchema: z.object({
      resumeText: z.string().describe("The full resume text to parse and ingest"),
    }),
    execute: async ({ resumeText }) => {
      if (!resumeText || resumeText.trim().length < 50) {
        return { error: "Resume text is too short. Please provide the full resume content." };
      }

      try {
        const { resume, factsAdded } = await ingestResume(userId, resumeText);

        return {
          success: true,
          name: resume.name,
          seniorityLevel: resume.seniorityLevel,
          totalYearsExperience: resume.totalYearsExperience,
          experienceCount: resume.experience.length,
          educationCount: resume.education.length,
          skillCount: [
            ...(resume.skills.languages ?? []),
            ...(resume.skills.frameworks ?? []),
            ...(resume.skills.tools ?? []),
          ].length,
          factsAdded,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Resume ingestion failed" };
      }
    },
  });

  // ── Tool 4: viewProfile ─────────────────────────────────
  const viewProfile = tool({
    description: "Get the user's synthesized profile markdown — combines resume + GitHub data with skill credibility ratings (verified vs claimed vs discovered). Re-synthesizes if data changed since last synthesis.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { markdown, skills, techStack } = await synthesizeProfile(userId);

        const verified = Object.entries(skills).filter(([, v]) => v.claimed_resume && v.evidenced_github).length;
        const claimedOnly = Object.entries(skills).filter(([, v]) => v.claimed_resume && !v.evidenced_github).length;
        const discoveredOnly = Object.entries(skills).filter(([, v]) => !v.claimed_resume && v.evidenced_github).length;

        return {
          profileMarkdown: markdown,
          stats: {
            totalSkills: Object.keys(skills).length,
            verifiedSkills: verified,
            claimedOnlySkills: claimedOnly,
            discoveredOnlySkills: discoveredOnly,
            techStack: techStack.slice(0, 20),
          },
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Profile synthesis failed" };
      }
    },
  });

  return {
    checkProfileStatus,
    analyzeGitHubProfile,
    ingestResumeText,
    viewProfile,
  };
}
