/**
 * GitHub Memory Dream Cycle — AI analysis layer
 *
 * Runs after ingestion to produce:
 * 1. README summaries for top repos
 * 2. Developer narrative (6 sections)
 * 3. AI-extracted insights (code patterns, growth areas, OSS readiness)
 *
 * Uses flash-lite model for cost efficiency (~$0.002 per full cycle).
 */

import { generateObject, generateText } from "ai";
import { z } from "zod";

import { fetchReadme, getGitHubToken } from "./github-client";

import { google, getDefaultPioneerModel } from "@/lib/ai/google-provider";
import { createAdminClient } from "@/lib/insforge/admin";
import { embed } from "@/lib/memory/embeddings";


function getModel() {
  return google();
}

// ── 1. README Summarization ──────────────────────────────────

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 2000;

/**
 * Generate summaries for ALL repos the user has — using README + full repo context.
 * Works even without a README by using commits, PRs, languages, topics, description.
 * Processes in batches of 10 with delay to respect rate limits.
 */
async function summarizeReadmes(userId: string): Promise<number> {
  const db = createAdminClient();
  const token = await getGitHubToken(userId);
  if (!token) return 0;

  // Get ALL repos without summaries (no limit)
  const { data: repos } = await db.database.from("github_memory_repos")
    .select("id, full_name, name, description, primary_language, languages, topics, stargazers_count, forks_count, size_kb, is_fork, is_archived, role, created_at_gh, pushed_at")
    .eq("user_id", userId)
    .is("readme_summary", null)
    .order("importance_score", { ascending: false });

  if (!repos || repos.length === 0) return 0;

  let summarized = 0;

  // Process in batches
  for (let i = 0; i < repos.length; i += BATCH_SIZE) {
    const batch = repos.slice(i, i + BATCH_SIZE);

    for (const repo of batch) {
      try {
        const summary = await summarizeSingleRepo(db, repo, userId, token);
        if (summary && summary.length > 10) {
          await db.database.from("github_memory_repos")
            .update({ readme_summary: summary.trim() })
            .eq("id", repo.id);
          summarized++;
        }
      } catch (err) {
        console.warn(`[gh-dream] Summarize failed for ${repo.full_name}:`, err instanceof Error ? err.message : err);
      }
    }

    // Delay between batches to avoid rate limits
    if (i + BATCH_SIZE < repos.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return summarized;
}

/**
 * Summarize a single repo using README + repo context.
 * If README is missing/short, falls back to repo metadata + commits + PRs.
 */
async function summarizeSingleRepo(
  db: ReturnType<typeof createAdminClient>,
  repo: Record<string, unknown>,
  userId: string,
  token: string,
): Promise<string | null> {
  const fullName = repo.full_name as string;
  const repoId = repo.id as string;

  // 1. Try fetching README
  let readme: string | null = null;
  try {
    readme = await fetchReadme(fullName, { token });
  } catch {
    // README fetch failed — proceed without it
  }

  // 2. Gather repo context from DB (commits, PRs, issues)
  const [commitsResult, prsResult] = await Promise.all([
    db.database.from("github_memory_commits")
      .select("message, commit_type, languages_touched")
      .eq("user_id", userId)
      .eq("repo_id", repoId)
      .order("authored_at", { ascending: false })
      .limit(15),
    db.database.from("github_memory_prs")
      .select("title, pr_category, state")
      .eq("user_id", userId)
      .eq("repo_id", repoId)
      .order("created_at_gh", { ascending: false })
      .limit(10),
  ]);

  const commits = commitsResult.data ?? [];
  const prs = prsResult.data ?? [];
  const languages = repo.languages as Record<string, number> | null;

  // 3. Build context sections
  const contextParts: string[] = [];

  contextParts.push(`Repository: ${fullName}`);
  contextParts.push(`Role: ${repo.role ?? "unknown"} | Fork: ${repo.is_fork ? "yes" : "no"} | Archived: ${repo.is_archived ? "yes" : "no"}`);
  contextParts.push(`Primary Language: ${(repo.primary_language as string) ?? "unknown"}`);

  if (languages && Object.keys(languages).length > 0) {
    const sortedLangs = Object.entries(languages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([lang, bytes]) => `${lang} (${Math.round(bytes / 1024)}KB)`)
      .join(", ");
    contextParts.push(`Languages: ${sortedLangs}`);
  }

  if (repo.description) contextParts.push(`Description: ${repo.description}`);

  const topics = repo.topics as string[] | null;
  if (topics && topics.length > 0) contextParts.push(`Topics: ${topics.join(", ")}`);

  contextParts.push(`Stars: ${repo.stargazers_count ?? 0} | Forks: ${repo.forks_count ?? 0} | Size: ${repo.size_kb ?? 0}KB`);
  contextParts.push(`Created: ${repo.created_at_gh ?? "unknown"} | Last push: ${repo.pushed_at ?? "unknown"}`);

  if (commits.length > 0) {
    const commitLines = commits.slice(0, 10).map((c: Record<string, unknown>) =>
      `- [${c.commit_type ?? "other"}] ${(c.message as string).split("\n")[0].slice(0, 100)}`,
    ).join("\n");
    contextParts.push(`\nRecent commits (${commits.length}):\n${commitLines}`);
  }

  if (prs.length > 0) {
    const prLines = prs.slice(0, 8).map((p: Record<string, unknown>) =>
      `- [${p.state}/${p.pr_category ?? "other"}] ${p.title}`,
    ).join("\n");
    contextParts.push(`\nRecent PRs (${prs.length}):\n${prLines}`);
  }

  const hasReadme = readme && readme.length >= 50;
  if (hasReadme) {
    contextParts.push(`\nREADME:\n${readme!.slice(0, 3000)}`);
  }

  // 4. Generate summary
  const prompt = hasReadme
    ? `Summarize this GitHub repository in 2-3 sentences based on its README and context. Focus on: what the project does, key technologies, and purpose.

${contextParts.join("\n")}`
    : `This repository has no README. Summarize what this project likely does based on its metadata, commit messages, PR titles, languages, and topics. Be specific but acknowledge uncertainty where needed. Write 2-3 sentences.

${contextParts.join("\n")}`;

  const { text } = await generateText({
    model: getModel(),
    prompt,
    maxOutputTokens: 180,
  });

  return text || null;
}

// ── 2. Developer Narrative ──────────────────────────────────

const NARRATIVE_SECTIONS = [
  "identity",
  "expertise",
  "contribution_style",
  "growth_trajectory",
  "interests",
  "contribution_readiness",
] as const;

const NarrativeSchema = z.object({
  identity: z.string().describe("1-2 sentence developer identity: role, seniority level, primary stack. E.g. 'Mid-senior full-stack engineer specializing in TypeScript and React, with 3.5 years of active development.'"),
  expertise: z.string().describe("Key technical strengths with evidence. E.g. 'Strong in authentication systems (4 repos with auth modules), testing (85% of PRs include tests), and API design.'"),
  contribution_style: z.string().describe("How the developer works: PR size, testing habits, commit patterns. E.g. 'Prefers small focused PRs (avg 120 lines), includes tests consistently, ships in 2-3 commits per feature.'"),
  growth_trajectory: z.string().describe("Career/skill evolution over time. E.g. 'Transitioned from Python/Django backend to full-stack TypeScript/Next.js in 2024. Recently exploring Rust.'"),
  interests: z.string().describe("What topics/domains they gravitate toward. E.g. 'Interested in developer tooling, open-source infrastructure, and AI-powered applications.'"),
  contribution_readiness: z.string().describe("What open source issues this developer is ready for. E.g. 'Ready for medium-difficulty TypeScript/React issues. Could handle auth-related bugs in any framework. Too early for Rust contributions.'"),
});

/**
 * Generate a 6-section developer narrative from GitHub data.
 * Single LLM call using structured output.
 */
async function generateDeveloperNarrative(userId: string): Promise<number> {
  const db = createAdminClient();

  // Gather data for the prompt
  const [reposResult, expertiseResult, prsResult, commitsResult, graphResult] = await Promise.all([
    db.database.from("github_memory_repos")
      .select("full_name, name, description, primary_language, topics, stargazers_count, role, is_fork, readme_summary, pushed_at, created_at_gh")
      .eq("user_id", userId)
      .order("importance_score", { ascending: false })
      .limit(30),
    db.database.from("github_memory_expertise")
      .select("skill, skill_category, confidence, evidence_repos, evidence_commits, years_active")
      .eq("user_id", userId)
      .order("confidence", { ascending: false })
      .limit(20),
    db.database.from("github_memory_prs")
      .select("title, state, is_author, additions, deletions, pr_category, merge_latency_hours, created_at_gh")
      .eq("user_id", userId)
      .order("created_at_gh", { ascending: false })
      .limit(50),
    db.database.from("github_memory_commits")
      .select("commit_type, languages_touched, additions, deletions, authored_at")
      .eq("user_id", userId)
      .order("authored_at", { ascending: false })
      .limit(100),
    db.database.from("github_memory_graph")
      .select("source_name, relationship, target_name, strength")
      .eq("user_id", userId)
      .order("strength", { ascending: false })
      .limit(30),
  ]);

  const repos = reposResult.data ?? [];
  const expertise = expertiseResult.data ?? [];
  const prs = prsResult.data ?? [];
  const commits = commitsResult.data ?? [];
  const graph = graphResult.data ?? [];

  if (repos.length === 0) return 0;

  // Build compact data summary for the prompt
  const repoSummary = repos.slice(0, 15).map((r) => {
    const lang = r.primary_language ? ` [${r.primary_language}]` : "";
    const stars = r.stargazers_count > 0 ? ` ⭐${r.stargazers_count}` : "";
    const summary = r.readme_summary ? ` — ${r.readme_summary.slice(0, 100)}` : r.description ? ` — ${r.description.slice(0, 80)}` : "";
    return `${r.full_name}${lang}${stars} (${r.role})${summary}`;
  }).join("\n");

  const expertiseSummary = expertise.map((e) =>
    `${e.skill} (${e.skill_category}): ${Math.round(e.confidence * 100)}% conf, ${e.evidence_repos} repos, ${e.years_active}y`,
  ).join("\n");

  // PR stats
  const authoredPRs = prs.filter((p) => p.is_author);
  const mergedPRs = authoredPRs.filter((p) => p.state === "merged");
  const avgMergeTime = mergedPRs.length > 0
    ? (mergedPRs.reduce((s, p) => s + (p.merge_latency_hours ?? 0), 0) / mergedPRs.length).toFixed(1)
    : "N/A";
  const avgPRSize = authoredPRs.length > 0
    ? Math.round(authoredPRs.reduce((s, p) => s + p.additions + p.deletions, 0) / authoredPRs.length)
    : 0;
  const prCategories = authoredPRs.reduce((acc, p) => {
    const cat = p.pr_category ?? "other";
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Commit type breakdown
  const commitTypes = commits.reduce((acc, c) => {
    const t = c.commit_type ?? "other";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const graphSummary = graph.slice(0, 15).map((g) =>
    `${g.source_name} —[${g.relationship}]→ ${g.target_name}`,
  ).join("\n");

  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: NarrativeSchema,
      prompt: `Analyze this developer's GitHub history and generate a 6-section narrative profile.

Be specific — cite repos, technologies, and numbers. Don't be generic.
If data is limited, say so honestly rather than guessing.

=== REPOSITORIES (${repos.length} total) ===
${repoSummary}

=== EXPERTISE ===
${expertiseSummary || "No expertise data yet"}

=== PR ACTIVITY (${authoredPRs.length} authored, ${mergedPRs.length} merged) ===
Avg merge time: ${avgMergeTime}h | Avg PR size: ${avgPRSize} lines
PR categories: ${JSON.stringify(prCategories)}

=== COMMIT PATTERNS (${commits.length} recent) ===
Types: ${JSON.stringify(commitTypes)}

=== KNOWLEDGE GRAPH ===
${graphSummary || "No graph data"}

=== TIMELINE ===
Oldest repo: ${repos[repos.length - 1]?.created_at_gh ?? "unknown"}
Most recent push: ${repos[0]?.pushed_at ?? "unknown"}`,
      maxOutputTokens: 1024,
    });

    // Store each section
    let stored = 0;
    const modelName = process.env.PIONEER_MODEL || getDefaultPioneerModel();
    for (const section of NARRATIVE_SECTIONS) {
      const content = object[section];
      if (!content || content.length < 10) continue;

      await db.database.from("github_developer_narrative").upsert({
        user_id: userId,
        section,
        content,
        generated_at: new Date().toISOString(),
        model_used: modelName,
      }, { onConflict: "user_id,section" });
      stored++;
    }

    return stored;
  } catch (err) {
    console.error("[gh-dream] Narrative generation failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

// ── 3. AI Insights Extraction ───────────────────────────────

const InsightsSchema = z.object({
  insights: z.array(z.object({
    type: z.enum(["code_pattern", "domain_expertise", "collaboration_style", "quality_signal", "growth_area", "oss_readiness"]),
    insight: z.string().describe("One specific, actionable insight. Max 1 sentence."),
    confidence: z.number().min(0).max(1).describe("How confident in this insight based on evidence"),
    evidence: z.string().describe("Brief citation of supporting data"),
  })).describe("5-12 specific insights about this developer"),
});

/**
 * Extract deeper insights that rule-based analysis can't catch.
 * These get embedded for semantic search during retrieval.
 */
async function extractInsights(userId: string): Promise<number> {
  const db = createAdminClient();

  // Get narrative + expertise for analysis
  const [narrativeResult, expertiseResult, reposResult] = await Promise.all([
    db.database.from("github_developer_narrative").select("section, content").eq("user_id", userId),
    db.database.from("github_memory_expertise").select("skill, skill_category, confidence, evidence_repos, years_active").eq("user_id", userId).order("confidence", { ascending: false }).limit(15),
    db.database.from("github_memory_repos").select("full_name, primary_language, topics, stargazers_count, role, readme_summary").eq("user_id", userId).order("importance_score", { ascending: false }).limit(20),
  ]);

  const narrative = (narrativeResult.data ?? []).map((n) => `${n.section}: ${n.content}`).join("\n\n");
  const expertise = (expertiseResult.data ?? []).map((e) => `${e.skill} (${e.skill_category}): ${Math.round(e.confidence * 100)}%, ${e.evidence_repos} repos, ${e.years_active}y`).join("\n");
  const repos = (reposResult.data ?? []).map((r) => `${r.full_name} [${r.primary_language ?? "?"}] ${r.role} ${r.readme_summary?.slice(0, 80) ?? r.topics?.join(", ") ?? ""}`).join("\n");

  if (!narrative && !expertise) return 0;

  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: InsightsSchema,
      prompt: `Analyze this developer's GitHub profile and extract specific, non-obvious insights.

Focus on things that RULES can't detect:
- Code patterns (functional vs OOP, testing habits, documentation quality)
- Domain expertise (auth, payments, infra, ML, etc.)
- Collaboration style (PR turnaround, review quality, mentoring)
- Quality signals (test coverage, CI/CD, code review)
- Growth areas (new technologies being explored)
- OSS readiness (what difficulty/type of issues they can handle)

Be specific. Don't just restate the data — infer what it means.

=== NARRATIVE ===
${narrative || "Not yet generated"}

=== EXPERTISE ===
${expertise || "None"}

=== TOP REPOS ===
${repos || "None"}`,
      maxOutputTokens: 1024,
    });

    let stored = 0;
    for (const insight of object.insights) {
      // Embed the insight for semantic search
      const insightText = `${insight.type}: ${insight.insight}`;
      const vector = await embed(insightText).catch(() => null);

      await db.database.from("github_memory_insights").upsert({
        user_id: userId,
        insight_type: insight.type,
        insight: insight.insight,
        confidence: insight.confidence,
        evidence: insight.evidence,
        embedding: vector,
      }, { onConflict: "user_id,insight_type,insight" });
      stored++;
    }

    return stored;
  } catch (err) {
    console.error("[gh-dream] Insight extraction failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

// ── Full Dream Cycle ────────────────────────────────────────

export interface GitHubDreamCycleResult {
  readmesSummarized: number;
  narrativeSections: number;
  insightsExtracted: number;
  durationMs: number;
}

/**
 * Run the complete GitHub Dream Cycle.
 * Called after ingestion completes and after daily sync.
 *
 * Cost: ~3 LLM calls (flash-lite) = ~$0.002 per run
 */
export async function runGitHubDreamCycle(userId: string): Promise<GitHubDreamCycleResult> {
  const start = Date.now();

  // Step 1: Summarize READMEs (1 LLM call per repo, up to 30)
  const readmesSummarized = await summarizeReadmes(userId);

  // Step 2: Generate developer narrative (1 LLM call)
  const narrativeSections = await generateDeveloperNarrative(userId);

  // Step 3: Extract insights (1 LLM call + embeddings)
  const insightsExtracted = await extractInsights(userId);

  return {
    readmesSummarized,
    narrativeSections,
    insightsExtracted,
    durationMs: Date.now() - start,
  };
}
