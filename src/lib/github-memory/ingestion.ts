/**
 * GitHub Memory Ingestion Pipeline — Fault-tolerant, resumable, checkpoint-based.
 *
 * Flow: repos → commits → PRs → issues → contributions → collaborators → graph → expertise → embeddings
 * Each stage is independently resumable via checkpoint state.
 */


import {
  fetchRepoCommits,
  fetchRepoIssues,
  fetchRepoLanguages,
  fetchRepoPRs,
  fetchStarredRepos,
  fetchUserEvents,
  fetchUserOrgs,
  fetchUserRepos,
  getGitHubToken,
  getGitHubUsername,
} from "./github-client";
import type {
  GHCommit,
  GHIssue,
  GHPullRequest,
  GHRepo,
  IngestionCheckpoint,
  IngestionJob,
  IngestionStage,
} from "./types";

import { createAdminClient } from "@/lib/insforge/admin";

/** Max repos to fetch concurrently. Stays well under GitHub's abuse-detection threshold. */
const REPO_FETCH_CONCURRENCY = 5;

/** Max rows to upsert in a single database call (SDK/PostgREST limit). */
const BULK_UPSERT_BATCH = 500;

// ── Job management ──

export async function createIngestionJob(userId: string): Promise<string | null> {
  const db = createAdminClient();
  const username = await getGitHubUsername(userId);
  if (!username) return null;

  // Check for existing active job
  const { data: existing } = await db.database.from("github_ingestion_jobs")
    .select("id, status")
    .eq("user_id", userId)
    .in("status", ["queued", "scanning", "retrying", "rate_limited"])
    .maybeSingle();

  if (existing) return existing.id;

  const { data } = await db.database.from("github_ingestion_jobs")
    .insert({
      user_id: userId,
      github_username: username,
      status: "queued",
      checkpoint: {},
    })
    .select("id")
    .single();

  return data?.id ?? null;
}

export async function getJob(jobId: string): Promise<IngestionJob | null> {
  const db = createAdminClient();
  const { data } = await db.database.from("github_ingestion_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (!data) return null;
  return mapJob(data);
}

export async function updateJob(
  jobId: string,
  update: Partial<{
    status: string;
    checkpoint: IngestionCheckpoint;
    completedStages: IngestionStage[];
    lastError: string | null;
    lastErrorAt: string | null;
    nextRetryAt: string | null;
    retryCount: number;
    reposProcessed: number;
    commitsProcessed: number;
    prsProcessed: number;
    issuesProcessed: number;
    totalEntities: number;
    totalEmbeddings: number;
    startedAt: string;
    completedAt: string;
  }>,
): Promise<void> {
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() };
  if (update.status) row.status = update.status;
  if (update.checkpoint) row.checkpoint = update.checkpoint;
  if (update.completedStages) row.completed_stages = update.completedStages;
  if (update.lastError !== undefined) row.last_error = update.lastError;
  if (update.lastErrorAt !== undefined) row.last_error_at = update.lastErrorAt;
  if (update.nextRetryAt !== undefined) row.next_retry_at = update.nextRetryAt;
  if (update.retryCount !== undefined) row.retry_count = update.retryCount;
  if (update.reposProcessed !== undefined) row.repos_processed = update.reposProcessed;
  if (update.commitsProcessed !== undefined) row.commits_processed = update.commitsProcessed;
  if (update.prsProcessed !== undefined) row.prs_processed = update.prsProcessed;
  if (update.issuesProcessed !== undefined) row.issues_processed = update.issuesProcessed;
  if (update.totalEntities !== undefined) row.total_entities = update.totalEntities;
  if (update.totalEmbeddings !== undefined) row.total_embeddings = update.totalEmbeddings;
  if (update.startedAt) row.started_at = update.startedAt;
  if (update.completedAt) row.completed_at = update.completedAt;

  await db.database.from("github_ingestion_jobs").update(row).eq("id", jobId);
}

// ── Main pipeline ──

/**
 * Sentinel errors thrown by `runIngestion` to communicate intent to
 * the surrounding Upstash Workflow `serve()` handler.
 *
 * Why throw at all? `runIngestion` used to silently `return` on rate-
 * limit and retryable errors after persisting `status='rate_limited'`
 * or `'retrying'`. The caller would then enter the next stage which
 * re-flipped status to `'scanning'` via the `await updateJob({status:
 * 'scanning'})` at the top of the next call — orphaning the job
 * (audit Finding 3.4). Throwing forces `serve()` to surface the
 * failure (recorded in the QStash run history) and stops the
 * workflow chain immediately.
 */
