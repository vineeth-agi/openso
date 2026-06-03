/**
 * GitHub Deep Analyzer — Fetches ALL repos, PRs, contributions
 * and writes structured data to memory_facts + user_profiles.
 *
 * Uses the user's GitHub OAuth token from connected_apps or
 * the cookie-based github_token, and falls back to public API.
 */

import { getConnectionAdmin } from "@/lib/connections";
import { createAdminClient } from "@/lib/insforge/admin";
import { addFact } from "@/lib/memory/store";

// ── Types ───────────────────────────────────────────────────

interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  languages_url: string;
  stargazers_count: number;
  forks_count: number;
  fork: boolean;
  /**
   * GitHub's "private" flag. Strict requirement: this analyzer (and every
   * downstream consumer in `portfolio-config-generator`, `portfolio-chat`,
   * GitHub Memory) MUST filter `private === true` out of every result.
   * See `Issue #4` in the audit report.
   */
  private: boolean;
  /** Same signal exposed under a different name on some GitHub responses. */
  visibility?: "public" | "private" | "internal";
  topics: string[];
  pushed_at: string;
  size: number;
}

export interface RepoAnalysis {
  name: string;
  url: string;
  description: string | null;
  techStack: string[];
  stars: number;
  forks: number;
  topics: string[];
  lastPushed: string;
  mergedPRs: number;
  role: "owner" | "contributor";
}

export interface GitHubProfile {
  username: string;
  repos: RepoAnalysis[];
  contributions: {
    totalCommits: number;
    mergedPRs: number;
    totalRepos: number;
    topLanguages: string[];
    languageBreakdown: Record<string, number>;
  };
}

// ── Helpers ─────────────────────────────────────────────────

