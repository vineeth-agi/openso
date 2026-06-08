/**
 * Portfolio Config Generator
 *
 * Uses AI (generateObject) to synthesize a per-user PortfolioSiteConfig
 * from the user's resume_structured + github_repos stored in user_profiles.
 *
 * Rules:
 * - identity.name always comes from resume (source of truth)
 * - socials.github is filled from the GitHub OAuth token username
 * - Fields not inferrable (twitter, leetcode, tryhackme, codeforces, hackathons,
 *   research, calUrl) → null / empty — never guessed
 * - Projects are a blend of resume projects + notable GitHub repos
 * - Saves generated config to user_portfolios table
 */

import { generateObject } from "ai";
import { z } from "zod";

import { ingestGitHub, type RepoAnalysis } from "./github-analyzer";
import { isSafePublicUrl, validateLinksInProjects } from "./link-validator";
import {
  PortfolioSiteConfigSchema,
  type PortfolioSiteConfig,
} from "./portfolio-types";
import { mergeAndRankProjects } from "./project-merger";
import type { ResumeData } from "./resume-extractor";

import { google, getDefaultPioneerModel } from "@/lib/ai/google-provider";
import { createAdminClient } from "@/lib/insforge/admin";

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 32);
}

interface NavBuildOptions {
  hackathons?: boolean;
  research?: boolean;
}

function buildNavForUsername(username: string, opts: NavBuildOptions = {}) {
  const nav = [
    { path: `/portfolio/${username}`, name: "About" },
    { path: `/portfolio/${username}/projects`, name: "Projects" },
    { path: `/portfolio/${username}/experience`, name: "Experience" },
  ];
  if (opts.hackathons) {
    nav.push({ path: `/portfolio/${username}/hackathons`, name: "Hacks" });
  }
  if (opts.research) {
    nav.push({ path: `/portfolio/${username}/research`, name: "Research" });
  }
  return nav;
}

async function enrichProjectsWithAI(
  projects: {
    title: string;
    category: string;
    description: string;
    techstacks: string[];
    status: "live" | "building" | "active" | "archived";
    link: string | null;
    github: string | null;
    preview: string | null;
    previewDark: string | null;
  }[],
  resume: ResumeData,
): Promise<{ description: string; techstacks: string[] }[]> {
  const needsEnrichment = projects
    .map((p, idx) => ({
      idx,
      title: p.title,
      description: p.description,
      techstacks: p.techstacks,
      github: p.github,
    }))
    .filter((p) => !p.description.trim() || p.techstacks.length <= 1);

  if (needsEnrichment.length === 0) {
    return projects.map((p) => ({ description: p.description, techstacks: p.techstacks }));
  }

  const model = google(process.env.PIONEER_MODEL || getDefaultPioneerModel());

  const skillsArray = (() => {
    const s = resume.skills;
    if (!s) return [];
    if (Array.isArray(s)) return s.filter((x) => typeof x === "string");
    if (typeof s === "object") {
      const keys = ["languages", "frameworks", "tools", "soft", "other"];
      const out: string[] = [];
      for (const k of keys) {
        const val = (s as Record<string, unknown>)[k];
        if (Array.isArray(val)) {
          for (const item of val) {
            if (typeof item === "string") out.push(item);
          }
        }
      }
      return out;
    }
    return [];
  })();

  const prompt = `You are a professional portfolio enhancer.
Given the developer's background and a list of their GitHub repositories, generate a professional 1-2 sentence description and an expanded tech stack for each repository that currently has empty/generic data.

Developer Background:
Name: ${resume.name || ""}
Summary: ${resume.summary || ""}
Skills: ${skillsArray.join(", ")}

Repositories to enhance:
${needsEnrichment
  .map(
    (r) => `${r.idx + 1}. Title: ${r.title}
   Current Description: ${r.description || "(none)"}
   Current Tech Stack: ${r.techstacks.join(", ") || "(none)"}
   GitHub URL: ${r.github ? `https://github.com/${r.github}` : "(none)"}`,
  )
  .join("\n\n")}

For each repository:
1. Generate a professional, context-aware description (1-2 sentences) of what the project does based on its title and main language. Do NOT make up unrealistic details; keep it simple and plausible.
2. Expand the tech stack to include 2-5 relevant tools, libraries, or methodologies (e.g. if main language is Python, maybe add "pytest", "CLI", or "Data structures" if appropriate).`;

  try {
    const { object } = await generateObject({
      model,
      schema: z.object({
        enhancements: z.array(
          z.object({
            index: z.number().describe("The original 1-based index of the repository from the prompt list"),
            description: z.string().describe("A professional, 1-2 sentence description"),
            techstacks: z.array(z.string()).describe("A list of 2-5 relevant technologies"),
          }),
        ),
      }),
      prompt,
    });

    const result = projects.map((p) => ({ description: p.description, techstacks: p.techstacks }));
    for (const enhancement of object.enhancements) {
      const originalIdx = enhancement.index - 1;
      if (originalIdx >= 0 && originalIdx < projects.length) {
        if (!result[originalIdx].description.trim()) {
          result[originalIdx].description = enhancement.description;
        }
        if (result[originalIdx].techstacks.length <= 1) {
          result[originalIdx].techstacks = enhancement.techstacks;
        }
      }
    }
    return result;
  } catch (err) {
    console.error("[portfolio-config-generator] AI project enrichment failed:", err);
    return projects.map((p) => ({ description: p.description, techstacks: p.techstacks }));
  }
}