export class IngestionRateLimited extends Error {
  constructor(public retryAt: string) {
    super(`GitHub rate-limited; retry at ${retryAt}`);
    this.name = "IngestionRateLimited";
  }
}
export class IngestionRetryable extends Error {
  constructor(message: string, public retryAt: string, public retryCount: number) {
    super(message);
    this.name = "IngestionRetryable";
  }
}
export class IngestionCancelled extends Error {
  constructor(reason: string) {
    super(`Ingestion cancelled: ${reason}`);
    this.name = "IngestionCancelled";
  }
}

/**
 * Read the user's `connected_apps.last_connected_at` for github.
 * Returns null when no active connection exists. The reconnect-race
 * barrier (audit Finding 6.1) snapshots this at job start and
 * re-reads it at every checkpoint boundary; a change means the user
 * disconnected-then-reconnected mid-run, so the in-flight job aborts.
 */
async function readConnectionBarrier(userId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db.database.from("connected_apps")
    .select("status, last_connected_at")
    .eq("user_id", userId)
    .eq("provider", "github")
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  return (data.last_connected_at as string | null) ?? null;
}

/**
 * Re-fetch the current job and barrier values; throw `IngestionCancelled`
 * if the user has disconnected, reconnected, or the job was cancelled
 * out-of-band (e.g. by `disconnectApp`). Called at every stage boundary
 * so writes done within a stage at least see a consistent post-snapshot
 * state.
 */
async function assertNotCancelled(
  jobId: string,
  userId: string,
  initialBarrier: string | null,
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new IngestionCancelled("job row no longer exists");
  if (job.status === "cancelled") {
    throw new IngestionCancelled("job status flipped to cancelled");
  }
  const barrier = await readConnectionBarrier(userId);
  if (barrier === null) {
    throw new IngestionCancelled("github connection no longer active");
  }
  if (initialBarrier && barrier !== initialBarrier) {
    throw new IngestionCancelled(
      `connection bumped (last_connected_at ${initialBarrier} → ${barrier})`,
    );
  }
}

export async function runIngestion(
  jobId: string,
  allowedStages?: IngestionStage[],
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === "cancelled") {
    // Already cancelled out-of-band (e.g. user disconnected). No-op.
    return;
  }

  const token = await getGitHubToken(job.userId);
  if (!token) {
    await updateJob(jobId, { status: "failed", lastError: "No GitHub token found" });
    return;
  }

  // Snapshot the reconnect barrier (audit Finding 6.1).
  const initialBarrier = await readConnectionBarrier(job.userId);
  if (initialBarrier === null) {
    await updateJob(jobId, {
      status: "cancelled",
      lastError: "github connection not active at job start",
      lastErrorAt: new Date().toISOString(),
    });
    return;
  }

  const opts = { token };
  const username = job.githubUsername;

  // Only flip 'scanning' if the job isn't already in a terminal-ish
  // state. Skipping this when we're called from the retry workflow
  // and the previous run left it in 'retrying' / 'rate_limited' was
  // the bug behind Finding 3.4.
  if (job.status === "queued" || job.status === "scanning") {
    await updateJob(jobId, { status: "scanning", startedAt: new Date().toISOString() });
  }

  const stages: IngestionStage[] = [
    "repos", "commits", "prs", "issues", "contributions", "collaborators", "graph", "expertise",
  ];

  const stagesToRun = allowedStages || stages;

  // Resume from checkpoint
  const completedStages = new Set(job.completedStages);
  const checkpoint: IngestionCheckpoint = { ...job.checkpoint };

  for (const stage of stagesToRun) {
    if (completedStages.has(stage)) continue;

    // Reconnect-race + cancel barrier — checked before each stage so
    // a disconnect during a long stage at least stops the next one.
    try {
      await assertNotCancelled(jobId, job.userId, initialBarrier);
    } catch (err) {
      if (err instanceof IngestionCancelled) {
        await updateJob(jobId, {
          status: "cancelled",
          lastError: err.message,
          lastErrorAt: new Date().toISOString(),
          checkpoint,
          completedStages: [...completedStages],
        });
        return; // cancelled is terminal — don't throw, just stop quietly
      }
      throw err;
    }

    try {
      checkpoint.currentStage = stage;
      await updateJob(jobId, { checkpoint });

      switch (stage) {
        case "repos":
          await ingestRepos(job.userId, username, opts, jobId, checkpoint);
          break;
        case "commits":
          await ingestCommits(job.userId, username, opts, jobId, checkpoint);
          break;
        case "prs":
          await ingestPRs(job.userId, username, opts, jobId, checkpoint);
          break;
        case "issues":
          await ingestIssues(job.userId, username, opts, jobId, checkpoint);
          break;
        case "contributions":
          await ingestContributions(job.userId, username, opts, jobId);
          break;
        case "collaborators":
          await ingestCollaborators(job.userId, opts, jobId);
          break;
        case "graph":
          await buildGraph(job.userId, jobId);
          break;
        case "expertise":
          await inferExpertise(job.userId, jobId);
          break;
      }

      completedStages.add(stage);
      await updateJob(jobId, {
        checkpoint: { ...checkpoint, [stage]: { done: true } },
        completedStages: [...completedStages],
      });
    } catch (err) {
      if (err instanceof IngestionCancelled) {
        // Re-emit at top level so `serve()` records the cancellation.
        throw err;
      }
      const error = err instanceof Error ? err.message : String(err);
      const isRateLimit = error.includes("403") || error.toLowerCase().includes("rate limit");

      if (isRateLimit) {
        const retryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
        await updateJob(jobId, {
          status: "rate_limited",
          lastError: error,
          lastErrorAt: new Date().toISOString(),
          nextRetryAt: retryAt,
          checkpoint,
          completedStages: [...completedStages],
        });
        // THROW (audit Finding 3.4) — was `return`. The previous
        // silent return let downstream `context.run` steps overwrite
        // status='rate_limited' with 'scanning' on their next entry.
        throw new IngestionRateLimited(retryAt);
      }

      const retryCount = job.retryCount + 1;
      if (retryCount > job.maxRetries) {
        await updateJob(jobId, {
          status: "failed",
          lastError: error,
          lastErrorAt: new Date().toISOString(),
          retryCount,
          checkpoint,
          completedStages: [...completedStages],
        });
        // 'failed' is terminal, no throw — workflow can continue to
        // notify the user and stop.
        return;
      }

      // Exponential backoff: 5min, 15min, 45min, 2h, 6h
      const backoffMs = Math.min(5 * 60 * 1000 * Math.pow(3, retryCount - 1), 6 * 60 * 60 * 1000);
      const retryAt = new Date(Date.now() + backoffMs).toISOString();
      await updateJob(jobId, {
        status: "retrying",
        lastError: error,
        lastErrorAt: new Date().toISOString(),
        nextRetryAt: retryAt,
        retryCount,
        checkpoint,
        completedStages: [...completedStages],
      });
      throw new IngestionRetryable(error, retryAt, retryCount);
    }
  }

  const allStagesDone = stages.every((s) => completedStages.has(s));
  await updateJob(jobId, {
    status: allStagesDone ? "completed" : "scanning",
    completedAt: allStagesDone ? new Date().toISOString() : undefined,
    completedStages: [...completedStages],
  });
}