async function ghFetch<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function fetchAllRepos(
  baseUrl: string,
  headers: Record<string, string>,
  maxPages = 10,
): Promise<GitHubRepo[]> {
  const all: GitHubRepo[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const batch = await ghFetch<GitHubRepo[]>(
      `${baseUrl}${sep}per_page=100&sort=pushed&page=${page}`,
      headers,
    );
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

// ── Core Analyzer ──────────────────────────────────────────

/**
 * Get the user's GitHub token.
 * Priority: profiles.github_token > connected_apps > env GITHUB_TOKEN
 */
async function getGitHubToken(userId: string): Promise<string | null> {
  const db = createAdminClient();

  // Check profiles table for stored github info
  const { data: profile } = await db.database.from("profiles")
    .select("github_username")
    .eq("id", userId)
    .single();

  if (!profile?.github_username) return null;

  // Read via the encrypted-row helper (DB-HIGH-01) — `getConnectionAdmin`
  // routes through `decryptConnectionRow` which unwraps `enc:v1:` tokens
  // and tolerates legacy plaintext rows. Direct `from("connected_apps")`
  // SELECTs are forbidden because they'd hand back ciphertext for any
  // freshly-issued token.
  const conn = await getConnectionAdmin(userId, "github");
  if (conn?.access_token) return conn.access_token;

  // Fallback to env (limited, but works for public repos)
  return process.env.GITHUB_TOKEN || null;
}

/**
 * Analyze a user's GitHub profile deeply.
 */
async function analyzeGitHub(userId: string): Promise<GitHubProfile | null> {
  const db = createAdminClient();

  // Get GitHub username from profiles
  const { data: profile } = await db.database.from("profiles")
    .select("github_username")
    .eq("id", userId)
    .single();

  if (!profile?.github_username) return null;

  const username = profile.github_username;
  const token = await getGitHubToken(userId);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // 1. Fetch all repos.
  //
  //    STRICT REQUIREMENT (Issue #4): only PUBLIC repos may flow into the
  //    portfolio. We always request public-only when authenticated by
  //    using `?visibility=public`, and we explicitly filter `r.private`
  //    after the fetch as defence in depth (in case a token-scoped
  //    response includes private repos despite the query param).
  //
  //    For unauthenticated calls (no token) the `/users/:user/repos`
  //    endpoint returns public repos only by definition.
  const repoUrl = token
    ? "https://api.github.com/user/repos?type=owner&visibility=public"
    : `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=owner`;

  const allRepos = await fetchAllRepos(repoUrl, headers);

  // Defence in depth: drop forks AND drop anything still marked private
  // even after the visibility query param above.
  const ownRepos = allRepos.filter(
    (r) => !r.fork && !r.private && r.visibility !== "private",
  );

  // 2. Aggregate languages
  const langTotals: Record<string, number> = {};
  // For top 30 repos, fetch detailed languages if authenticated
  const langFetchCount = token ? Math.min(ownRepos.length, 30) : 0;
  const langPromises = ownRepos.slice(0, langFetchCount).map(async (repo) => {
    const langs = await ghFetch<Record<string, number>>(repo.languages_url, headers);
    if (langs) {
      for (const [lang, bytes] of Object.entries(langs)) {
        langTotals[lang] = (langTotals[lang] || 0) + bytes;
      }
    }
  });
  await Promise.all(langPromises);

  // Fallback: use repo.language if no detailed data
  if (Object.keys(langTotals).length === 0) {
    for (const r of ownRepos) {
      if (r.language) langTotals[r.language] = (langTotals[r.language] || 0) + r.size;
    }
  }

  const topLanguages = Object.entries(langTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([lang]) => lang);

  // 3. Fetch merged PRs per repo (top 15 by activity)
  const repoAnalyses: RepoAnalysis[] = [];
  const topRepos = ownRepos.slice(0, 20);

  for (const repo of topRepos) {
    let mergedPRs = 0;
    if (token) {
      const prs = await ghFetch<Array<{ state: string }>>(
        `https://api.github.com/repos/${repo.full_name}/pulls?state=closed&per_page=100`,
        headers,
      );
      if (prs) mergedPRs = prs.length; // closed PRs for own repo
    }

    const techStack: string[] = [];
    if (repo.language) techStack.push(repo.language);
    techStack.push(...(repo.topics || []));

    repoAnalyses.push({
      name: repo.name,
      url: repo.html_url,
      description: repo.description,
      techStack: [...new Set(techStack)],
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      topics: repo.topics || [],
      lastPushed: repo.pushed_at,
      mergedPRs,
      role: "owner",
    });
  }

  // 4. Fetch contribution events (recent commits/PRs from all repos)
  let totalCommits = 0;
  let totalMergedPRs = 0;

  if (token) {
    // Events API gives last 300 events
    const events = await ghFetch<Array<{ type: string }>>(
      `https://api.github.com/users/${encodeURIComponent(username)}/events?per_page=100`,
      headers,
    );
    if (events) {
      totalCommits = events.filter((e) => e.type === "PushEvent").length;
      totalMergedPRs = events.filter((e) => e.type === "PullRequestEvent").length;
    }
  }

  const result: GitHubProfile = {
    username,
    repos: repoAnalyses,
    contributions: {
      totalCommits: totalCommits || ownRepos.length * 10, // rough estimate if no events
      mergedPRs: totalMergedPRs,
      totalRepos: ownRepos.length, // public, non-fork repos only (Issue #4)
      topLanguages,
      languageBreakdown: langTotals,
    },
  };

  return result;
}

// ── Ingest to Memory + DB ──────────────────────────────────

/**
 * Full GitHub ingestion pipeline:
 * 1. Analyze GitHub profile deeply
 * 2. Write facts to memory_facts
 * 3. Save to user_profiles
 */
export async function ingestGitHub(userId: string): Promise<{ profile: GitHubProfile; factsAdded: number } | null> {
  const db = createAdminClient();
  const profile = await analyzeGitHub(userId);
  if (!profile) return null;

  let factsAdded = 0;

  // Save to user_profiles FIRST — even if embedding quota is exhausted, the data is persisted
  await db.database.from("user_profiles")
    .upsert({
      user_id: userId,
      github_repos: profile.repos as unknown as Record<string, unknown>,
      github_contributions: profile.contributions as unknown as Record<string, unknown>,
      github_analyzed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  // Collect all facts first, then add them with delays to respect embedding rate limits
  const pendingFacts: { category: "technical" | "professional"; fact: string; importance: number }[] = [];

  // Language facts
  if (profile.contributions.topLanguages.length) {
    pendingFacts.push({ category: "technical", fact: `GitHub top languages: ${profile.contributions.topLanguages.slice(0, 8).join(", ")}`, importance: 0.9 });
  }

  // Repo facts (top 8 by stars — reduced from 10 to save embedding quota)
  const topByStars = [...profile.repos].sort((a, b) => b.stars - a.stars).slice(0, 8);
  for (const repo of topByStars) {
    const techStr = repo.techStack.length ? ` using ${repo.techStack.slice(0, 5).join(", ")}` : "";
    const starsStr = repo.stars > 0 ? ` (${repo.stars} stars)` : "";
    const desc = repo.description ? `: ${repo.description.slice(0, 150)}` : "";
    pendingFacts.push({ category: "technical", fact: `GitHub repo "${repo.name}"${desc}${techStr}${starsStr}`, importance: 0.75 });
  }

  // Contribution stats
  pendingFacts.push({ category: "professional", fact: `GitHub: ${profile.contributions.totalRepos} repos, ${profile.contributions.totalCommits} commits, ${profile.contributions.mergedPRs} merged PRs`, importance: 0.8 });

  // Per-repo tech stacks aggregated — combine into fewer facts
  const allTech = new Set<string>();
  for (const r of profile.repos) {
    for (const t of r.techStack) allTech.add(t);
  }
  if (allTech.size > 0) {
    const techArr = [...allTech].slice(0, 20);
    // Single fact with all tech instead of multiple chunks
    pendingFacts.push({ category: "technical", fact: `GitHub-evidenced tech stack: ${techArr.join(", ")}`, importance: 0.85 });
  }

  // Add facts one by one with a small delay to stay under embedding rate limit
  for (const pf of pendingFacts) {
    try {
      const result = await addFact(userId, {
        category: pf.category,
        fact: pf.fact,
        confidence: 1.0, // GitHub data is ground truth
        importance: pf.importance,
        memoryType: "fact",
      }, "github");
      if (result.action !== "skipped") factsAdded++;
      // Small delay between facts to respect embedding rate limits
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.warn("[ingest-github] Failed to add fact (continuing):", pf.fact.slice(0, 60), err instanceof Error ? err.message : err);
      // Wait longer after a rate limit error
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  return { profile, factsAdded };
}
