/**
 * Data Assembly Utilities for the Portfolio Recruiter Chatbot.
 *
 * Pure server-side helpers that turn raw profile data (resume + portfolio
 * config + GitHub Memory) into the structured input the system prompt builder
 * expects. The route orchestrates these helpers per request.
 *
 * Two responsibilities:
 *
 *  1. `formatStaticContext` — collapses the resume and portfolio config into
 *     a `SystemPromptInput`-shaped object (minus `githubMemoryPrompt` and
 *     `hasGithubTools`, which the route fills in from the GitHub Memory
 *     fetch and the OAuth token check). Implements the identity precedence
 *     rule from the design: resume name → portfolio identity name → username.
 *
 *  2. `getPortfolioGitHubContext` — wraps `getGitHubMemoryContext` with the
 *     bounded-prompt limits (`repoLimit: 5, prLimit: 3, issueLimit: 3`) and
 *     a 1.5-second `Promise.race` timeout. Returns `null` on timeout, error,
 *     or fully-empty context so the caller can branch on a single value
 *     instead of inspecting every field.
 *
 * Plus a small helper, `extractAllowedRepos`, which derives the
 * `owner/name` allowlist passed to `buildPortfolioGithubTools` from the
 * memory context. Co-located here per design ("keep it co-located").
 *
 * This module is pure server code — no React, no client imports.
 *
 * See `.kiro/specs/portfolio-recruiter-chatbot/design.md`
 *  - "Components and Interfaces" → "6. Data Assembly Utilities"
 *  - "Implementation Notes / Integration Points"
 *  - Properties 7, 8 (graceful degradation with empty/missing memory)
 */

import type {
  PortfolioSiteConfig,
  ResumeStructured,
  SystemPromptInput,
} from "./types";

import {
  getGitHubMemoryContext,
  type GitHubMemoryContext,
} from "@/lib/github-memory";


// ── Public types ───────────────────────────────────────────────────────────

/**
 * Output of `formatStaticContext` — every field of `SystemPromptInput`
 * EXCEPT the two the route fills in itself: `githubMemoryPrompt` (formatted
 * by `formatGitHubMemoryPrompt`) and `hasGithubTools` (derived from the
 * candidate's stored OAuth token).
 */
export type StaticContext = Omit<
  SystemPromptInput,
  "githubMemoryPrompt" | "hasGithubTools"
>;

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_TOP_PROJECTS = 5;
const MAX_EXPERIENCE_ENTRIES = 3;
const GITHUB_MEMORY_TIMEOUT_MS = 1500;

// ── formatStaticContext ────────────────────────────────────────────────────

/**
 * Collapse resume + portfolio config + username into the static portion of
 * `SystemPromptInput`. Pure function, no I/O. The route is responsible for
 * appending `githubMemoryPrompt` and `hasGithubTools` before passing the
 * full object to the prompt builder.
 *
 * NOTE on signature deviation from `tasks.md`:
 * `tasks.md` lists the signature as `(resume, config)` only, but the
 * design's identity precedence rule (resume name → portfolio identity name
 * → username) requires the username as the final fallback. We accept it as
 * a third parameter `username: string` so this function stays self-contained
 * and the caller doesn't have to re-implement the precedence rule. Per
 * Task 4.1 constraints, this addition is documented here. We also accept
 * `config: PortfolioSiteConfig | null` (instead of just `PortfolioSiteConfig`)
 * to match the design's failure-matrix entry #7 ("Portfolio Config missing
 * → continue, identity falls back to resume name → username").
 *
 * Precedence rules from the design:
 *
 *  - Candidate name: `resume.name` → `config.identity.name` → `username`
 *  - Candidate title: `resume.title` → `config.identity.title` → ""
 *  - Candidate bio: `resume.summary` → `config.identity.bio` → ""
 *  - Skills: union of `resume.skills` and every `techstacks` field on
 *    portfolio experiences + projects, deduped case-insensitively but
 *    preserving the FIRST seen casing for output.
 *  - Top projects: prefer portfolio config projects; fill remaining slots
 *    from resume projects; dedupe by title (case-insensitive); cap at 5.
 *  - Experience summary: top-3 resume experiences formatted as
 *    `"Role at Company (Duration) — short description"`. If resume has no
 *    experiences, fall back to portfolio config experiences.
 */
