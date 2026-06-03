/**
 * Project merge + ranking pipeline.
 *
 * Deterministically merges resume-extracted projects with GitHub public
 * repositories into a single ranked list, with deduplication.
 *
 * Pipeline (pure functions, no I/O):
 *   1. `dedupeAndMerge(resumeProjects, repos)` — pair resume entries with
 *       GitHub repos by title/slug similarity. When a pair matches, keep
 *       the resume entry's user-curated fields (title, description) and
 *       enrich with GitHub metadata (stars, lastPushed, topics, homepage,
 *       url). Resume content always wins over GitHub on conflict.
 *
 *   2. `scoreProject(merged, ctx)` — compute a deterministic 0..1 score
 *       from explicit weighted factors. The score is reproducible: same
 *       input → same score. No randomness, no LLM calls, no network.
 *
 *   3. `rankProjects(merged)` — sort descending by score, stable-tie-break
 *       on title for determinism in tests and snapshots.
 *
 * Why deterministic ranking matters here:
 *   - It is reproducible for tests and audit (Property 1 in the audit
 *     requirements).
 *   - It avoids the previous architecture in
 *     `portfolio-config-generator.ts` where AI was asked to "merge"
 *     resume + GitHub projects implicitly. That was non-deterministic,
 *     allowed the LLM to drop entries, and could not be validated.
 *
 * Pure module: no imports from `ai`, `@/lib/insforge/*`, or `@/lib/memory/*`.
 */

import type { RepoAnalysis } from "./github-analyzer";
import type { ResumeData } from "./resume-extractor";

// ── Types ──────────────────────────────────────────────────────────────────

export interface MergedProject {
  /** Final user-facing title. */
  title: string;
  /** Stable slug derived from title. Used for deduplication. */
  slug: string;
  /** User-facing category (e.g. "Open Source", "SaaS"). */
  category: string;
  description: string;
  techstacks: string[];
  /** "live" / "active" / "archived" — derived heuristically. */
  status: "live" | "building" | "active" | "archived";
  /** Live demo / homepage. Validated upstream; null when missing/invalid. */
  link: string | null;
  /** "owner/repo" slug. Validated upstream; null when private/missing. */
  github: string | null;
  /** Stars from GitHub metadata, null if no GitHub side. */
  stars: number | null;
  /** ISO timestamp of last push (GitHub metadata). */
  lastPushed: string | null;
  /** Source of truth — "resume" alone, "github" alone, or "merged". */
  source: "resume" | "github" | "merged";
  /** Explicit, computed score (0..1). Not stored; recomputed every run. */
  score: number;
}

export interface RankingContext {
  /**
   * `owner/repo` slugs that GitHub flagged as pinned. Pinned repos get a
   * large explicit boost. Empty array when the pinned-repos GraphQL probe
   * was unavailable (we still rank by stars/recency).
   */
  pinnedRepos?: string[];
  /** Now timestamp for recency math. Injectable for tests. */
  now?: Date;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * End-to-end merge + rank. Returns a stable, descending-sorted list.
 *
 * Resume projects ALWAYS appear in the output. GitHub-only repos are
 * appended (deduped). When a pair matches by slug similarity, the merged
 * entry is emitted ONCE in place of both inputs.
 */
export function mergeAndRankProjects(
  resume: ResumeData,
  repos: RepoAnalysis[],
  ctx: RankingContext = {},
): MergedProject[] {
  const merged = dedupeAndMerge(resume.projects ?? [], repos ?? []);
  for (const p of merged) {
    p.score = scoreProject(p, ctx);
  }
  // Stable sort: score desc, then title asc for determinism.
  merged.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });
  return merged;
}

// ── Slug + similarity ──────────────────────────────────────────────────────

/**
 * Stable slug for dedupe. Lowercase, ascii-letters/digits/dashes only,
 * collapsed dashes. Used both for resume project names and GitHub repo
 * names.
 */