// ── Stage: Repos ──

async function ingestRepos(
  userId: string,
  username: string,
  opts: { token: string },
  jobId: string,
  checkpoint: IngestionCheckpoint,
): Promise<void> {
  const db = createAdminClient();

  // Fetch all repos
  const repos = await fetchUserRepos(opts);

  // Also fetch starred repos for "interested_in" intelligence
  const starred = await fetchStarredRepos({ ...opts, maxPages: 3 });

  // Parallel language fetching — batches of REPO_FETCH_CONCURRENCY
  const langMap = new Map<number, Record<string, number>>();
  const langRepos = repos.slice(0, 50);
  for (let i = 0; i < langRepos.length; i += REPO_FETCH_CONCURRENCY) {
    const batch = langRepos.slice(i, i + REPO_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) => fetchRepoLanguages(r.full_name, opts).catch(() => ({}))),
    );
    batch.forEach((r, j) => langMap.set(r.id, results[j]));
  }

  // Build all repo rows
  const repoRows = repos.map((repo) => {
    let role: "owner" | "contributor" | "member" | "forked" = "owner";
    if (repo.fork) role = "forked";
    else if (repo.owner.login !== username) role = "member";

    return {
      user_id: userId,
      github_id: repo.id,
      full_name: repo.full_name,
      name: repo.name,
      description: repo.description,
      html_url: repo.html_url,
      is_fork: repo.fork,
      is_archived: repo.archived,
      is_private: repo.private,
      owner_login: repo.owner.login,
      role,
      primary_language: repo.language,
      languages: langMap.get(repo.id) ?? {},
      topics: repo.topics || [],
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      open_issues_count: repo.open_issues_count,
      size_kb: repo.size,
      default_branch: repo.default_branch,
      pushed_at: repo.pushed_at,
      created_at_gh: repo.created_at,
      updated_at_gh: repo.updated_at,
      importance_score: computeRepoImportance(repo, role),
      last_synced_at: new Date().toISOString(),
    };
  });

  // Bulk upsert all repos
  await bulkUpsert(db, "github_memory_repos", repoRows, "user_id,github_id");

  // Starred repos that aren't user's own repos — for interest tracking
  const ownRepoIds = new Set(repos.map((r) => r.id));
  const starredRows = starred
    .filter((repo) => !ownRepoIds.has(repo.id))
    .map((repo) => ({
      user_id: userId,
      github_id: repo.id,
      full_name: repo.full_name,
      name: repo.name,
      description: repo.description,
      html_url: repo.html_url,
      is_fork: repo.fork,
      is_archived: repo.archived,
      is_private: repo.private,
      owner_login: repo.owner.login,
      role: "contributor" as const,
      primary_language: repo.language,
      languages: {},
      topics: repo.topics || [],
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      open_issues_count: repo.open_issues_count,
      size_kb: repo.size,
      default_branch: repo.default_branch,
      pushed_at: repo.pushed_at,
      created_at_gh: repo.created_at,
      updated_at_gh: repo.updated_at,
      importance_score: 0.2,
      last_synced_at: new Date().toISOString(),
    }));

  if (starredRows.length > 0) {
    await bulkUpsert(db, "github_memory_repos", starredRows, "user_id,github_id");
  }

  await updateJob(jobId, { reposProcessed: repos.length });
}

