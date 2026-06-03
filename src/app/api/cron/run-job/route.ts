/**
 * POST /api/cron/run-job?id=<jobId>
 *
 * Executes a single cron job by ID. Called directly by QStash per-job schedules.
 * Each user job has its own QStash schedule with the user's exact cron expression.
 *
 * This is the CANONICAL cron execution path (audit CQA-01). The former global
 * poller at `/api/cron/task-runner` is retired to a no-op to prevent double-firing.
 *
 * Auth: Verified via Upstash-Signature header (QStash signs all requests).
 */
import { NextRequest, NextResponse } from "next/server";

import { Receiver } from "@upstash/qstash";

import { computeNextRunAt } from "@/lib/cron";
import { createAdminClient } from "@/lib/insforge/admin";
import { sendNotification } from "@/lib/memory/notifications";
import { fetchAndSummarizeEmails } from "@/lib/workflow/email-summary";

export const runtime = "nodejs";
export const maxDuration = 60;

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
});

export async function POST(req: NextRequest) {
  // Verify QStash signature. Fail closed in every environment (Finding 11 —
  // previously this fell through silently when NODE_ENV !== "production",
  // which let any preview / staging deployment accept unsigned cron requests).
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY && !process.env.QSTASH_NEXT_SIGNING_KEY) {
    console.error("[run-job] QStash signing keys are not set — rejecting request.");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const signature = req.headers.get("upstash-signature") ?? "";
  const body = await req.text();

  try {
    await receiver.verify({ signature, body, url: req.url });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const jobId = new URL(req.url).searchParams.get("id");
  if (!jobId) {
    return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  }

  const db = createAdminClient();
  const now = new Date();

  // Fetch the job
  const { data: task, error: fetchErr } = await db.database.from("agent_cron_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (fetchErr || !task) {
    console.error(`[run-job] Job ${jobId} not found:`, fetchErr?.message);
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (!task.enabled) {
    return NextResponse.json({ skipped: true, reason: "Job is disabled" });
  }

  console.log(`[run-job] Executing: "${task.name}" (id=${jobId})`);

  const lowerName = (task.name as string).toLowerCase();
  const lowerDesc = (task.description as string).toLowerCase();
  const isEmailTask =
    lowerName.includes("email") || lowerName.includes("mail") ||
    lowerDesc.includes("email") || lowerDesc.includes("mail");

  let resultBody = task.description as string;
  let runSuccess = true;

  try {
    if (isEmailTask) {
      resultBody = await fetchAndSummarizeEmails(task.user_id);
    } else {
      resultBody = `Task "${task.name}" executed at ${now.toUTCString()}. ${task.description}`;
    }
  } catch (err) {
    resultBody = `Execution error: ${err instanceof Error ? err.message : "Unknown error"}`;
    runSuccess = false;
    console.error(`[run-job] Task "${task.name}" failed:`, err);
  }

  // Send notification
  await sendNotification({
    userId: task.user_id,
    title: task.name,
    body: resultBody,
    channel: "in_app",
    priority: "medium",
    activityType: "cron_job_executed",
    metadata: {
      taskId: jobId,
      cronExpression: task.cron_expression,
      ranAt: now.toISOString(),
      success: runSuccess,
    },
  });

  // Update job stats
  const nextRun = computeNextRunAt(task.cron_expression as string, now);
  await db.database.from("agent_cron_jobs")
    .update({
      last_run_at: now.toISOString(),
      last_result: resultBody,
      last_result_at: now.toISOString(),
      run_count: ((task.run_count as number) ?? 0) + 1,
      next_run_at: nextRun.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", jobId);

  return NextResponse.json({ ran: true, jobId, success: runSuccess });
}
