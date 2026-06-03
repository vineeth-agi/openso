/**
 * GitHub Memory Retrieval — Unified search across all GitHub memory layers.
 *
 * Integrates with the main memory retriever via getGitHubMemoryContext().
 * Supports semantic search, graph traversal, expertise lookup, and timeline queries.
 */

import type { GitHubExpertise, GitHubGraphEdge, GitHubMemoryRepo } from "./types";

import { createAdminClient } from "@/lib/insforge/admin";
import { embed } from "@/lib/memory/embeddings";


// ── Public types ──

export interface GitHubMemoryContext {
  repos: GitHubRepoResult[];
  prs: GitHubPRResult[];
  issues: GitHubIssueResult[];
  expertise: GitHubExpertise[];
  graph: GitHubGraphEdge[];
  stats: GitHubStats | null;
  narrative: { section: string; content: string }[];
  insights: { type: string; insight: string; confidence: number }[];
}

export interface GitHubRepoResult {
  id: string;
  fullName: string;
  name: string;
  description: string | null;
  primaryLanguage: string | null;
  topics: string[];
  stars: number;
  role: string;
  importance: number;
  similarity: number;
}

export interface GitHubPRResult {
  id: string;
  repoName: string;
  title: string;
  state: string;
  category: string | null;
  importance: number;
  createdAt: string;
  similarity: number;
}

export interface GitHubIssueResult {
  id: string;
  repoName: string;
  title: string;
  state: string;
  issueType: string | null;
  labels: string[];
  importance: number;
  createdAt: string;
  similarity: number;
}

export interface GitHubStats {
  totalRepos: number;
  totalCommits: number;
  totalPRs: number;
  totalIssues: number;
  topLanguages: string[];
  topExpertise: { skill: string; confidence: number }[];
  activeSince: string | null;
}

// ── Main retrieval ──

/**
 * Get GitHub memory context for a query.
 * Called from the main memory retriever when GitHub data is relevant.
 */
export async function getGitHubMemoryContext(
  userId: string,
  query: string,
  options?: {
    repoLimit?: number;
    prLimit?: number;
    issueLimit?: number;
    includeGraph?: boolean;
    includeStats?: boolean;
  },
): Promise<GitHubMemoryContext> {
  const repoLimit = options?.repoLimit ?? 5;
  const prLimit = options?.prLimit ?? 5;
  const issueLimit = options?.issueLimit ?? 5;
  const includeGraph = options?.includeGraph ?? true;
  const includeStats = options?.includeStats ?? true;

  const db = createAdminClient();

  // Embed query for semantic search
  const queryEmbedding = await embed(query).catch(() => null);

  // Parallel fetches
  const [repos, prs, issues, expertise, graph, stats] = await Promise.all([
    queryEmbedding
      ? searchRepos(db, userId, queryEmbedding, repoLimit)
      : Promise.resolve([]),
    queryEmbedding
      ? searchPRs(db, userId, queryEmbedding, prLimit)
      : Promise.resolve([]),
    queryEmbedding
      ? searchIssues(db, userId, queryEmbedding, issueLimit)
      : Promise.resolve([]),
    getExpertise(db, userId),
    includeGraph ? getGraph(db, userId, query) : Promise.resolve([]),
    includeStats ? getStats(db, userId) : Promise.resolve(null),
  ]);

  // Also fetch AI-generated narrative + insights
  const [narrative, insights] = await Promise.all([
    getNarrative(db, userId),
    queryEmbedding
      ? getInsights(db, userId, queryEmbedding)
      : Promise.resolve([]),
  ]);

  return { repos, prs, issues, expertise, graph, stats, narrative, insights };
}

/**
 * Format GitHub memory context into a prompt section.
 */