export function formatStaticContext(
  resume: ResumeStructured | null,
  config: PortfolioSiteConfig | null,
  username: string,
): StaticContext {
  const candidateName =
    nonEmpty(resume?.name) ??
    nonEmpty(config?.identity?.name) ??
    username;

  const candidateTitle =
    nonEmpty(resume?.title) ?? nonEmpty(config?.identity?.title) ?? "";

  const candidateBio =
    nonEmpty(resume?.summary) ?? nonEmpty(config?.identity?.bio) ?? "";

  const skills = collectSkills(resume, config);
  const topProjects = collectTopProjects(resume, config);
  const experienceSummary = formatExperienceSummary(resume, config);
  const educationSummary = formatEducationSummary(resume);
  const certifications = collectCertifications(resume);
  const contactInfo = formatContactInfo(resume, config);

  return {
    candidateName,
    candidateTitle,
    candidateBio,
    skills,
    contactInfo,
    experienceSummary,
    educationSummary,
    certifications,
    topProjects,
  };
}

// ── getPortfolioGitHubContext ──────────────────────────────────────────────

/**
 * Fetch GitHub memory for the recruiter's query, bounded by:
 *  - prompt-size limits: `repoLimit: 5, prLimit: 3, issueLimit: 3`
 *  - latency: 1.5-second `Promise.race` timeout
 *
 * Returns `null` on timeout, error, or fully-empty context — letting the
 * route call this in a single line and branch on a single value rather than
 * inspecting each field for emptiness.
 */
export async function getPortfolioGitHubContext(
  userId: string,
  query: string,
): Promise<GitHubMemoryContext | null> {
  const fetchPromise = getGitHubMemoryContext(userId, query, {
    repoLimit: 5,
    prLimit: 3,
    issueLimit: 3,
  });

  // Silent failure on timeout per design: graceful-degradation requirement
  // means we resolve to `null` rather than throwing. The handle is cleared
  // when `fetchPromise` wins the race so the timer doesn't keep the event
  // loop alive after the route has already streamed its response.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(null), GITHUB_MEMORY_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([fetchPromise, timeoutPromise]);
    if (!result) return null;
    if (isEmptyMemoryContext(result)) return null;
    return result;
  } catch {
    return null;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

// ── extractAllowedRepos ────────────────────────────────────────────────────

/**
 * Derive the `owner/name` allowlist for `buildPortfolioGithubTools` from a
 * memory context. Returns `[]` when the context is null so the route can
 * register zero on-demand tools (or skip tool registration entirely).
 */
export function extractAllowedRepos(
  ctx: GitHubMemoryContext | null,
): string[] {
  if (!ctx) return [];
  return ctx.repos.map((r) => r.fullName).filter((name) => name.includes("/"));
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Trim and treat empty strings as missing. */
function nonEmpty(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Union resume skills with every `techstacks` array on portfolio experiences
 * and projects. Dedupe by lowercase+trim of the value but preserve the FIRST
 * seen original casing. Order is stable: resume skills come first, then
 * portfolio experience techstacks (in declaration order), then portfolio
 * project techstacks (in declaration order).
 *
 * `resume.skills` may be EITHER:
 *   - The canonical extractor object `{ languages, frameworks, tools, soft, other }`
 *     (each value an optional `string[]`), or
 *   - A flat `string[]` from legacy / hand-authored rows.
 * Both shapes are flattened into a single ordered list before dedup. Anything
 * else (null, undefined, malformed object) contributes nothing without
 * throwing — this is what fixes the "resume.skills is not iterable" crash.
 */
function collectSkills(
  resume: ResumeStructured | null,
  config: PortfolioSiteConfig | null,
): string[] {
  const sources: string[] = [];

  for (const skill of flattenResumeSkills(resume?.skills)) {
    sources.push(skill);
  }

  if (config?.experiences && Array.isArray(config.experiences)) {
    for (const exp of config.experiences) {
      if (Array.isArray(exp?.techstacks)) {
        for (const s of exp.techstacks) sources.push(s);
      }
    }
  }

  if (config?.projects && Array.isArray(config.projects)) {
    for (const proj of config.projects) {
      if (Array.isArray(proj?.techstacks)) {
        for (const s of proj.techstacks) sources.push(s);
      }
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sources) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Flatten the resume skills value into an ordered list of strings, accepting
 * the canonical extractor object shape, a flat array, or anything malformed
 * (returns `[]`). Order within the canonical object is:
 * languages → frameworks → tools → soft → other.
 */
function flattenResumeSkills(
  skills: ResumeStructured["skills"] | undefined,
): string[] {
  if (!skills) return [];
  if (Array.isArray(skills)) return skills.filter((s) => typeof s === "string");
  if (typeof skills !== "object") return [];

  const out: string[] = [];
  const groups: (keyof NonNullable<typeof skills>)[] = [
    "languages",
    "frameworks",
    "tools",
    "soft",
    "other",
  ];
  for (const group of groups) {
    const value = (skills as Record<string, unknown>)[group as string];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") out.push(item);
      }
    }
  }
  return out;
}

/**
 * Build top-N project list. Portfolio config projects come first because the
 * candidate explicitly curated them; resume projects fill any remaining
 * slots. Duplicate titles (case-insensitive) are collapsed in favor of the
 * earlier (config) entry.
 */
function collectTopProjects(
  resume: ResumeStructured | null,
  config: PortfolioSiteConfig | null,
): StaticContext["topProjects"] {
  const seen = new Set<string>();
  const out: StaticContext["topProjects"] = [];

  if (config?.projects && Array.isArray(config.projects)) {
    for (const proj of config.projects) {
      if (out.length >= MAX_TOP_PROJECTS) break;
      const title = nonEmpty(proj?.title);
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title,
        description: nonEmpty(proj.description) ?? "",
        techstacks: Array.isArray(proj.techstacks) ? [...proj.techstacks] : [],
      });
    }
  }

  if (
    resume?.projects &&
    Array.isArray(resume.projects) &&
    out.length < MAX_TOP_PROJECTS
  ) {
    for (const proj of resume.projects) {
      if (out.length >= MAX_TOP_PROJECTS) break;
      const title = nonEmpty(proj?.name);
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title,
        description: nonEmpty(proj.description) ?? "",
        techstacks: Array.isArray(proj.technologies)
          ? [...proj.technologies]
          : [],
      });
    }
  }

  return out;
}

