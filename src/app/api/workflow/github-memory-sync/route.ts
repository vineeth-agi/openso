/**
 * GitHub Memory: Daily Incremental Sync — runs every day at 03:00 UTC.
 *
 * Defense-in-depth (audit Finding 5.2): joins the candidate list against
 * `connected_apps.status='active'` so a user who disconnected after the
 * last completed run never gets re-synced — even in the rare race where
 * `deleteGitHubMemory` failed to remove their `github_ingestion_jobs`
 * row.
 */

import { serve } from "@upstash/workflow/nextjs";

import { embedGitHubMemory, runIngestion } from "@/lib/github-memory";
import { runGitHubDreamCycle } from "@/lib/github-memory/dream-cycle";
import { createAdminClient } from "@/lib/insforge/admin";

type SyncJob = { user_id: string; id: string; github_username: string };

const HALT_STATUSES = new Set([
  "cancelled",
  "failed",
  "rate_limited",
  "retrying",
]);

export const { POST } = serve(async (context) => {
  const db = createAdminClient();

  const jobs = (await context.run("find-synced-users", async () => {
    // Two-step query because the InsForge SDK does not support PostgREST
    // joins/embeds in this codebase yet. First find users with an active
    // GitHub connection, then filter the candidate jobs to that set.
    const { data: activeConns } = await db.database.from("connected_apps")
      .select("user_id")
      .eq("provider", "github")
      .eq("status", "active");
    const activeUserIds = new Set(
      ((activeConns ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    );
    if (activeUserIds.size === 0) return [] as SyncJob[];

    const { data } = await db.database.from("github_ingestion_jobs")
      .select("user_id, id, github_username")
      .in("status", ["completed", "continuously_syncing"]);
    return ((data ?? []) as SyncJob[]).filter((j) => activeUserIds.has(j.user_id));
  })) as SyncJob[];

  if (jobs.length === 0) return { synced: 0 };

  let synced = 0;
  let skipped = 0;
  for (const job of jobs) {
    // Each user runs in their own `context.run` step so a rate-limit
    // throw inside `runIngestion` (audit Finding 3.4 fix) only fails
    // that user's step — Upstash records the failure and continues to
    // the next iteration.
    try {
      await context.run(`sync-${job.user_id}`, async () => {
        await db.database.from("github_ingestion_jobs")
          .update({
            status: "continuously_syncing",
            last_activity_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        await runIngestion(job.id);
        const { data: refreshed } = await db.database.from("github_ingestion_jobs")
          .select("status")
          .eq("id", job.id)
          .maybeSingle();
        const status = (refreshed as { status?: string } | null)?.status;
        if (status && !HALT_STATUSES.has(status)) {
          await embedGitHubMemory(job.user_id, job.id);
          await runGitHubDreamCycle(job.user_id);
        }
        return null;
      });
      synced++;
    } catch (err) {
      // Per-user halt errors (rate-limit, cancellation, retryable) are
      // expected — they are persisted to `github_ingestion_jobs` and
      // the retry workflow will pick them up. Don't fail the whole
      // sweep.
      console.warn(`[github-memory-sync] user ${job.user_id} skipped:`, err);
      skipped++;
    }
  }

  return { synced, skipped };
});
