/**
 * GitHub Memory Embedding Pipeline
 *
 * Embeds repos, PRs, issues into pgvector for semantic search.
 * Uses true batch embedding via Voyage AI's native batch API.
 *
 * Stale-vector detection (audit Finding 6.2): each row carries an
 * `embedding_input_hash` (SHA-256 of the text we fed into `embed()`).
 * A row needs re-embedding if its embedding column is null OR its
 * stored hash differs from the current text's hash. This ensures
 * that when the dream cycle later writes a `readme_summary` for a
 * repo whose embedding was already populated with empty source
 * text, the embedding gets refreshed.
 */

import { createHash } from "node:crypto";

import { updateJob } from "./ingestion";

import { createAdminClient } from "@/lib/insforge/admin";
import { embedBatchDirect } from "@/lib/memory/embeddings";

/** Max texts per single Voyage AI batch API call. */
const EMBED_BATCH = 20;

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Run the full embedding pipeline for a user's GitHub memory.
 * Processes: repos → PRs → issues (in priority order).
 */
export async function embedGitHubMemory(
  userId: string,
  jobId: string,
): Promise<{ totalEmbedded: number }> {
  let total = 0;

  total += await embedRepos(userId);
  total += await embedPRs(userId);
  total += await embedIssues(userId);

  await updateJob(jobId, { totalEmbeddings: total });
  return { totalEmbedded: total };
}

// ── Repos ──

async function embedRepos(userId: string): Promise<number> {
  const db = createAdminClient();
  let embedded = 0;

  // Fetch top-200 repos by importance. We fetch all and decide
  // per-row whether the embedding is missing or stale, since the
  // SDK lacks a "where embedding is null OR hash != x" predicate.
  const { data: repos } = await db.database.from("github_memory_repos")
    .select("id, full_name, name, description, primary_language, topics, readme_summary, embedding, embedding_input_hash")
    .eq("user_id", userId)
    .order("importance_score", { ascending: false })
    .limit(200);

  // Filter to rows needing (re-)embedding
  type RepoRow = Record<string, unknown>;
  const candidates: { row: RepoRow; text: string; hash: string }[] = [];
  for (const repo of (repos ?? []) as RepoRow[]) {
    const text = buildRepoEmbeddingText(repo as never);
    if (text.length < 10) continue;
    const hash = hashText(text);
    if (repo.embedding && repo.embedding_input_hash === hash) continue;
    candidates.push({ row: repo, text, hash });
  }

  // Process in batches — single API call per batch, parallel DB writes
  for (let i = 0; i < candidates.length; i += EMBED_BATCH) {
    const batch = candidates.slice(i, i + EMBED_BATCH);
    try {
      const texts = batch.map((c) => c.text);
      const vectors = await embedBatchDirect(texts);

      // Parallel DB writes for the entire batch
      await Promise.all(
        batch.map((c, j) =>
          db.database.from("github_memory_repos")
            .update({ embedding: vectors[j], embedding_input_hash: c.hash })
            .eq("id", c.row.id as string),
        ),
      );
      embedded += batch.length;
    } catch (err) {
      console.warn(
        `[gh-embed] Repo batch (${batch.length} items) failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return embedded;
}

// ── PRs ──

async function embedPRs(userId: string): Promise<number> {
  const db = createAdminClient();
  let embedded = 0;

  const { data: prs } = await db.database.from("github_memory_prs")
    .select("id, title, body_summary, state, pr_category, repo_id, embedding, embedding_input_hash")
    .eq("user_id", userId)
    .order("importance_score", { ascending: false })
    .limit(300);

  type PRRow = Record<string, unknown>;
  const candidates: { row: PRRow; text: string; hash: string }[] = [];
  for (const pr of (prs ?? []) as PRRow[]) {
    const text = buildPREmbeddingText(pr as never);
    if (text.length < 10) continue;
    const hash = hashText(text);
    if (pr.embedding && pr.embedding_input_hash === hash) continue;
    candidates.push({ row: pr, text, hash });
  }

  for (let i = 0; i < candidates.length; i += EMBED_BATCH) {
    const batch = candidates.slice(i, i + EMBED_BATCH);
    try {
      const texts = batch.map((c) => c.text);
      const vectors = await embedBatchDirect(texts);

      await Promise.all(
        batch.map((c, j) =>
          db.database.from("github_memory_prs")
            .update({ embedding: vectors[j], embedding_input_hash: c.hash })
            .eq("id", c.row.id as string),
        ),
      );
      embedded += batch.length;
    } catch (err) {
      console.warn(`[gh-embed] PR batch failed:`, err instanceof Error ? err.message : err);
    }
  }

  return embedded;
}

// ── Issues ──

async function embedIssues(userId: string): Promise<number> {
  const db = createAdminClient();
  let embedded = 0;

  const { data: issues } = await db.database.from("github_memory_issues")
    .select("id, title, body_summary, state, issue_type, labels, embedding, embedding_input_hash")
    .eq("user_id", userId)
    .order("importance_score", { ascending: false })
    .limit(300);

  type IssueRow = Record<string, unknown>;
  const candidates: { row: IssueRow; text: string; hash: string }[] = [];
  for (const issue of (issues ?? []) as IssueRow[]) {
    const text = buildIssueEmbeddingText(issue as never);
    if (text.length < 10) continue;
    const hash = hashText(text);
    if (issue.embedding && issue.embedding_input_hash === hash) continue;
    candidates.push({ row: issue, text, hash });
  }

  for (let i = 0; i < candidates.length; i += EMBED_BATCH) {
    const batch = candidates.slice(i, i + EMBED_BATCH);
    try {
      const texts = batch.map((c) => c.text);
      const vectors = await embedBatchDirect(texts);

      await Promise.all(
        batch.map((c, j) =>
          db.database.from("github_memory_issues")
            .update({ embedding: vectors[j], embedding_input_hash: c.hash })
            .eq("id", c.row.id as string),
        ),
      );
      embedded += batch.length;
    } catch (err) {
      console.warn(`[gh-embed] Issue batch failed:`, err instanceof Error ? err.message : err);
    }
  }

  return embedded;
}

// ── Text builders ──

function buildRepoEmbeddingText(repo: {
  full_name: string;
  name: string;
  description: string | null;
  primary_language: string | null;
  topics: string[];
  readme_summary: string | null;
}): string {
  const parts = [
    `Repository: ${repo.full_name}`,
    repo.description ? `Description: ${repo.description}` : null,
    repo.primary_language ? `Language: ${repo.primary_language}` : null,
    repo.topics?.length ? `Topics: ${repo.topics.join(", ")}` : null,
    repo.readme_summary ? `README: ${repo.readme_summary.slice(0, 500)}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}

function buildPREmbeddingText(pr: {
  title: string;
  body_summary: string | null;
  state: string;
  pr_category: string | null;
}): string {
  const parts = [
    `Pull Request: ${pr.title}`,
    pr.pr_category ? `Type: ${pr.pr_category}` : null,
    `Status: ${pr.state}`,
    pr.body_summary ? `Summary: ${pr.body_summary.slice(0, 400)}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}

function buildIssueEmbeddingText(issue: {
  title: string;
  body_summary: string | null;
  state: string;
  issue_type: string | null;
  labels: string[];
}): string {
  const parts = [
    `Issue: ${issue.title}`,
    issue.issue_type ? `Type: ${issue.issue_type}` : null,
    `Status: ${issue.state}`,
    issue.labels?.length ? `Labels: ${issue.labels.join(", ")}` : null,
    issue.body_summary ? `Description: ${issue.body_summary.slice(0, 400)}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}