export function formatGitHubMemoryPrompt(ctx: GitHubMemoryContext): string {
  const sections: string[] = [];

  // Developer narrative (AI-generated living summary)
  if (ctx.narrative.length > 0) {
    const narrativeLines = ctx.narrative.map((n) => `**${n.section}**: ${n.content}`);
    sections.push(`<github_developer_profile>
${narrativeLines.join("\n")}
</github_developer_profile>`);
  }

  // AI insights
  if (ctx.insights.length > 0) {
    const insightLines = ctx.insights.map((i) =>
      `- [${i.type}] ${i.insight} (${Math.round(i.confidence * 100)}%)`,
    );
    sections.push(`<github_insights>
${insightLines.join("\n")}
</github_insights>`);
  }

  // Stats summary
  if (ctx.stats) {
    sections.push(`<github_profile>
Repos: ${ctx.stats.totalRepos} | Commits: ${ctx.stats.totalCommits} | PRs: ${ctx.stats.totalPRs} | Issues: ${ctx.stats.totalIssues}
Active since: ${ctx.stats.activeSince ?? "unknown"}
Top languages: ${ctx.stats.topLanguages.join(", ") || "none"}
</github_profile>`);
  }

  // Expertise
  if (ctx.expertise.length > 0) {
    const expertiseLines = ctx.expertise.slice(0, 10).map((e) =>
      `- ${e.skill} (${e.skillCategory}): ${Math.round(e.confidence * 100)}% confidence, ${e.evidenceRepos} repos, ${e.yearsActive.toFixed(1)}y`,
    );
    sections.push(`<github_expertise>
${expertiseLines.join("\n")}
</github_expertise>`);
  }

  // Relevant repos
  if (ctx.repos.length > 0) {
    const repoLines = ctx.repos.map((r) => {
      const lang = r.primaryLanguage ? ` [${r.primaryLanguage}]` : "";
      const stars = r.stars > 0 ? ` ⭐${r.stars}` : "";
      return `- ${r.fullName}${lang}${stars}: ${r.description?.slice(0, 100) ?? "no description"}`;
    });
    sections.push(`<github_repos>
${repoLines.join("\n")}
</github_repos>`);
  }

  // Relevant PRs
  if (ctx.prs.length > 0) {
    const prLines = ctx.prs.map((p) =>
      `- [${p.state}] ${p.repoName}#${p.title} (${p.category ?? "other"})`,
    );
    sections.push(`<github_prs>
${prLines.join("\n")}
</github_prs>`);
  }

  // Graph relationships
  if (ctx.graph.length > 0) {
    const graphLines = ctx.graph.slice(0, 10).map((g) =>
      `- ${g.sourceName} —[${g.relationship}]→ ${g.targetName} (strength: ${g.strength.toFixed(2)})`,
    );
    sections.push(`<github_graph>
${graphLines.join("\n")}
</github_graph>`);
  }

  return sections.join("\n\n");
}

// ── Search helpers ──

async function searchRepos(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  queryEmbedding: number[],
  limit: number,
): Promise<GitHubRepoResult[]> {
  // Pull a few extra rows so we can drop private/archived ones at the
  // application layer without falling below `limit` on the public side.
  // We query 3× the limit, capped at 50, then trim after filtering.
  const overFetch = Math.min(50, limit * 3);
  const { data } = await db.database.rpc("search_github_repos", {
    query_embedding: queryEmbedding,
    search_user_id: userId,
    match_count: overFetch,
  });

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  // STRICT REQUIREMENT (Issue #4): never expose private repos through any
  // chatbot context. The RPC doesn't return `is_private`, so we look it up
  // in a single follow-up query keyed by the IDs we got back.
  const ids = rows.map((r) => r.id as string);
  const { data: visRows } = await db.database.from("github_memory_repos")
    .select("id, is_private")
    .in("id", ids);
  const privateIds = new Set<string>(
    ((visRows ?? []) as { id: string; is_private: boolean }[])
      .filter((v) => v.is_private === true)
      .map((v) => v.id),
  );

  return rows
    .filter((r) => !privateIds.has(r.id as string))
    .slice(0, limit)
    .map((r) => ({
      id: r.id as string,
      fullName: r.full_name as string,
      name: r.name as string,
      description: r.description as string | null,
      primaryLanguage: r.primary_language as string | null,
      topics: (r.topics ?? []) as string[],
      stars: r.stargazers_count as number,
      role: r.role as string,
      importance: r.importance_score as number,
      similarity: r.similarity as number,
    }));
}

async function searchPRs(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  queryEmbedding: number[],
  limit: number,
): Promise<GitHubPRResult[]> {
  const overFetch = Math.min(50, limit * 3);
  const { data } = await db.database.rpc("search_github_prs", {
    query_embedding: queryEmbedding,
    search_user_id: userId,
    match_count: overFetch,
  });

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  // Filter PRs whose parent repo is private.
  const repoNames = Array.from(new Set(rows.map((r) => r.repo_name as string)));
  const { data: privateRepos } = await db.database.from("github_memory_repos")
    .select("full_name")
    .eq("user_id", userId)
    .eq("is_private", true)
    .in("full_name", repoNames);
  const privateNames = new Set<string>(
    ((privateRepos ?? []) as { full_name: string }[]).map((v) => v.full_name),
  );

  return rows
    .filter((r) => !privateNames.has(r.repo_name as string))
    .slice(0, limit)
    .map((r) => ({
      id: r.id as string,
      repoName: r.repo_name as string,
      title: r.title as string,
      state: r.state as string,
      category: r.pr_category as string | null,
      importance: r.importance_score as number,
      createdAt: r.created_at_gh as string,
      similarity: r.similarity as number,
    }));
}