// ── Stage: Commits ──

async function ingestCommits(
  userId: string,
  username: string,
  opts: { token: string },
  jobId: string,
  checkpoint: IngestionCheckpoint,
): Promise<void> {
  const db = createAdminClient();
  const repos = await getStoredRepos(userId, 50); // top 50 by importance
  let totalCommits = 0;

  const startIndex = checkpoint.commits?.repoIndex ?? 0;

  // Process repos in parallel batches of REPO_FETCH_CONCURRENCY
  for (let i = startIndex; i < repos.length; i += REPO_FETCH_CONCURRENCY) {
    const batch = repos.slice(i, Math.min(i + REPO_FETCH_CONCURRENCY, repos.length));
    const batchResults = await Promise.all(
      batch.map((repo) =>
        fetchRepoCommits(repo.full_name, username, { ...opts, maxPages: 5 })
          .catch(() => [] as GHCommit[])
          .then((commits) => ({ repo, commits })),
      ),
    );

    for (const { repo, commits } of batchResults) {
      if (commits.length === 0) continue;

      const rows = commits.map((commit) => ({
        user_id: userId,
        repo_id: repo.id,
        sha: commit.sha,
        message: commit.commit.message.slice(0, 500),
        authored_at: commit.commit.author.date,
        additions: commit.stats?.additions ?? 0,
        deletions: commit.stats?.deletions ?? 0,
        files_changed: commit.files?.length ?? 0,
        commit_type: inferCommitType(commit.commit.message),
        languages_touched: extractLanguagesFromFiles(commit.files),
      }));

      // Bulk upsert — 1 DB call per repo instead of N
      await bulkUpsert(db, "github_memory_commits", rows, "user_id,sha");
      totalCommits += commits.length;
    }

    // Checkpoint after each batch of repos
    checkpoint.commits = { repoIndex: Math.min(i + REPO_FETCH_CONCURRENCY, repos.length), page: 0, done: false };
    await updateJob(jobId, { checkpoint, commitsProcessed: totalCommits });
  }
}

// ── Stage: PRs ──

