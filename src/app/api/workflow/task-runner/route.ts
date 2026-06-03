/**
 * Task Runner Workflow — runs every 5 minutes, executes due recurring tasks.
 *
 * Reads from agent_cron_jobs where enabled=true and next_run_at has passed.
 */

import { serve } from "@upstash/workflow/nextjs";

import { computeNextRunAt } from "@/lib/cron";
import { createAdminClient } from "@/lib/insforge/admin";
import { sendNotification } from "@/lib/memory/notifications";
import { fetchAndSummarizeEmails } from "@/lib/workflow/email-summary";

export const { POST } = serve(async (context) => {
  const db = createAdminClient();

  const dueTasks = (await context.run("find-due-tasks", async () => {
    const now = new Date().toISOString();
    const { data } = await db.database.from("agent_cron_jobs")
      .select("*")
      .eq("enabled", true)
      .lte("next_run_at", now)
      .limit(20);
    return (data ?? []) as Array<Record<string, unknown>>;
  })) as Array<Record<string, unknown>>;

  if (dueTasks.length === 0) return { ran: 0 };

  let ran = 0;
  for (const task of dueTasks) {
    const taskId = task.id as string;
    await context.run(`run-task-${taskId}`, async () => {
      const now = new Date();

      const { data: fresh } = await db.database.from("agent_cron_jobs")
        .select("next_run_at")
        .eq("id", taskId)
        .single();
      if (fresh && new Date(fresh.next_run_at) > now) {
        return null;
      }

      const taskName = task.name as string;
      const description = task.description as string;
      const cronExpression = task.cron_expression as string;
      const userId = task.user_id as string;

      const lowerName = taskName.toLowerCase();
      const lowerDesc = description.toLowerCase();
      const isEmailTask =
        lowerName.includes("email") ||
        lowerName.includes("mail") ||
        lowerDesc.includes("email") ||
        lowerDesc.includes("mail");

      let resultBody = description;
      let runSuccess = true;

      try {
        if (isEmailTask) {
          resultBody = await fetchAndSummarizeEmails(userId);
        } else {
          resultBody = `Task "${taskName}" executed at ${now.toUTCString()}. ${description}`;
        }
      } catch (err) {
        resultBody = `Execution error: ${err instanceof Error ? err.message : "Unknown error"}`;
        runSuccess = false;
      }

      await sendNotification({
        userId,
        title: taskName,
        body: resultBody,
        channel: "in_app",
        priority: "medium",
        activityType: "cron_job_executed",
        metadata: {
          taskId,
          cronExpression,
          ranAt: now.toISOString(),
          success: runSuccess,
        },
      });

      await db.database.from("agent_activities")
        .update({ status: "completed" })
        .eq("user_id", userId)
        .eq("activity_type", "recurring_task_created")
        .eq("status", "pending")
        .contains("metadata", { taskName });

      const nextRun = computeNextRunAt(cronExpression, now);
      const { error: updateError } = await db.database.from("agent_cron_jobs")
        .update({
          last_run_at: now.toISOString(),
          last_result: resultBody,
          last_result_at: now.toISOString(),
          run_count: ((task.run_count as number | undefined) ?? 0) + 1,
          next_run_at: nextRun.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", taskId);

      if (updateError) {
        console.error(
          `[task-runner] Failed to update cron job ${taskId}:`,
          updateError.message,
        );
      }
      return null;
    });
    ran++;
  }

  return { ran };
});