export function projectSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Similarity in [0,1] using a token-Jaccard score plus exact-slug bonus.
 * Used to pair resume projects with GitHub repos when slugs are close but
 * not identical (e.g. "Portfolio Site" ↔ "portfolio-site",
 * "AI Blox" ↔ "ai-blox-generator").
 *
 * 1.0  → exact slug match
 * ≥0.6 → considered the same project (boundary tuned conservatively
 *        to prefer false negatives over false positives — better to
 *        emit a duplicate than to merge two distinct projects).
 */
export function slugSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokensA = new Set(a.split("-").filter(Boolean));
  const tokensB = new Set(b.split("-").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let inter = 0;
  for (const t of tokensA) if (tokensB.has(t)) inter++;
  const union = tokensA.size + tokensB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Pair resume projects with GitHub repos. Each repo is matched to AT MOST
 * ONE resume entry (the highest-scoring pair above threshold). Unmatched
 * resume entries pass through; unmatched repos are appended.
 *
 * Resume always wins on title/description/techstacks. GitHub fills in
 * stars/lastPushed/url/homepage and tops up techstacks with topics+
 * primary language when the resume entry didn't list them.
 */
export function dedupeAndMerge(
  resumeProjects: NonNullable<ResumeData["projects"]>,
  repos: RepoAnalysis[],
): MergedProject[] {
  const out: MergedProject[] = [];
  const claimedRepoIdx = new Set<number>();

  // 1. Resume-led pass: for each resume project find its best GitHub match.
  for (const proj of resumeProjects) {
    if (!proj?.name) continue;
    const slug = projectSlug(proj.name);

    let bestIdx = -1;
    let bestScore = 0.6; // similarity threshold
    for (let i = 0; i < repos.length; i++) {
      if (claimedRepoIdx.has(i)) continue;
      const repo = repos[i];
      const repoSlug = projectSlug(repo.name);
      const sim = slugSimilarity(slug, repoSlug);
      if (sim > bestScore) {
        bestScore = sim;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const repo = repos[bestIdx];
      claimedRepoIdx.add(bestIdx);
      out.push(buildMerged(proj, repo, "merged"));
    } else {
      out.push(buildMerged(proj, null, "resume"));
    }
  }

  // 2. GitHub-only pass: append repos that didn't pair with a resume entry.
  for (let i = 0; i < repos.length; i++) {
    if (claimedRepoIdx.has(i)) continue;
    out.push(buildMerged(null, repos[i], "github"));
  }

  return out;
}

function buildMerged(
  resumeProj: NonNullable<ResumeData["projects"]>[number] | null,
  repo: RepoAnalysis | null,
  source: MergedProject["source"],
): MergedProject {
  const titleFromResume = resumeProj?.name?.trim() || "";
  const titleFromRepo = repo?.name?.trim() || "";
  const title = titleFromResume || titleFromRepo;
  const slug = projectSlug(title);

  // Description: resume always wins because it's user-curated.
  const description =
    resumeProj?.description?.trim() ||
    repo?.description?.trim() ||
    "";

  // Techstacks: union (resume order first, then GitHub topics + language).
  const techstacks: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | undefined | null) => {
    if (typeof s !== "string") return;
    const v = s.trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    techstacks.push(v);
  };
  for (const t of resumeProj?.technologies ?? []) push(t);
  for (const t of repo?.techStack ?? []) push(t);
  for (const t of repo?.topics ?? []) push(t);

  // Status: derive from GitHub activity when available; else "active".
  const status = deriveStatus(repo);

  // Live link: resume project URL takes precedence if present and looks
  // like a webpage; otherwise leave null. Repo homepage is NOT promoted
  // here because it isn't validated yet — `link-validator.ts` does that.
  const link = isLikelyHttpUrl(resumeProj?.url) ? (resumeProj!.url as string) : null;

  // GitHub field: only when we have a repo side AND it isn't a fork
  // (forks add noise without adding evidence of authorship).
  const github = repo && !slug.startsWith("fork-")
    ? `${ownerFromRepo(repo)}/${repo.name}`
    : null;

  return {
    title,
    slug,
    category: deriveCategory(repo, resumeProj),
    description,
    techstacks,
    status,
    link,
    github,
    stars: repo?.stars ?? null,
    lastPushed: repo?.lastPushed ?? null,
    source,
    score: 0, // overwritten by `scoreProject`
  };
}

function ownerFromRepo(repo: RepoAnalysis): string {
  // RepoAnalysis stores the canonical URL; parse owner from it.
  // Fallback to "user" if unparseable so the type stays honest.
  try {
    const url = new URL(repo.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 1) return parts[0];
  } catch {
    /* swallow */
  }
  return "user";
}

function deriveStatus(repo: RepoAnalysis | null): MergedProject["status"] {
  if (!repo) return "active";
  if (!repo.lastPushed) return "active";
  const ageDays = ageInDays(repo.lastPushed);
  if (ageDays === null) return "active";
  if (ageDays > 365) return "archived";
  if (ageDays < 30) return "active";
  return "active";
}

function deriveCategory(
  repo: RepoAnalysis | null,
  resumeProj: NonNullable<ResumeData["projects"]>[number] | null,
): string {
  if (resumeProj?.technologies?.length) {
    const t = resumeProj.technologies[0];
    if (t) return t;
  }
  if (repo?.topics?.length) return repo.topics[0];
  if (repo) return "Open Source";
  return "Project";
}

function isLikelyHttpUrl(value: string | undefined | null): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  return /^https?:\/\//i.test(v);
}

