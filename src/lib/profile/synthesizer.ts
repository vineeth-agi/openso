/**
 * Profile Synthesizer — Combines resume + GitHub data into
 * one comprehensive markdown profile with skill credibility.
 *
 * Reads from user_profiles (structured data) and produces
 * profile_markdown + skills_verified.
 */

import type { RepoAnalysis } from "./github-analyzer";
import type { ResumeData } from "./resume-extractor";

import { createAdminClient } from "@/lib/insforge/admin";

// ── Types ───────────────────────────────────────────────────

interface SkillCredibility {
  claimed_resume: boolean;
  evidenced_github: boolean;
  repo_count: number;
  confidence: number;  // 0-1
}

// ── Synthesizer ─────────────────────────────────────────────

export async function synthesizeProfile(userId: string): Promise<{
  markdown: string;
  skills: Record<string, SkillCredibility>;
  techStack: string[];
}> {
  const db = createAdminClient();

  const { data: up } = await db.database.from("user_profiles")
    .select("resume_structured, resume_uploaded_at, github_repos, github_contributions, github_analyzed_at")
    .eq("user_id", userId)
    .single();

  const resume = (up?.resume_structured ?? null) as ResumeData | null;
  const repos = (up?.github_repos ?? []) as RepoAnalysis[];
  const ghContribs = (up?.github_contributions ?? null) as {
    totalCommits: number; mergedPRs: number; totalRepos: number;
    topLanguages: string[]; languageBreakdown: Record<string, number>;
  } | null;

  // ── Build skill credibility map ──────────────────────────
  const skillMap: Record<string, SkillCredibility> = {};

  const claimSkill = (skill: string) => {
    const key = skill.toLowerCase().trim();
    if (!key) return;
    if (!skillMap[key]) skillMap[key] = { claimed_resume: false, evidenced_github: false, repo_count: 0, confidence: 0 };
    skillMap[key].claimed_resume = true;
  };

  const evidenceSkill = (skill: string) => {
    const key = skill.toLowerCase().trim();
    if (!key) return;
    if (!skillMap[key]) skillMap[key] = { claimed_resume: false, evidenced_github: false, repo_count: 0, confidence: 0 };
    skillMap[key].evidenced_github = true;
    skillMap[key].repo_count++;
  };

  // Collect resume claims
  if (resume?.skills) {
    for (const s of [...(resume.skills.languages ?? []), ...(resume.skills.frameworks ?? []), ...(resume.skills.tools ?? []), ...(resume.skills.other ?? [])]) {
      claimSkill(s);
    }
  }
  // Also claim from experience technologies
  for (const exp of resume?.experience ?? []) {
    for (const t of exp.technologies ?? []) claimSkill(t);
  }
  for (const proj of resume?.projects ?? []) {
    for (const t of proj.technologies) claimSkill(t);
  }

  // Collect GitHub evidence
  for (const repo of repos) {
    for (const tech of repo.techStack) evidenceSkill(tech);
  }
  for (const lang of ghContribs?.topLanguages ?? []) evidenceSkill(lang);

  // Compute confidence
  for (const [, v] of Object.entries(skillMap)) {
    if (v.claimed_resume && v.evidenced_github) {
      v.confidence = Math.min(0.95 + v.repo_count * 0.01, 1.0);
    } else if (v.evidenced_github) {
      v.confidence = Math.min(0.7 + v.repo_count * 0.05, 0.95);
    } else if (v.claimed_resume) {
      v.confidence = 0.5;
    }
  }

  // Sorted by confidence desc
  const sortedSkills = Object.entries(skillMap).sort(([, a], [, b]) => b.confidence - a.confidence);
  const techStack = sortedSkills.filter(([, v]) => v.confidence >= 0.5).map(([k]) => k);

  // ── Build Markdown ────────────────────────────────────────
  const lines: string[] = [];

  // Header
  lines.push(`# Professional Profile`);
  if (resume?.name) lines.push(`**${resume.name}**`);
  const meta: string[] = [];
  if (resume?.location) meta.push(resume.location);
  if (resume?.seniorityLevel) meta.push(`${resume.seniorityLevel}-level`);
  if (resume?.totalYearsExperience) meta.push(`${resume.totalYearsExperience} years experience`);
  if (meta.length) lines.push(meta.join(" · "));
  lines.push("");

  // Summary
  if (resume?.summary) {
    lines.push("## Summary");
    lines.push(resume.summary);
    lines.push("");
  }

  // Skills with credibility
  if (sortedSkills.length > 0) {
    lines.push("## Skills");
    const verified = sortedSkills.filter(([, v]) => v.claimed_resume && v.evidenced_github);
    const claimed = sortedSkills.filter(([, v]) => v.claimed_resume && !v.evidenced_github);
    const discovered = sortedSkills.filter(([, v]) => !v.claimed_resume && v.evidenced_github);

    if (verified.length) lines.push(`**Verified (resume + code):** ${verified.map(([k]) => k).join(", ")}`);
    if (claimed.length) lines.push(`**Claimed (resume only):** ${claimed.map(([k]) => k).join(", ")}`);
    if (discovered.length) lines.push(`**Discovered (code only):** ${discovered.map(([k]) => k).join(", ")}`);
    lines.push("");
  }

  // Work Experience
  if (resume?.experience?.length) {
    lines.push("## Work Experience");
    for (const exp of resume.experience) {
      const dateRange = [exp.startDate, exp.isCurrent ? "present" : exp.endDate].filter(Boolean).join(" – ");
      lines.push(`### ${exp.title} @ ${exp.company}`);
      if (dateRange) lines.push(`*${dateRange}*${exp.location ? ` · ${exp.location}` : ""}`);
      for (const bullet of exp.bullets ?? []) {
        lines.push(`- ${bullet}`);
      }
      if (exp.technologies?.length) lines.push(`**Tech:** ${exp.technologies.join(", ")}`);
      lines.push("");
    }
  }

  // Education
  if (resume?.education?.length) {
    lines.push("## Education");
    for (const edu of resume.education) {
      lines.push(`- **${edu.degree}${edu.field ? ` in ${edu.field}` : ""}** — ${edu.institution}${edu.endDate ? ` (${edu.endDate})` : ""}`);
    }
    lines.push("");
  }

  // Projects (from resume)
  if (resume?.projects?.length) {
    lines.push("## Projects");
    for (const proj of resume.projects) {
      lines.push(`### ${proj.name}`);
      lines.push(proj.description);
      if (proj.technologies.length) lines.push(`**Tech:** ${proj.technologies.join(", ")}`);
      if (proj.url) lines.push(`**URL:** ${proj.url}`);
      lines.push("");
    }
  }

  // Certifications
  if (resume?.certifications?.length) {
    lines.push("## Certifications");
    for (const cert of resume.certifications) {
      lines.push(`- ${cert.name}${cert.issuer ? ` — ${cert.issuer}` : ""}${cert.date ? ` (${cert.date})` : ""}`);
    }
    lines.push("");
  }

  // GitHub
  if (repos.length > 0) {
    lines.push("## GitHub Repositories");
    if (ghContribs) {
      lines.push(`**${ghContribs.totalRepos}** repos · **${ghContribs.totalCommits}** commits · **${ghContribs.mergedPRs}** merged PRs`);
      if (ghContribs.topLanguages.length) lines.push(`**Top languages:** ${ghContribs.topLanguages.slice(0, 8).join(", ")}`);
      lines.push("");
    }

    const sortedRepos = [...repos].sort((a, b) => b.stars - a.stars);
    for (const repo of sortedRepos.slice(0, 15)) {
      const stars = repo.stars > 0 ? ` ⭐${repo.stars}` : "";
      const prs = repo.mergedPRs > 0 ? ` · ${repo.mergedPRs} PRs` : "";
      lines.push(`### [${repo.name}](${repo.url})${stars}${prs}`);
      if (repo.description) lines.push(repo.description);
      if (repo.techStack.length) lines.push(`**Tech:** ${repo.techStack.join(", ")}`);
      lines.push("");
    }
  }

  // Footer
  const sources: string[] = [];
  if (up?.resume_uploaded_at) sources.push(`Resume: ${new Date(up.resume_uploaded_at).toLocaleDateString()}`);
  if (up?.github_analyzed_at) sources.push(`GitHub: ${new Date(up.github_analyzed_at).toLocaleDateString()}`);
  if (sources.length) {
    lines.push("---");
    lines.push(`*Sources: ${sources.join(" · ")}*`);
  }

  const markdown = lines.join("\n");

  // ── Save to user_profiles ────────────────────────────────
  await db.database.from("user_profiles")
    .upsert({
      user_id: userId,
      profile_markdown: markdown,
      profile_synthesized_at: new Date().toISOString(),
      skills_verified: skillMap as unknown as Record<string, unknown>,
      tech_stack_summary: techStack,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  return { markdown, skills: skillMap, techStack };
}