/**
 * Render the top-3 experiences as a multi-line string in the form
 * `"Role at Company (Duration) — short description"`.
 *
 * The canonical extractor stores `title` (not `role`), `bullets: string[]`
 * (not `description`), and `startDate`/`endDate`/`isCurrent` (not a single
 * `duration` string). We accept both shapes here:
 *   - Role: `title` ?? `role`
 *   - Description: `description` ?? first non-empty `bullets[]` entry
 *   - Duration: `duration` ?? `formatDateRange(startDate, endDate, isCurrent)`
 *
 * When the resume has no experiences, fall back to portfolio config
 * experiences and synthesize a description from the first responsibility
 * bullet's text segments.
 */
function formatExperienceSummary(
  resume: ResumeStructured | null,
  config: PortfolioSiteConfig | null,
): string {
  const lines: string[] = [];

  if (
    resume?.experience &&
    Array.isArray(resume.experience) &&
    resume.experience.length > 0
  ) {
    for (const exp of resume.experience.slice(0, MAX_EXPERIENCE_ENTRIES)) {
      if (!exp || typeof exp !== "object") continue;
      const role = nonEmpty(exp.title) ?? nonEmpty(exp.role) ?? "";
      const company = nonEmpty(exp.company) ?? "";
      const duration =
        nonEmpty(exp.duration) ??
        formatDateRange(exp.startDate, exp.endDate, exp.isCurrent);
      const description =
        nonEmpty(exp.description) ?? firstNonEmpty(exp.bullets);
      lines.push(formatExperienceLine(role, company, duration, description));
    }
    return lines.join("\n");
  }

  if (
    config?.experiences &&
    Array.isArray(config.experiences) &&
    config.experiences.length > 0
  ) {
    for (const exp of config.experiences.slice(0, MAX_EXPERIENCE_ENTRIES)) {
      if (!exp || typeof exp !== "object") continue;
      const role = nonEmpty(exp.role) ?? "";
      const company = nonEmpty(exp.company) ?? "";
      const duration = nonEmpty(exp.year) ?? "";
      const description = flattenResponsibility(exp.responsibility);
      lines.push(formatExperienceLine(role, company, duration, description));
    }
    return lines.join("\n");
  }

  return "";
}

/**
 * Format a date range from extractor `startDate` / `endDate` / `isCurrent`
 * fields into a human string. `"Jan 2024 — Present"`, `"Jun 2022 — Aug 2023"`,
 * or `""` if both endpoints are missing.
 */
function formatDateRange(
  startDate: string | undefined,
  endDate: string | undefined,
  isCurrent: boolean | undefined,
): string {
  const start = nonEmpty(startDate);
  const end = isCurrent ? "Present" : nonEmpty(endDate);
  if (start && end) return `${start} — ${end}`;
  if (start) return start;
  if (end) return end;
  return "";
}

/** Return the first non-empty string from an array, or "". Tolerates non-arrays. */
function firstNonEmpty(values: string[] | undefined): string {
  if (!Array.isArray(values)) return "";
  for (const value of values) {
    const trimmed = nonEmpty(value);
    if (trimmed) return trimmed;
  }
  return "";
}