async function searchIssues(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  queryEmbedding: number[],
  limit: number,
): Promise<GitHubIssueResult[]> {
  const overFetch = Math.min(50, limit * 3);
  const { data } = await db.database.rpc("search_github_issues", {
    query_embedding: queryEmbedding,
    search_user_id: userId,
    match_count: overFetch,
  });

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const repoNames = Array.from(new Set(rows.map((r) => r.repo_name as string)));
  const { data: privateRepos } = await db.database.from("github_memory_repos")
    .select("full_name")
    .eq("user_id", userId)
    .eq("is_private", true)
    .in("full_name", repoNames);
  const privateNames = new Set<string>(
    ((privateRepos ?? []) as { full_name: string }[]).map((v) => v.full_name),
  );

  return rows
    .filter((r) => !privateNames.has(r.repo_name as string))
    .slice(0, limit)
    .map((r) => ({
      id: r.id as string,
      repoName: r.repo_name as string,
      title: r.title as string,
      state: r.state as string,
      issueType: r.issue_type as string | null,
      labels: (r.labels ?? []) as string[],
      importance: r.importance_score as number,
      createdAt: r.created_at_gh as string,
      similarity: r.similarity as number,
    }));
}

async function getExpertise(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<GitHubExpertise[]> {
  const { data } = await db.database.rpc("get_github_expertise", {
    p_user_id: userId,
    min_confidence: 0.2,
    max_results: 20,
  });

  return (data ?? []).map((r: Record<string, unknown>) => ({
    skill: r.skill as string,
    skillCategory: r.skill_category as GitHubExpertise["skillCategory"],
    confidence: r.confidence as number,
    evidenceRepos: r.evidence_repos as number,
    evidenceCommits: r.evidence_commits as number,
    evidencePrs: 0,
    totalLines: 0,
    yearsActive: r.years_active as number,
    firstSeenAt: null,
    lastSeenAt: r.last_seen_at as string | null,
  }));
}

async function getGraph(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  query: string,
): Promise<GitHubGraphEdge[]> {
  // Try to extract entity names from the query for targeted graph traversal
  const { data } = await db.database.rpc("get_github_graph", {
    p_user_id: userId,
    p_entity_name: null,
    p_relationship: null,
    max_results: 20,
  });

  return (data ?? []).map((r: Record<string, unknown>) => ({
    sourceType: r.source_type as string,
    sourceName: r.source_name as string,
    relationship: r.relationship as string,
    targetType: r.target_type as string,
    targetName: r.target_name as string,
    strength: r.strength as number,
    evidenceCount: r.evidence_count as number,
  }));
}

async function getStats(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<GitHubStats | null> {
  const [repoCount, commitCount, prCount, issueCount, expertise, oldestRepo] = await Promise.all([
    db.database.from("github_memory_repos").select("*", { count: "exact", head: true }).eq("user_id", userId),
    db.database.from("github_memory_commits").select("*", { count: "exact", head: true }).eq("user_id", userId),
    db.database.from("github_memory_prs").select("*", { count: "exact", head: true }).eq("user_id", userId),
    db.database.from("github_memory_issues").select("*", { count: "exact", head: true }).eq("user_id", userId),
    db.database.rpc("get_github_expertise", { p_user_id: userId, min_confidence: 0.3, max_results: 10 }),
    db.database.from("github_memory_repos").select("created_at_gh").eq("user_id", userId).order("created_at_gh", { ascending: true }).limit(1),
  ]);

  const topLangs = ((expertise.data ?? []) as { skill: string; skill_category: string }[])
    .filter((e) => e.skill_category === "language")
    .map((e) => e.skill)
    .slice(0, 8);

  const topExpertise = ((expertise.data ?? []) as { skill: string; confidence: number }[])
    .slice(0, 5)
    .map((e) => ({ skill: e.skill, confidence: e.confidence }));

  return {
    totalRepos: repoCount.count ?? 0,
    totalCommits: commitCount.count ?? 0,
    totalPRs: prCount.count ?? 0,
    totalIssues: issueCount.count ?? 0,
    topLanguages: topLangs,
    topExpertise,
    activeSince: (oldestRepo.data?.[0] as { created_at_gh: string } | undefined)?.created_at_gh ?? null,
  };
}

async function getNarrative(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ section: string; content: string }[]> {
  const { data } = await db.database.from("github_developer_narrative")
    .select("section, content")
    .eq("user_id", userId)
    .order("section", { ascending: true });

  return (data ?? []).map((r: Record<string, unknown>) => ({
    section: r.section as string,
    content: r.content as string,
  }));
}

async function getInsights(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  queryEmbedding: number[],
): Promise<{ type: string; insight: string; confidence: number }[]> {
  const { data } = await db.database.rpc("search_github_insights", {
    query_embedding: queryEmbedding,
    search_user_id: userId,
    match_count: 5,
  });

  return (data ?? []).map((r: Record<string, unknown>) => ({
    type: r.insight_type as string,
    insight: r.insight as string,
    confidence: r.confidence as number,
  }));
}
