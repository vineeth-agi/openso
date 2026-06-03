/**
 * GitHub Memory: Full Ingest Workflow.
 *
 * Triggered when a user connects GitHub (see /api/auth/github/callback).
 *
 * Behaviour:
 *   - Each ingestion stage runs inside its own `context.run` step so
 *     Upstash records progress per-stage and can resume on retry.
 *   - After every stage we re-fetch the job and bail early if the
 *     status is no longer making forward progress (`cancelled`,
 *     `failed`, `rate_limited`, `retrying`). This stops the chain
 *     from running embeddings on partial data (audit Finding 3.5).
 *   - Embeddings + dream cycle only run when the job actually
 *     reaches `'completed'`. The previous `|| completedStages.length
 *     > 0` guard let the workflow embed half-ingested data.
 *   - `IngestionCancelled` from `runIngestion` propagates as a
 *     normal error; QStash records the failure and the chain stops.
 *     The retry workflow filters by `status in (retrying|rate_limited)`,
 *     so a cancelled job is correctly NOT retried.
 */

import { serve } from "@upstash/workflow/nextjs";

import {
  createIngestionJob,
  embedGitHubMemory,
  getJob,
  runIngestion,
} from "@/lib/github-memory";
import { runGitHubDreamCycle } from "@/lib/github-memory/dream-cycle";
import { sendNotification } from "@/lib/memory/notifications";

type IngestPayload = { userId: string };

/** Halt-states: do not run further stages or embeddings. */
const HALT_STATUSES = new Set([
  "cancelled",
  "failed",
  "rate_limited",
  "retrying",
]);

export const { POST } = serve<IngestPayload>(async (context) => {
  const { userId } = context.requestPayload;

  const jobId = await context.run("create-job", () => createIngestionJob(userId));
  if (!jobId) return { error: "No GitHub connection found" };

  // Run each stage. After every stage we re-check the job — if it
  // hit a halt state (cancelled/failed/rate_limited/retrying), break
  // out and let the per-stage retry / cancellation logic take over.
  const stageNames = [
    ["run-stage-repos", ["repos"]],
    ["run-stage-commits", ["commits"]],
    ["run-stage-prs", ["prs"]],
    ["run-stage-issues", ["issues"]],
    ["run-stage-postprocess", ["contributions", "collaborators", "graph", "expertise"]],
  ] as const;

  let halted = false;
  for (const [stepName, stages] of stageNames) {
    if (halted) break;
    await context.run(stepName, () => runIngestion(jobId, [...stages] as never));
    const after = await context.run(`${stepName}-status`, () => getJob(jobId));
    if (!after || HALT_STATUSES.has(after.status)) {
      halted = true;
    }
  }

  const job = await context.run("check-status", () => getJob(jobId));
  if (!job) return { error: "Job disappeared" };

  // Halt-state jobs return early with their state so the dashboard
  // can show the right message. Do NOT embed partial data.
  if (HALT_STATUSES.has(job.status)) {
    return {
      status: job.status,
      completedStages: job.completedStages,
      nextRetryAt: job.nextRetryAt,
    };
  }

  // Only embed and run the dream cycle on a fully-completed run
  // (audit Finding 3.5).
  if (job.status === "completed") {
    await context.run("embed-github-memory", () =>
      embedGitHubMemory(userId, jobId),
    );
  }

  let dreamResult: Awaited<ReturnType<typeof runGitHubDreamCycle>> | null = null;
  if (job.status === "completed") {
    dreamResult = await context.run("github-dream-cycle", () =>
      runGitHubDreamCycle(userId),
    );
  }

  await context.run("notify-user", () =>
    sendNotification({
      userId,
      title: "GitHub Memory Scan Complete",
      body: `Analyzed ${job.reposProcessed} repos, ${job.commitsProcessed} commits, ${job.prsProcessed} PRs, ${job.issuesProcessed} issues.${dreamResult ? ` AI generated ${dreamResult.narrativeSections} narrative sections and ${dreamResult.insightsExtracted} insights.` : ""} Your GitHub intelligence is now active.`,
      channel: "in_app",
      priority: "low",
      activityType: "github_memory",
      metadata: {
        jobId,
        status: job.status,
        repos: job.reposProcessed,
        commits: job.commitsProcessed,
        prs: job.prsProcessed,
        issues: job.issuesProcessed,
      },
    }),
  );

  return {
    status: job.status,
    repos: job.reposProcessed,
    commits: job.commitsProcessed,
    prs: job.prsProcessed,
    issues: job.issuesProcessed,
    totalEntities: job.totalEntities,
    totalEmbeddings: job.totalEmbeddings,
  };
});