async function ingestPRs(
  userId: string,
  username: string,
  opts: { token: string },
  jobId: string,
  checkpoint: IngestionCheckpoint,
): Promise<void> {
  const db = createAdminClient();
  const repos = await getStoredRepos(userId, 50);
  let totalPRs = 0;
  const startIndex = checkpoint.prs?.repoIndex ?? 0;

  // Process repos in parallel batches
  for (let i = startIndex; i < repos.length; i += REPO_FETCH_CONCURRENCY) {
    const batch = repos.slice(i, Math.min(i + REPO_FETCH_CONCURRENCY, repos.length));
    const batchResults = await Promise.all(
      batch.map((repo) =>
        fetchRepoPRs(repo.full_name, { ...opts, maxPages: 5 })
          .catch(() => [] as GHPullRequest[])
          .then((prs) => ({ repo, prs })),
      ),
    );

    // Collect collaborators to upsert later (still sequential — few items)
    for (const { repo, prs } of batchResults) {
      if (prs.length === 0) continue;

      const rows = prs.map((pr) => {
        const isAuthor = pr.user.login === username;
        const state = pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "open";
        const mergeLatency = pr.merged_at && pr.created_at
          ? (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / 3600000
          : null;

        return {
          user_id: userId,
          repo_id: repo.id,
          github_number: pr.number,
          title: pr.title,
          body_summary: pr.body?.slice(0, 500) ?? null,
          state,
          is_author: isAuthor,
          additions: pr.additions,
          deletions: pr.deletions,
          files_changed: pr.changed_files,
          comments_count: pr.comments,
          review_comments_count: pr.review_comments,
          commits_count: pr.commits,
          created_at_gh: pr.created_at,
          merged_at: pr.merged_at,
          closed_at: pr.closed_at,
          merge_latency_hours: mergeLatency,
          pr_category: inferPRCategory(pr.title, pr.labels.map((l) => l.name)),
          importance_score: computePRImportance(pr, isAuthor),
        };
      });

      // Bulk upsert all PRs for this repo
      await bulkUpsert(db, "github_memory_prs", rows, "user_id,repo_id,github_number");

      // Track collaborators: non-authored PRs (few items, keep sequential)
      for (const pr of prs) {
        if (pr.user.login !== username) {
          await upsertCollaborator(db, userId, pr.user.login, repo.full_name, "pr_author");
        }
      }

      totalPRs += prs.length;
    }

    checkpoint.prs = { repoIndex: Math.min(i + REPO_FETCH_CONCURRENCY, repos.length), page: 0, done: false };
    await updateJob(jobId, { checkpoint, prsProcessed: totalPRs });
  }
}

// ── Stage: Issues ──

async function ingestIssues(
  userId: string,
  username: string,
  opts: { token: string },
  jobId: string,
  checkpoint: IngestionCheckpoint,
): Promise<void> {
  const db = createAdminClient();
  const repos = await getStoredRepos(userId, 40);
  let totalIssues = 0;
  const startIndex = checkpoint.issues?.repoIndex ?? 0;

  // Process repos in parallel batches
  for (let i = startIndex; i < repos.length; i += REPO_FETCH_CONCURRENCY) {
    const batch = repos.slice(i, Math.min(i + REPO_FETCH_CONCURRENCY, repos.length));
    const batchResults = await Promise.all(
      batch.map((repo) =>
        fetchRepoIssues(repo.full_name, { ...opts, maxPages: 3 })
          .catch(() => [] as GHIssue[])
          .then((issues) => ({ repo, issues })),
      ),
    );

    for (const { repo, issues } of batchResults) {
      if (issues.length === 0) continue;

      const rows = issues.map((issue) => {
        const isAuthor = issue.user.login === username;
        const resolutionHours = issue.closed_at && issue.created_at
          ? (new Date(issue.closed_at).getTime() - new Date(issue.created_at).getTime()) / 3600000
          : null;

        return {
          user_id: userId,
          repo_id: repo.id,
          github_number: issue.number,
          title: issue.title,
          body_summary: issue.body?.slice(0, 500) ?? null,
          state: issue.state as "open" | "closed",
          is_author: isAuthor,
          labels: issue.labels.map((l) => l.name),
          assignees: issue.assignees.map((a) => a.login),
          comments_count: issue.comments,
          created_at_gh: issue.created_at,
          closed_at: issue.closed_at,
          resolution_hours: resolutionHours,
          issue_type: inferIssueType(issue.title, issue.labels.map((l) => l.name)),
        };
      });

      // Bulk upsert all issues for this repo
      await bulkUpsert(db, "github_memory_issues", rows, "user_id,repo_id,github_number");
      totalIssues += issues.length;
    }

    checkpoint.issues = { repoIndex: Math.min(i + REPO_FETCH_CONCURRENCY, repos.length), page: 0, done: false };
    await updateJob(jobId, { checkpoint, issuesProcessed: totalIssues });
  }
}

// ── Stage: Contributions ──

async function ingestContributions(
  userId: string,
  username: string,
  opts: { token: string },
  jobId: string,
): Promise<void> {
  const db = createAdminClient();
  const events = await fetchUserEvents(username, { ...opts, maxPages: 3 });

  // Aggregate by date
  const byDate = new Map<string, {
    commits: number; prsOpened: number; prsMerged: number;
    issuesOpened: number; reviews: number;
    repos: Set<string>; langs: Set<string>;
  }>();

  for (const event of events) {
    const date = event.created_at.split("T")[0];
    if (!byDate.has(date)) {
      byDate.set(date, {
        commits: 0, prsOpened: 0, prsMerged: 0,
        issuesOpened: 0, reviews: 0,
        repos: new Set(), langs: new Set(),
      });
    }
    const day = byDate.get(date)!;
    day.repos.add(event.repo.name);

    switch (event.type) {
      case "PushEvent": day.commits++; break;
      case "PullRequestEvent": day.prsOpened++; break;
      case "IssuesEvent": day.issuesOpened++; break;
      case "PullRequestReviewEvent": day.reviews++; break;
    }
  }

  // Bulk upsert all contribution rows at once
  const rows = [...byDate].map(([date, day]) => ({
    user_id: userId,
    contribution_date: date,
    commits_count: day.commits,
    prs_opened: day.prsOpened,
    prs_merged: day.prsMerged,
    issues_opened: day.issuesOpened,
    reviews_given: day.reviews,
    active_repos: [...day.repos],
    primary_languages: [...day.langs],
  }));

  if (rows.length > 0) {
    await bulkUpsert(db, "github_memory_contributions", rows, "user_id,contribution_date");
  }
}

// ── Stage: Collaborators ──

async function ingestCollaborators(
  userId: string,
  opts: { token: string },
  jobId: string,
): Promise<void> {
  const db = createAdminClient();
  const orgs = await fetchUserOrgs(opts).catch(() => []);

  for (const org of orgs) {
    // Track org membership in graph
    await db.database.from("github_memory_graph").upsert({
      user_id: userId,
      source_type: "user",
      source_name: (await getGitHubUsername(userId)) ?? "unknown",
      relationship: "member_of",
      target_type: "organization",
      target_name: org.login,
      strength: 0.8,
      evidence_count: 1,
    }, { onConflict: "user_id,source_type,source_name,relationship,target_type,target_name" }).then(() => null, () => null);
  }
}

// ── Stage: Graph ──

async function buildGraph(userId: string, jobId: string): Promise<void> {
  const db = createAdminClient();
  const repos = await getStoredRepos(userId, 100);
  const username = (await getGitHubUsername(userId)) ?? "unknown";

  // Accumulate all graph edges, then bulk upsert
  const edgeRows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  for (const repo of repos) {
    // User → contributed_to → Repo
    if (repo.role === "owner" || repo.role === "contributor") {
      edgeRows.push({
        user_id: userId, source_type: "user", source_name: username,
        relationship: "contributed_to", target_type: "repo", target_name: repo.full_name,
        strength: 0.8, evidence_count: 1, last_seen_at: now,
      });
    }

    // User → maintains → Repo (if owner)
    if (repo.role === "owner" && !repo.is_fork && !repo.is_archived) {
      edgeRows.push({
        user_id: userId, source_type: "user", source_name: username,
        relationship: "maintains", target_type: "repo", target_name: repo.full_name,
        strength: 0.9, evidence_count: 1, last_seen_at: now,
      });
    }

    // User → uses → Technology (for each language)
    if (repo.primary_language) {
      edgeRows.push({
        user_id: userId, source_type: "user", source_name: username,
        relationship: "uses", target_type: "technology", target_name: repo.primary_language,
        strength: 0.7, evidence_count: 1, last_seen_at: now,
      });
    }

    // User → interested_in → Topic
    for (const topic of (repo.topics || [])) {
      edgeRows.push({
        user_id: userId, source_type: "user", source_name: username,
        relationship: "interested_in", target_type: "ecosystem", target_name: topic,
        strength: 0.5, evidence_count: 1, last_seen_at: now,
      });
    }
  }

  // Build collaborator edges
  const { data: collabs } = await db.database.from("github_memory_collaborators")
    .select("*")
    .eq("user_id", userId)
    .order("interaction_count", { ascending: false })
    .limit(50);

  for (const collab of collabs ?? []) {
    const strength = Math.min(1.0, collab.interaction_count / 20);
    edgeRows.push({
      user_id: userId, source_type: "user", source_name: username,
      relationship: "collaborated_with", target_type: "user", target_name: collab.collaborator_login,
      strength, evidence_count: 1, last_seen_at: now,
    });
  }

  // Bulk upsert all graph edges
  if (edgeRows.length > 0) {
    await bulkUpsert(
      db, "github_memory_graph", edgeRows,
      "user_id,source_type,source_name,relationship,target_type,target_name",
    );
  }

  await updateJob(jobId, { totalEntities: edgeRows.length });
}

// ── Stage: Expertise Inference ──

async function inferExpertise(userId: string, jobId: string): Promise<void> {
  const db = createAdminClient();

  // Language expertise from repos
  const { data: repos } = await db.database.from("github_memory_repos")
    .select("primary_language, languages, stargazers_count, pushed_at, created_at_gh, role, topics")
    .eq("user_id", userId);

  const langStats = new Map<string, {
    repos: number; stars: number; lines: number;
    firstSeen: string; lastSeen: string;
  }>();

  for (const repo of repos ?? []) {
    // Primary language
    if (repo.primary_language) {
      const existing = langStats.get(repo.primary_language) ?? {
        repos: 0, stars: 0, lines: 0, firstSeen: repo.created_at_gh, lastSeen: repo.pushed_at ?? repo.created_at_gh,
      };
      existing.repos++;
      existing.stars += repo.stargazers_count;
      if (repo.created_at_gh < existing.firstSeen) existing.firstSeen = repo.created_at_gh;
      if ((repo.pushed_at ?? repo.created_at_gh) > existing.lastSeen) existing.lastSeen = repo.pushed_at ?? repo.created_at_gh;
      langStats.set(repo.primary_language, existing);
    }

    // Detailed languages
    const languages = (repo.languages ?? {}) as Record<string, number>;
    for (const [lang, bytes] of Object.entries(languages)) {
      const existing = langStats.get(lang) ?? {
        repos: 0, stars: 0, lines: 0, firstSeen: repo.created_at_gh, lastSeen: repo.pushed_at ?? repo.created_at_gh,
      };
      existing.lines += bytes;
      if (!repo.primary_language || lang !== repo.primary_language) existing.repos++;
      langStats.set(lang, existing);
    }
  }

  // Get commit counts per language
  const { data: commits } = await db.database.from("github_memory_commits")
    .select("languages_touched")
    .eq("user_id", userId);

  const commitLangCounts = new Map<string, number>();
  for (const c of commits ?? []) {
    for (const lang of (c.languages_touched ?? [])) {
      commitLangCounts.set(lang, (commitLangCounts.get(lang) ?? 0) + 1);
    }
  }

  // Accumulate all expertise rows
  const expertiseRows: Record<string, unknown>[] = [];

  for (const [lang, stats] of langStats) {
    const firstSeen = new Date(stats.firstSeen);
    const lastSeen = new Date(stats.lastSeen);
    const yearsActive = Math.max(0.1, (lastSeen.getTime() - firstSeen.getTime()) / (365.25 * 24 * 60 * 60 * 1000));

    const repoSignal = Math.min(1.0, stats.repos / 10);
    const starsSignal = Math.min(1.0, stats.stars / 50);
    const linesSignal = Math.min(1.0, stats.lines / 500000);
    const commitSignal = Math.min(1.0, (commitLangCounts.get(lang) ?? 0) / 100);
    const yearsSignal = Math.min(1.0, yearsActive / 5);

    const confidence = Math.min(1.0,
      0.3 * repoSignal + 0.15 * starsSignal + 0.2 * linesSignal +
      0.2 * commitSignal + 0.15 * yearsSignal,
    );

    if (confidence < 0.1) continue;

    expertiseRows.push({
      user_id: userId,
      skill: lang,
      skill_category: "language",
      confidence,
      evidence_repos: stats.repos,
      evidence_commits: commitLangCounts.get(lang) ?? 0,
      evidence_prs: 0,
      total_lines: stats.lines,
      years_active: parseFloat(yearsActive.toFixed(1)),
      first_seen_at: stats.firstSeen,
      last_seen_at: stats.lastSeen,
    });
  }

  // Framework/topic expertise from repo topics
  const topicCounts = new Map<string, number>();
  for (const repo of repos ?? []) {
    for (const topic of (repo.topics ?? []) as string[]) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
  }

  for (const [topic, count] of topicCounts) {
    if (count < 2) continue;
    const confidence = Math.min(1.0, count / 8);
    const isFramework = /react|vue|angular|next|svelte|django|flask|express|spring|rails|laravel|fastapi|nest/i.test(topic);

    expertiseRows.push({
      user_id: userId,
      skill: topic,
      skill_category: isFramework ? "framework" : "domain",
      confidence,
      evidence_repos: count,
      evidence_commits: 0,
      evidence_prs: 0,
      total_lines: 0,
      years_active: 0,
    });
  }

  // Bulk upsert all expertise rows
  if (expertiseRows.length > 0) {
    await bulkUpsert(db, "github_memory_expertise", expertiseRows, "user_id,skill,skill_category");
  }
}

// ── Helpers ──

/** Upsert rows in chunks of BULK_UPSERT_BATCH to stay within PostgREST body limits. */
async function bulkUpsert(
  db: ReturnType<typeof createAdminClient>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BULK_UPSERT_BATCH) {
    await db.database.from(table)
      .upsert(rows.slice(i, i + BULK_UPSERT_BATCH), { onConflict });
  }
}