// ── Generator ──────────────────────────────────────────────────────────────

/**
 * AI generates the parts it can from resume + GitHub.
 * We separately fill in nulls for fields it cannot know.
 */
async function generateCoreConfig(
  resume: ResumeData,
  repos: RepoAnalysis[],
  githubUsername: string,
): Promise<Partial<PortfolioSiteConfig>> {
  const model = google(process.env.PIONEER_MODEL || getDefaultPioneerModel());

  // ALL repos (non-fork, sorted by stars) for project generation
  const topRepos = [...repos]
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 30)
    .map((r) => ({
      name: r.name,
      description: r.description,
      url: r.url,
      stars: r.stars,
      techStack: r.techStack,
      topics: r.topics,
      lastPushed: r.lastPushed,
    }));

  const CoreSchema = z.object({
    identity: z.object({
      name: z.string(),
      firstName: z.string(),
      title: z.string(),
      tagline: z.string(),
      bio: z.string(),
      intros: z.array(z.string()).min(2).max(6),
    }),
    contact: z.object({
      email: z.string().nullable(),
      url: z.string().nullable(),
    }),
    linkedinUsername: z.string().nullable().describe(
      "LinkedIn username extracted from resume URL e.g. 'john-doe', null if not found"
    ),
    seoDescription: z.string().describe("2-sentence SEO meta description"),
    seoKeywords: z.array(z.string()).max(12),
    experiences: z.array(
      z.object({
        role: z.string(),
        year: z.string(),
        company: z.string(),
        type: z.string(),
        location: z.string(),
        responsibility: z.array(
          z.array(
            z.object({ text: z.string(), bold: z.boolean().optional() })
          )
        ).max(5),
        techstacks: z.array(z.string()),
      })
    ),
    // NOTE: Projects are NOT generated by AI. They are merged
    // deterministically by `mergeAndRankProjects` from resume + GitHub
    // (see Issue #1: project merging logic). The LLM is prone to dropping
    // entries and inventing data; we keep this side of the pipeline pure.
    hackathons: z.array(
      z.object({
        title: z.string().describe("Project/product name built at hackathon"),
        event: z.string().describe("Hackathon event name"),
        year: z.string().describe("e.g. 'Apr 2026'"),
        placement: z.string().nullable().describe("e.g. '1st Place', 'Finalist', null if not placed"),
        college: z.string().nullable().describe("Hosting institution, null if not available"),
        body: z.array(z.object({ text: z.string(), bold: z.boolean().optional() })).describe("Rich text description of what was built"),
        techstacks: z.array(z.string()),
        link: z.string().nullable().describe("Devpost or demo link, null if not available"),
      })
    ).describe("Hackathon participations from resume. Empty array if none found."),
    research: z.array(
      z.object({
        title: z.string(),
        year: z.string(),
        authors: z.array(z.string()).optional(),
        venue: z.string().optional().describe("Conference or journal"),
        link: z.string().optional(),
        description: z.string().optional(),
      })
    ).describe("Research papers/publications from resume. Empty array if none found."),
  });

  const { object } = await generateObject({
    model,
    schema: CoreSchema,
    prompt: `You are building a developer portfolio config from a resume and GitHub repos.

RESUME DATA:
${JSON.stringify(resume, null, 2)}

GITHUB USERNAME: ${githubUsername}
GITHUB REPOS (sorted by stars):
${JSON.stringify(topRepos, null, 2)}

INSTRUCTIONS:
1. identity.name = EXACT full name from resume (do not alter)
2. identity.firstName = first word of name
3. identity.title = most recent job title from resume, cleaned up (e.g. "Software Development Engineer 1" → "Software Engineer")
4. identity.tagline = infer from education (e.g. "MS CS @ MIT") or latest company ("Engineer @ Google"), max 25 chars
5. identity.bio = 2-3 sentence professional summary synthesizing resume + GitHub activity
6. identity.intros = 3-5 rotating labels like ["Full Stack Developer", "Open Source Builder", "Problem Solver"]
7. contact.email = email from resume, null if missing
8. contact.url = personal website URL from resume (NOT LinkedIn/GitHub), null if missing
9. linkedinUsername = extract from LinkedIn URL in resume (e.g. linkedin.com/in/john-doe → "john-doe"), null if not found
10. experiences = ALL work experience from resume, formatted for portfolio. Each responsibility bullet is an array of rich text segments (split bold technical terms using bold:true segments). Include EVERY job/internship from the resume — do not skip any.
11. Skip projects — they are merged deterministically downstream from the same resume + GitHub data.
12. hackathons = extract ALL hackathon participations from resume (look for hackathon events, MLH, devpost, hack-related entries). Empty array if none found in resume.
13. research = extract ALL research papers, publications, or academic research from resume. Empty array if none found.
14. seoDescription = SEO-friendly 2-sentence description mentioning name and key skills
15. seoKeywords = name + top skills + "Portfolio" + "Software Engineer"

IMPORTANT:
- Do NOT hallucinate URLs, social handles, or company logos. Set null for anything you are not certain about.
- Include ALL experiences from resume — do not skip or summarize.
- For hackathons and research, only include if explicitly mentioned in resume. Do NOT guess.`,
    maxOutputTokens: 16384,
  });

  return object as unknown as Partial<PortfolioSiteConfig> & {
    linkedinUsername?: string | null;
    seoDescription?: string;
    seoKeywords?: string[];
  };
}