function ageInDays(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
}

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Deterministic 0..1 score. Composed of explicit weighted factors so an
 * audit can read the formula and reproduce any value. Each factor returns
 * a value in [0,1]; the final score is a weighted sum then clamped.
 *
 * Weights (tunable; the relative ordering matters more than the exact
 * numbers):
 *
 *   resumePresence   0.30  is this project on the resume? (user curation)
 *   pinned           0.20  flagged as pinned on GitHub?
 *   stars            0.15  log-normalised star count
 *   recency          0.10  newer pushes rank higher
 *   techStackDepth   0.08  more tech tags ⇒ richer project
 *   description      0.07  has a non-empty description
 *   liveLink         0.05  has a working live URL (validated upstream)
 *   activity         0.05  pushed in the last 90 days (signal of "alive")
 *
 * Total max = 1.00 (resume-pinned-starred-recent-rich-described-live-active).
 */
export function scoreProject(
  p: MergedProject,
  ctx: RankingContext = {},
): number {
  const now = ctx.now ?? new Date();
  const isPinned = !!ctx.pinnedRepos?.some(
    (full) => p.github && full.toLowerCase() === p.github.toLowerCase(),
  );

  const resumePresence = p.source === "resume" || p.source === "merged" ? 1 : 0;
  const pinned = isPinned ? 1 : 0;
  const stars = starsFactor(p.stars);
  const recency = recencyFactor(p.lastPushed, now);
  const techStackDepth = Math.min(p.techstacks.length / 6, 1);
  const description = p.description.trim().length > 30 ? 1 : 0;
  const liveLink = p.link ? 1 : 0;
  const activity = isRecentlyActive(p.lastPushed, now) ? 1 : 0;

  const score =
    0.30 * resumePresence +
    0.20 * pinned +
    0.15 * stars +
    0.10 * recency +
    0.08 * techStackDepth +
    0.07 * description +
    0.05 * liveLink +
    0.05 * activity;

  return clamp01(score);
}

function starsFactor(stars: number | null): number {
  if (stars == null || stars <= 0) return 0;
  // log10(1+stars) / log10(101): 0 stars→0, 100 stars→1, saturates above.
  return Math.min(Math.log10(1 + stars) / Math.log10(101), 1);
}

function recencyFactor(iso: string | null, now: Date): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  const ageDays = Math.max(0, (now.getTime() - t) / (1000 * 60 * 60 * 24));
  // Linear decay over 2 years, then 0.
  return Math.max(0, 1 - ageDays / 730);
}

function isRecentlyActive(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const ageDays = Math.max(0, (now.getTime() - t) / (1000 * 60 * 60 * 24));
  return ageDays <= 90;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function rankProjects(merged: MergedProject[]): MergedProject[] {
  const copy = [...merged];
  copy.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });
  return copy;
}