function formatExperienceLine(
  role: string,
  company: string,
  duration: string,
  description: string,
): string {
  const head =
    role && company
      ? `${role} at ${company}`
      : role || company || "Experience";
  const dur = duration ? ` (${duration})` : "";
  const desc = description ? ` — ${description}` : "";
  return `${head}${dur}${desc}`;
}

/**
 * Pull text out of the first non-empty responsibility bullet on a portfolio
 * experience. The portfolio config stores responsibilities as nested arrays
 * of `{ text, bold? }` rich-text segments; we concatenate `text` for the
 * first bullet only to keep the summary line short.
 */
function flattenResponsibility(
  responsibility:
    | { text: string; bold?: boolean }[][]
    | undefined,
): string {
  if (!responsibility) return "";
  for (const bullet of responsibility) {
    if (!Array.isArray(bullet)) continue;
    const text = bullet
      .map((seg) => (typeof seg?.text === "string" ? seg.text : ""))
      .join("")
      .trim();
    if (text.length > 0) return text;
  }
  return "";
}

/**
 * A memory context counts as "empty" when none of the meaningful narrative,
 * repo, PR, issue, expertise, or insight collections has any entries. Stats
 * alone don't qualify because they're aggregate counts that may be zero even
 * when other layers are populated.
 */
function isEmptyMemoryContext(ctx: GitHubMemoryContext): boolean {
  return (
    ctx.repos.length === 0 &&
    ctx.prs.length === 0 &&
    ctx.issues.length === 0 &&
    ctx.expertise.length === 0 &&
    ctx.narrative.length === 0 &&
    ctx.insights.length === 0
  );
}


// ── Education ──────────────────────────────────────────────────────────────

/**
 * Format education entries from the resume into a multi-line string.
 * Each entry: "Degree in Field — Institution (Year)"
 */
function formatEducationSummary(resume: ResumeStructured | null): string {
  if (!resume?.education || !Array.isArray(resume.education) || resume.education.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const edu of resume.education) {
    if (!edu || typeof edu !== "object") continue;
    const degree = nonEmpty(edu.degree) ?? "";
    const field = nonEmpty(edu.field);
    const institution = nonEmpty(edu.institution) ?? "";
    const year = nonEmpty(edu.endDate) ?? nonEmpty(edu.year) ?? nonEmpty(edu.startDate) ?? "";
    const gpa = nonEmpty(edu.gpa);

    let line = degree;
    if (field) line += ` in ${field}`;
    if (institution) line += ` — ${institution}`;
    if (year) line += ` (${year})`;
    if (gpa) line += ` [GPA: ${gpa}]`;

    if (line.trim().length > 0) lines.push(line.trim());
  }

  return lines.join("\n");
}

// ── Certifications ─────────────────────────────────────────────────────────

/**
 * Collect certifications from the resume. Handles both object array and
 * legacy string array formats.
 */
function collectCertifications(resume: ResumeStructured | null): string[] {
  if (!resume?.certifications) return [];

  if (Array.isArray(resume.certifications)) {
    return resume.certifications
      .map((cert) => {
        if (typeof cert === "string") return cert;
        if (cert && typeof cert === "object" && "name" in cert) {
          const parts = [cert.name];
          if (cert.issuer) parts.push(`by ${cert.issuer}`);
          if (cert.date) parts.push(`(${cert.date})`);
          return parts.join(" ");
        }
        return "";
      })
      .filter((s) => s.length > 0);
  }

  return [];
}


// ── Contact Info ───────────────────────────────────────────────────────────

/**
 * Collect contact information from resume and portfolio config.
 * Includes email, LinkedIn, website, calendar link, etc.
 */
function formatContactInfo(
  resume: ResumeStructured | null,
  config: PortfolioSiteConfig | null,
): string {
  const lines: string[] = [];

  // Email
  const email = nonEmpty(config?.contact?.email) ?? nonEmpty((resume as any)?.email);
  if (email) lines.push(`- **Email:** ${email}`);

  // LinkedIn
  const linkedin = config?.socials?.linkedin;
  if (linkedin?.url) lines.push(`- **LinkedIn:** ${linkedin.url}`);

  // GitHub
  const github = config?.socials?.github;
  if (github?.url) lines.push(`- **GitHub:** ${github.url}`);

  // Website
  const website = nonEmpty(config?.contact?.url);
  if (website) lines.push(`- **Website:** ${website}`);

  // Calendar/meeting link
  const calUrl = nonEmpty(config?.contact?.calUrl);
  if (calUrl) lines.push(`- **Schedule a meeting:** ${calUrl}`);

  // Resume link
  const resumeUrl = nonEmpty(config?.contact?.resumeUrl);
  if (resumeUrl) lines.push(`- **Resume:** ${resumeUrl}`);

  return lines.join("\n");
}
