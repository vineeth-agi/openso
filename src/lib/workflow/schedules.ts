/**
 * Definition of every scheduled workflow.
 *
 * The bootstrap script `scripts/sync-workflow-schedules.ts` reads this list
 * and reconciles QStash Schedules so they always match what's declared here.
 *
 * Each entry maps to a Next.js route under `src/app/api/workflow/<slug>/route.ts`.
 */

export type WorkflowScheduleConfig = {
  /** Stable identifier — used as the QStash schedule id. */
  scheduleId: string;
  /** Slug under /api/workflow/. */
  slug: string;
  /** Standard 5-field cron expression (UTC). */
  cron: string;
  /** Optional human-readable description. */
  description?: string;
  /** Optional retry override. */
  retries?: number;
  /** Optional JSON body to send with each scheduled request. */
  body?: Record<string, unknown>;
};

export const WORKFLOW_SCHEDULES: WorkflowScheduleConfig[] = [
  {
    scheduleId: "daily-digest",
    slug: "daily-digest",
    cron: "0 8 * * *",
    description: "Daily digest at 08:00 UTC",
  },

  {
    scheduleId: "github-insight",
    slug: "github-insight",
    cron: "0 9 * * 1",
    description: "Weekly GitHub insights every Monday 09:00 UTC",
  },
  {
    scheduleId: "github-memory-sync",
    slug: "github-memory-sync",
    cron: "0 3 * * *",
    description: "GitHub memory incremental sync at 03:00 UTC",
  },
  {
    scheduleId: "github-memory-retry",
    slug: "github-memory-retry",
    cron: "*/30 * * * *",
    description: "Resume failed/rate-limited GitHub memory jobs every 30 min",
  },
  {
    scheduleId: "profile-rebuild",
    slug: "profile-rebuild",
    cron: "0 3 * * 0",
    description: "Weekly profile rebuild Sunday 03:00 UTC",
  },
  {
    scheduleId: "open-issues-sync",
    slug: "open-issues-sync",
    cron: "0 * * * *",
    description: "Hourly open source issues sync (incremental)",
  },
  {
    scheduleId: "open-issues-full-sync",
    slug: "open-issues-sync",
    cron: "0 2 * * 0",
    description: "Weekly full sync Sunday 02:00 UTC (deletes closed issues)",
    body: { fullSync: true },
  },
  {
    scheduleId: "dream-cycle",
    slug: "dream-cycle",
    cron: "0 4 * * *",
    description:
      "Daily sweeper at 04:00 UTC — catches idle users and applies forgetting/decay. On-demand single-user runs are triggered from chat onFinish via workflowClient.trigger.",
  },
  {
    scheduleId: "cleanup-oauth-states",
    slug: "cleanup-oauth-states",
    cron: "0 5 * * *",
    description:
      "Daily cleanup of expired oauth_states rows at 05:00 UTC (audit Finding 4.5).",
  },
];
