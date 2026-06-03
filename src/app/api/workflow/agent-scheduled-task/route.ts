/**
 * Agent Scheduled Task Workflow — registers a recurring task in agent_cron_jobs.
 *
 * The actual recurring execution is handled by the `task-runner` workflow,
 * which runs every 5 minutes and picks up tasks whose next_run_at has passed.
 */

import { serve } from "@upstash/workflow/nextjs";

import { computeNextRunAt, cronToHuman } from "@/lib/cron";
import { createAdminClient } from "@/lib/insforge/admin";

type AgentScheduledTaskPayload = {
  userId: string;
  taskName: string;
  description: string;
  cronExpression?: string;
  nextRunAt?: string;
};

export const { POST } = serve<AgentScheduledTaskPayload>(async (context) => {
  const { userId, taskName, description, cronExpression, nextRunAt } =
    context.requestPayload;

  const nextRun = nextRunAt
    ? new Date(nextRunAt)
    : computeNextRunAt(cronExpression ?? "0 0 * * *");

  const alreadyExists = await context.run("check-existing", async () => {
    const db = createAdminClient();
    const { data } = await db.database.from("agent_cron_jobs")
      .select("id")
      .eq("user_id", userId)
      .eq("name", taskName)
      .eq("enabled", true)
      .limit(1);
    return (data?.length ?? 0) > 0;
  });

  if (alreadyExists) {
    return { scheduled: true, taskName, cronExpression, skippedDuplicate: true };
  }

  await context.run("persist-cron-job", async () => {
    const db = createAdminClient();
    const { error } = await db.database.from("agent_cron_jobs").insert({
      user_id: userId,
      name: taskName,
      description: `${description}${cronExpression ? ` | Schedule: ${cronExpression}` : ""}`,
      cron_expression: cronExpression ?? "0 0 * * *",
      function_id: "task-runner",
      config: { description },
      enabled: true,
      next_run_at: nextRun.toISOString(),
    });
    if (error) {
      console.error(
        "[agent-scheduled-task] Failed to persist cron job:",
        error.message,
        error.details,
      );
    }
    return null;
  });

  await context.run("log-to-activities", async () => {
    const db = createAdminClient();
    const { error } = await db.database.from("agent_activities").insert({
      user_id: userId,
      activity_type: "recurring_task_created",
      title: `Scheduled: ${taskName}`,
      description: `${description}${cronExpression ? ` | Runs: ${cronToHuman(cronExpression)} (${cronExpression})` : ""}${nextRunAt ? ` | Next run: ${new Date(nextRunAt).toLocaleString()}` : ""}`,
      status: "pending",
      priority: "medium",
      notification_channel: "in_app",
      metadata: { taskName, cronExpression, nextRunAt: nextRun.toISOString() },
    });
    if (error) {
      console.error(
        "[agent-scheduled-task] Failed to log activity:",
        error.message,
        error.details,
      );
    }
    return null;
  });

  return { scheduled: true, taskName, cronExpression };
});