// ── Main export ────────────────────────────────────────────────────────────

export async function generatePortfolioConfig(
  userId: string,
): Promise<PortfolioSiteConfig> {
  const db = createAdminClient();

  // 1. Load user data from DB
  const { data: userProfile } = await db.database.from("user_profiles")
    .select("resume_structured, github_repos, github_contributions")
    .eq("user_id", userId)
    .single();

  if (!userProfile?.resume_structured) {
    throw new Error("No resume found. Please upload your resume first.");
  }

  const resume = userProfile.resume_structured as ResumeData;
  let repos = (userProfile.github_repos ?? []) as RepoAnalysis[];
  let ghContribs = userProfile.github_contributions as {
    topLanguages?: string[];
  } | null;

  // 2. Get GitHub username from connected_apps (primary) or profiles (fallback)
  const { data: connection } = await db.database.from("connected_apps")
    .select("github_username, metadata")
    .eq("user_id", userId)
    .eq("provider", "github")
    .eq("status", "active")
    .maybeSingle();

  let githubUsername: string =
    connection?.github_username ??
    (connection?.metadata as Record<string, string> | null)?.login ??
    "";

  // Fallback: check profiles table if connected_apps didn't have it
  if (!githubUsername) {
    const { data: profile } = await db.database.from("profiles")
      .select("github_username")
      .eq("id", userId)
      .maybeSingle();
    githubUsername = profile?.github_username ?? "";
  }

  // 2b. If GitHub is connected but repos haven't been analyzed yet, run ingestGitHub now
  if (repos.length === 0 && githubUsername) {
    try {
      const result = await ingestGitHub(userId);
      if (result) {
        repos = result.profile.repos;
        ghContribs = result.profile.contributions;
      }
    } catch (err) {
      console.warn("[portfolio-config-generator] GitHub ingest failed (continuing without):", err instanceof Error ? err.message : err);
    }
  }

  // 3. Call AI for the bits it can synthesize (identity, experiences,
  //    hackathons, research, SEO). Projects are NOT in this output —
  //    `mergeAndRankProjects` handles them deterministically below.
  const core = await generateCoreConfig(resume, repos, githubUsername) as any;

  // 3a. Deterministic project merge + ranking.
  //     - Resume projects + GitHub PUBLIC repos (private repos are filtered
  //       upstream in `analyzeGitHub` / GitHub Memory ingestion).
  //     - Resume content always wins on conflicts.
  //     - Score = explicit weighted formula (see project-merger.ts).
  const ranked = mergeAndRankProjects(resume, repos, {
    pinnedRepos: [], // pinnedRepos plumbing is added in a follow-up; the
                     // ranker still functions correctly with stars/recency
                     // as the primary signal when this is empty.
  });

  // 3b. Validate every link before persisting. Any URL that isn't a safe
  //     public http(s) URL or doesn't respond is dropped (set to null).
  //     This is done in parallel with bounded concurrency.
  const projectShells = ranked.map((r) => ({
    link: r.link,
    github: r.github,
  }));
  const { projects: validated } = await validateLinksInProjects(projectShells, {
    concurrency: 6,
    timeoutMs: 4000,
  }).catch(() => ({ projects: projectShells, report: {} }));
  const finalProjects = ranked.map((r, i) => ({
    title: r.title,
    category: r.category,
    description: r.description,
    techstacks: r.techstacks,
    status: r.status,
    link: validated[i]?.link ?? null,
    github: validated[i]?.github ?? null,
    preview: null,
    previewDark: null,
  }));

  // 3c. Enrich GitHub-only projects with AI descriptions and expanded tech stacks if they are missing
  const enriched = await enrichProjectsWithAI(finalProjects, resume);
  const finalProjectsWithAI = finalProjects.map((p, i) => ({
    ...p,
    description: enriched[i].description,
    techstacks: enriched[i].techstacks,
  }));

  // 4. Determine portfolio URL slug
  const displaySlug = slugify(resume.name || "my-portfolio");

  // 5. Assemble the full PortfolioSiteConfig — filling nulls for unknown fields
  //    Validate every external link via `isSafePublicUrl` so a bad URL never
  //    reaches the rendered portfolio (Issue #3).
  const safeContactUrl =
    isSafePublicUrl(core.contact?.url) ? core.contact.url : null;
  const safeLinkedInUrl = (() => {
    if (core.linkedinUsername) {
      const u = `https://www.linkedin.com/in/${core.linkedinUsername}/`;
      return isSafePublicUrl(u) ? u : null;
    }
    if (resume.linkedIn && isSafePublicUrl(resume.linkedIn)) {
      return resume.linkedIn;
    }
    return null;
  })();
  const config: PortfolioSiteConfig = {
    identity: {
      name: core.identity?.name ?? resume.name ?? "Developer",
      firstName: core.identity?.firstName ?? resume.name?.split(" ")[0] ?? "Dev",
      title: core.identity?.title ?? resume.experience?.[0]?.title ?? "Software Engineer",
      tagline: core.identity?.tagline ?? "",
      bio: core.identity?.bio ?? resume.summary ?? "",
      intros: core.identity?.intros ?? ["Software Engineer", "Developer"],
    },

    contact: {
      email: core.contact?.email ?? resume.email ?? null,
      url: safeContactUrl,
      calUrl: null,
      resumeUrl: null,
    },

    assetsUrl: "",
    assets: {
      ogImage: "",
      blogOgImage: "",
      favicon: "/openso_logo.png",
    },

    socials: {
      github: githubUsername
        ? {
            label: "Github",
            username: githubUsername,
            url: `https://github.com/${githubUsername}`,
          }
        : null,
      linkedin: safeLinkedInUrl
        ? {
            label: "LinkedIn",
            username: safeLinkedInUrl
              .replace(/.*linkedin\.com\/in\//, "")
              .replace(/\/$/, ""),
            url: safeLinkedInUrl,
          }
        : null,
      twitter: null,
      leetcode: null,
      tryhackme: null,
      codeforces: null,
    },

    seo: {
      titleTemplate: `%s | ${core.identity?.name ?? resume.name}`,
      defaultTitle: core.identity?.name ?? resume.name ?? "Portfolio",
      defaultDescription: core.seoDescription ?? "",
      keywords: core.seoKeywords ?? [],
      twitterHandle: null,
      locale: "en_US",
      themeColor: "#0B0D0E",
    },

    nav: buildNavForUsername(displaySlug, {
      hackathons: (core.hackathons ?? []).length > 0,
      research: (core.research ?? []).length > 0,
    }),

    experiences: (core.experiences ?? []).map((exp: any) => ({
      role: exp.role,
      year: exp.year,
      company: exp.company,
      type: exp.type,
      location: exp.location,
      logo: null,
      responsibility: exp.responsibility ?? [],
      techstacks: exp.techstacks ?? [],
    })),

    projects: finalProjectsWithAI,

    hackathons: (core.hackathons ?? []).map((h: any) => ({
      title: h.title,
      event: h.event,
      year: h.year,
      placement: h.placement ?? null,
      college: h.college ?? null,
      body: h.body ?? [],
      techstacks: h.techstacks ?? [],
      link: h.link ?? null,
    })),

    research: (core.research ?? []).map((r: any) => ({
      title: r.title,
      year: r.year,
      authors: r.authors ?? [],
      venue: r.venue ?? undefined,
      link: r.link ?? undefined,
      description: r.description ?? undefined,
    })),
  };

  // 6. Validate with Zod
  const parsed = PortfolioSiteConfigSchema.parse(config);

  // 7. Upsert into user_portfolios
  const topLangs = ghContribs?.topLanguages ?? [];
  const allTech = [
    ...new Set([
      ...topLangs,
      ...(parsed.experiences.flatMap((e) => e.techstacks ?? [])),
    ]),
  ].slice(0, 20);

  // 7. Default avatar behavior (Issue #9):
  //    - If user has GitHub connected → use GitHub profile image as default.
  //      We DO NOT mirror it into our storage automatically; the GitHub
  //      avatar URL is stable and CDN-hosted, so we reference it directly.
  //      Users may override via /api/portfolio/avatar.
  //    - If GitHub is not connected → leave avatar_url null so the user is
  //      prompted to upload manually.
  const defaultAvatarUrl = githubUsername
    ? `https://github.com/${githubUsername}.png`
    : null;

  const { error: upsertError } = await db.database.from("user_portfolios").upsert(
    {
      user_id: userId,
      site_config: parsed as unknown as Record<string, unknown>,
      display_name: parsed.identity.name,
      bio: parsed.identity.bio,
      avatar_url: defaultAvatarUrl,
      tech_stack: allTech,
      years_experience: resume.totalYearsExperience != null
        ? Math.round(resume.totalYearsExperience)
        : null,
      config_generated_at: new Date().toISOString(),
      config_source: "ai",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (upsertError) {
    console.error("[portfolio-config-generator] upsert error:", upsertError.message);
    throw new Error(`Generated config but failed to save: ${upsertError.message}`);
  }

  return parsed;
}

// ── Update nav when username is set ───────────────────────────────────────

export async function updatePortfolioNav(
  userId: string,
  username: string,
): Promise<void> {
  const db = createAdminClient();

  const { data: rows, error: selectErr } = await db.database.from("user_portfolios")
    .select("site_config")
    .eq("user_id", userId)
    .limit(1);

  if (selectErr || !rows?.[0]?.site_config) {
    console.error("[updatePortfolioNav] Failed to load config:", selectErr?.message);
    return;
  }

  const config = rows[0].site_config as unknown as PortfolioSiteConfig;
  config.nav = buildNavForUsername(username, {
    hackathons: (config.hackathons?.length ?? 0) > 0,
    research: (config.research?.length ?? 0) > 0,
  });

  const { error: updateErr } = await db.database.from("user_portfolios")
    .update({
      site_config: config as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updateErr) {
    console.error("[updatePortfolioNav] Failed to update nav:", updateErr.message);
  }
}
