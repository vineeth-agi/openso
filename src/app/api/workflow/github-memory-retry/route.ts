/**
 * GitHub Memory: Retry Failed/Rate-Limited Jobs — runs every 30 minutes.
 *
 * Defense-in-depth (audit Finding 5.2): joins candidate jobs against
 * `connected_apps.status='active'` so disconnected users' lingering
 * retry rows never get resumed.
 */

import { serve } from "@upstash/workflow/nextjs";

import { embedGitHubMemory, getJob, runIngestion } from "@/lib/github-memory";
import { createAdminClient } from "@/lib/insforge/admin";

const HALT_STATUSES = new Set([
  "cancelled",
  "failed",
  "rate_limited",
  "retrying",
]);

export const { POST } = serve(async (context) => {
  const db = createAdminClient();
  const now = new Date().toISOString();

  const retryJobs = (await context.run("find-retry-jobs", async () => {
    const { data: activeConns } = await db.database.from("connected_apps")
      .select("user_id")
      .eq("provider", "github")
      .eq("status", "active");
    const activeUserIds = new Set(
      ((activeConns ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    );
    if (activeUserIds.size === 0) return [] as Array<{ id: string; user_id: string }>;

    const { data } = await db.database.from("github_ingestion_jobs")
      .select("id, user_id")
      .in("status", ["retrying", "rate_limited"])
      .lt("next_retry_at", now)
      .limit(5);
    return ((data ?? []) as Array<{ id: string; user_id: string }>)
      .filter((j) => activeUserIds.has(j.user_id));
  })) as Array<{ id: string; user_id: string }>;

  if (retryJobs.length === 0) return { retried: 0 };

  let retried = 0;
  let skipped = 0;
  for (const job of retryJobs) {
    try {
      await context.run(`retry-${job.id}`, async () => {
        await runIngestion(job.id);
        const updated = await getJob(job.id);
        if (
          updated &&
          updated.status === "completed" &&
          !HALT_STATUSES.has(updated.status)
        ) {
          await embedGitHubMemory(job.user_id, job.id);
        }
        return null;
      });
      retried++;
    } catch (err) {
      console.warn(`[github-memory-retry] job ${job.id} threw:`, err);
      skipped++;
    }
  }

  return { retried, skipped };
});
