/**
 * Internal API: Schedule Task — creates a user-defined recurring task.
 *
 * Called from the chat agent and the Cron Jobs UI.
 *
 * Each job gets its own QStash schedule with the user's exact cron expression.
 * QStash fires at the exact time → calls /api/cron/run-job?id=<jobId>.
 * No global poller — zero cost when no jobs exist.
 */
import { NextRequest, NextResponse } from "next/server";

import { computeNextRunAt, cronToHuman } from "@/lib/cron";
import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { timingSafeEqualStr } from "@/lib/security/timing-safe";
import { createJobSchedule } from "@/lib/workflow/task-runner-schedule";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let userId: string;
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const body = await req.json();

  if (cronSecret && auth && timingSafeEqualStr(auth, `Bearer ${cronSecret}`)) {
    userId = body.userId;
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  } else {
    const authResult = await getAuthUser();
    if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    userId = authResult.user.id;
  }

  const { taskName, description, cronExpression, nextRunAt } = body as {
    taskName: string;
    description: string;
    cronExpression?: string;
    nextRunAt?: string;
  };

  if (!taskName || !description) {
    return NextResponse.json({ error: "taskName and description required" }, { status: 400 });
  }

  const cron = cronExpression ?? "0 0 * * *";
  const db = createAdminClient();
  const nextRun = nextRunAt ? new Date(nextRunAt) : computeNextRunAt(cron);

  // Check for duplicates
  const { data: existing } = await db.database.from("agent_cron_jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("name", taskName)
    .eq("enabled", true)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ scheduled: true, taskName, cronExpression: cron, skippedDuplicate: true });
  }

  // Insert cron job
  const { data: inserted, error: insertErr } = await db.database.from("agent_cron_jobs")
    .insert({
      user_id: userId,
      name: taskName,
      description,
      cron_expression: cron,
      function_id: "run-job",
      config: { description },
      enabled: true,
      next_run_at: nextRun.toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[schedule-task] Insert failed:", insertErr?.message);
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }

  // Create the QStash schedule. If this fails the DB row exists but
  // would never fire — roll the row back so the API is all-or-nothing
  // from the user's perspective. Without this rollback we'd repeat
  // the silent-breakage bug we are explicitly fixing.
  try {
    await createJobSchedule(inserted.id, cron);
  } catch (scheduleErr) {
    console.error(
      `[schedule-task] QStash schedule creation failed for job ${inserted.id}:`,
      scheduleErr,
    );
    await db.database.from("agent_cron_jobs")
      .delete()
      .eq("id", inserted.id);

    const message =
      scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr);
    const isQuotaError =
      /quota.*max\s*schedules?/i.test(message) ||
      /maxSchedules?\s*exceeded/i.test(message);

    if (isQuotaError) {
      // QStash free tier caps total schedules at 10 across the whole
      // QStash project. Tell the user clearly so they can delete an
      // old job, upgrade, or contact support.
      return NextResponse.json(
        {
          error:
            "Your scheduling provider has hit its plan limit (max schedules reached). Delete an unused cron job and try again, or upgrade your QStash plan.",
          code: "qstash_quota_exceeded",
        },
        { status: 507 }, // Insufficient Storage — closest semantic match
      );
    }

    return NextResponse.json(
      {
        error:
          "Could not register the schedule with QStash. Your job was not saved. Please try again.",
        code: "qstash_schedule_failed",
      },
      { status: 502 },
    );
  }

  // Log activity
  await db.database.from("agent_activities").insert({
    user_id: userId,
    activity_type: "recurring_task_created",
    title: `Scheduled: ${taskName}`,
    description: `${description} | Runs: ${cronToHuman(cron)} (${cron})`,
    status: "pending",
    priority: "medium",
    notification_channel: "in_app",
    metadata: { taskName, cronExpression: cron, nextRunAt: nextRun.toISOString() },
  });

  return NextResponse.json({ scheduled: true, taskName, cronExpression: cron });
}
