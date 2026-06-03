/**
 * Per-job QStash schedule management.
 *
 * Each cron job gets its own QStash schedule with the user's exact cron expression.
 * No global poller — jobs fire exactly when scheduled.
 *
 * Schedule ID format: "cron-job-{jobId}"
 * Destination: /api/cron/run-job?id={jobId}
 *
 * Error handling: `createJobSchedule` THROWS on failure (after a single
 * idempotent retry against the "already exists" race). The previous
 * silent `try { ... } catch (err) { console.error(...) }` swallowed
 * QStash failures, so jobs were inserted into `agent_cron_jobs` and the
 * route returned `{ scheduled: true }` while QStash never received the
 * schedule. Result: invisible breakage — the row exists, the UI shows
 * the job, but it never fires. Surface failures so the API can return a
 * 5xx and the UI can prompt the user to retry.
 *
 * Pause / resume / delete intentionally remain best-effort (404 → no-op)
 * because they're recoverable: a failed pause leaves an active schedule
 * that next reconcile catches; a failed resume can be re-tried via
 * /api/cron/manage; a failed delete becomes an orphan that the
 * reconcile script removes.
 */

import { qstashClient, workflowBaseUrl } from "@/lib/workflow/client";

function jobScheduleId(jobId: string): string {
  return `cron-job-${jobId}`;
}

function jobDestination(jobId: string): string {
  return `${workflowBaseUrl()}/api/cron/run-job?id=${jobId}`;
}

/**
 * Create (or atomically replace) a QStash schedule for a specific cron job.
 * Called when a job is created or re-enabled.
 *
 * On a "schedule already exists" error we delete-then-recreate so we end
 * up with the right destination and cron expression even when an old
 * schedule remained from a previous deploy with a stale base URL.
 *
 * Throws on unrecoverable failure — the caller is expected to surface
 * the error to the user.
 */
export async function createJobSchedule(
  jobId: string,
  cronExpression: string,
): Promise<void> {
  const scheduleId = jobScheduleId(jobId);
  const destination = jobDestination(jobId);

  try {
    await qstashClient.schedules.create({
      scheduleId,
      destination,
      cron: cronExpression,
      retries: 2,
    });
    console.log(
      `[task-runner-schedule] Created schedule ${scheduleId} (${cronExpression}) → ${destination}`,
    );
    return;
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : String(err);
    const alreadyExists =
      status === 409 ||
      message.includes("already exists") ||
      message.toLowerCase().includes("conflict");

    if (!alreadyExists) {
      console.error(
        `[task-runner-schedule] Failed to create schedule ${scheduleId}:`,
        err,
      );
      throw err instanceof Error
        ? err
        : new Error(`Failed to create QStash schedule: ${message}`);
    }

    // Schedule with this id already exists. Delete + recreate so we
    // end up with the right destination and cron expression. This is
    // idempotent and recovers from stale schedules pointing at old
    // base URLs.
    console.warn(
      `[task-runner-schedule] Schedule ${scheduleId} already exists; recreating with current destination/cron.`,
    );
    try {
      await qstashClient.schedules.delete(scheduleId);
    } catch (deleteErr) {
      console.warn(
        `[task-runner-schedule] Pre-recreate delete of ${scheduleId} threw (continuing):`,
        deleteErr,
      );
    }
    await qstashClient.schedules.create({
      scheduleId,
      destination,
      cron: cronExpression,
      retries: 2,
    });
    console.log(
      `[task-runner-schedule] Recreated schedule ${scheduleId} (${cronExpression}) → ${destination}`,
    );
  }
}

/**
 * Pause a QStash schedule for a specific cron job.
 * Called when a job is disabled. Best-effort.
 */
export async function pauseJobSchedule(jobId: string): Promise<void> {
  const scheduleId = jobScheduleId(jobId);
  try {
    await qstashClient.schedules.pause({ schedule: scheduleId });
    console.log(`[task-runner-schedule] Paused schedule ${scheduleId}`);
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : String(err);
    if (status === 404 || message.includes("not found")) return;
    console.error(`[task-runner-schedule] Failed to pause schedule for job ${jobId}:`, err);
  }
}



/**
 * Delete a QStash schedule for a specific cron job.
 * Called when a job is deleted. Best-effort — if QStash already
 * forgot the schedule (404), the row deletion in the DB is enough.
 */
export async function deleteJobSchedule(jobId: string): Promise<void> {
  const scheduleId = jobScheduleId(jobId);
  try {
    await qstashClient.schedules.delete(scheduleId);
    console.log(`[task-runner-schedule] Deleted schedule ${scheduleId}`);
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : String(err);
    if (status === 404 || message.includes("not found")) return;
    console.error(`[task-runner-schedule] Failed to delete schedule for job ${jobId}:`, err);
  }
}