async function getStoredRepos(
  userId: string,
  limit: number,
): Promise<{ id: string; full_name: string; role: string; primary_language: string | null; topics: string[]; is_fork: boolean; is_archived: boolean }[]> {
  const db = createAdminClient();
  const { data } = await db.database.from("github_memory_repos")
    .select("id, full_name, role, primary_language, topics, is_fork, is_archived")
    .eq("user_id", userId)
    .order("importance_score", { ascending: false })
    .limit(limit);
  return data ?? [];
}

async function upsertCollaborator(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  login: string,
  repoName: string,
  relType: string,
): Promise<void> {
  // Try upsert: increment interaction count, append shared repo
  const { data: existing } = await db.database.from("github_memory_collaborators")
    .select("id, interaction_count, shared_repos, relationship_types")
    .eq("user_id", userId)
    .eq("collaborator_login", login)
    .maybeSingle();

  if (existing) {
    const sharedRepos = new Set(existing.shared_repos as string[]);
    sharedRepos.add(repoName);
    const relTypes = new Set(existing.relationship_types as string[]);
    relTypes.add(relType);

    await db.database.from("github_memory_collaborators").update({
      interaction_count: existing.interaction_count + 1,
      shared_repos: [...sharedRepos],
      relationship_types: [...relTypes],
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
  } else {
    await db.database.from("github_memory_collaborators").insert({
      user_id: userId,
      collaborator_login: login,
      shared_repos: [repoName],
      relationship_types: [relType],
      interaction_count: 1,
      last_interaction_at: new Date().toISOString(),
    }).then(() => null, () => null);
  }
}


function computeRepoImportance(repo: GHRepo, role: string): number {
  let score = 0.3;
  if (role === "owner") score += 0.2;
  if (repo.stargazers_count > 0) score += Math.min(0.2, repo.stargazers_count / 100);
  if (repo.forks_count > 0) score += Math.min(0.1, repo.forks_count / 50);
  // Recent activity bonus
  const daysSincePush = repo.pushed_at
    ? (Date.now() - new Date(repo.pushed_at).getTime()) / (1000 * 60 * 60 * 24)
    : 365;
  if (daysSincePush < 30) score += 0.15;
  else if (daysSincePush < 90) score += 0.1;
  else if (daysSincePush < 365) score += 0.05;

  if (repo.archived) score *= 0.5;
  return Math.min(1.0, score);
}

function computePRImportance(pr: GHPullRequest, isAuthor: boolean): number {
  let score = 0.3;
  if (isAuthor) score += 0.2;
  if (pr.merged_at) score += 0.15;
  if (pr.additions + pr.deletions > 100) score += 0.1;
  if (pr.review_comments > 0) score += 0.1;
  if (pr.comments > 3) score += 0.05;
  return Math.min(1.0, score);
}

function inferCommitType(message: string): string {
  const lower = message.toLowerCase();
  if (/^(feat|feature|add)\b/i.test(lower)) return "feature";
  if (/^(fix|bug|patch|hotfix)\b/i.test(lower)) return "fix";
  if (/^(refactor|clean|restructure)\b/i.test(lower)) return "refactor";
  if (/^(doc|readme|comment)\b/i.test(lower)) return "docs";
  if (/^(test|spec|coverage)\b/i.test(lower)) return "test";
  if (/^(chore|build|ci|bump|deps|upgrade)\b/i.test(lower)) return "chore";
  return "other";
}

function inferPRCategory(title: string, labels: string[]): string {
  const combined = `${title} ${labels.join(" ")}`.toLowerCase();
  if (/feat|feature|add|new/.test(combined)) return "feature";
  if (/fix|bug|patch|hotfix/.test(combined)) return "fix";
  if (/refactor|clean|restructure/.test(combined)) return "refactor";
  if (/doc|readme/.test(combined)) return "docs";
  if (/test|spec|coverage/.test(combined)) return "test";
  if (/chore|ci|build/.test(combined)) return "chore";
  if (/dep|bump|upgrade/.test(combined)) return "dependency";
  return "other";
}

function inferIssueType(title: string, labels: string[]): string {
  const combined = `${title} ${labels.join(" ")}`.toLowerCase();
  if (/bug|error|crash|broken|regression/.test(combined)) return "bug";
  if (/feature|request|enhancement|proposal/.test(combined)) return "feature";
  if (/enhancement|improve|optimize/.test(combined)) return "enhancement";
  if (/question|help|support|how/.test(combined)) return "question";
  if (/doc|readme|documentation/.test(combined)) return "documentation";
  return "other";
}

function extractLanguagesFromFiles(files?: { filename: string }[]): string[] {
  if (!files) return [];
  const extensions = new Map<string, string>([
    [".ts", "TypeScript"], [".tsx", "TypeScript"], [".js", "JavaScript"], [".jsx", "JavaScript"],
    [".py", "Python"], [".rb", "Ruby"], [".go", "Go"], [".rs", "Rust"], [".java", "Java"],
    [".kt", "Kotlin"], [".swift", "Swift"], [".cpp", "C++"], [".c", "C"], [".cs", "C#"],
    [".php", "PHP"], [".scala", "Scala"], [".dart", "Dart"], [".vue", "Vue"],
    [".svelte", "Svelte"], [".sql", "SQL"], [".sh", "Shell"],
  ]);

  const langs = new Set<string>();
  for (const f of files.slice(0, 50)) {
    const ext = f.filename.slice(f.filename.lastIndexOf("."));
    const lang = extensions.get(ext);
    if (lang) langs.add(lang);
  }
  return [...langs];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapJob(row: any): IngestionJob {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    githubUsername: row.github_username,
    checkpoint: row.checkpoint ?? {},
    completedStages: row.completed_stages ?? [],
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    nextRetryAt: row.next_retry_at,
    reposProcessed: row.repos_processed,
    commitsProcessed: row.commits_processed,
    prsProcessed: row.prs_processed,
    issuesProcessed: row.issues_processed,
    totalEntities: row.total_entities,
    totalEmbeddings: row.total_embeddings,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
  };
}
