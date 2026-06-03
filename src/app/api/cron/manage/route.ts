/**
 * POST /api/cron/manage
 *
 * Manage cron jobs: toggle (enable/disable) or delete.
 * Each job has its own QStash schedule — toggle pauses/resumes it, delete removes it.
 *
 * Security:
 *   - Ownership is enforced both for the SQL mutation AND verified before any
 *     QStash side-effect (Finding 2 — without the post-mutation check, an
 *     attacker could ask us to delete *another user's* QStash schedule by
 *     submitting their jobId; the SQL would no-op but QStash would still run).
 */
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { safeErrorResponse } from "@/lib/security/safe-error";
import {
  createJobSchedule,
  pauseJobSchedule,
  deleteJobSchedule,
} from "@/lib/workflow/task-runner-schedule";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const authResult = await getAuthUser();
  if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = authResult.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { action, jobId, enabled } = body as {
    action?: "toggle" | "delete";
    jobId?: string;
    enabled?: boolean;
  };

  if (!action || !jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "action and jobId required" }, { status: 400 });
  }

  // Defensive: jobId should be a UUID (matches agent_cron_jobs.id type).
  // Reject anything that doesn't look like one before we hit QStash with it.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(jobId)) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  const db = createAdminClient();

  if (action === "toggle") {
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled boolean required for toggle" }, { status: 400 });
    }

    // Get the job's cron expression — and confirm ownership in the same query.
    const { data: job } = await db.database.from("agent_cron_jobs")
      .select("cron_expression")
      .eq("id", jobId)
      .eq("user_id", userId)
      .single();

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Update with .select() so we can verify the row was actually changed before
    // touching QStash. If RLS / ownership filters out the row we get an empty array.
    const { data: updatedRows, error: updateErr } = await db.database.from("agent_cron_jobs")
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("user_id", userId)
      .select("id");

    if (updateErr) {
      return safeErrorResponse(updateErr, { scope: "/api/cron/manage:toggle", status: 500 });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (enabled) {
      // createJobSchedule is idempotent — it deletes and recreates the
      // schedule on a conflict, so we don't need to resume separately.
      // The previous "resume + create" sequence was a remnant from
      // when create silently failed on conflict.
      try {
        await createJobSchedule(jobId, job.cron_expression as string);
      } catch (err) {
        // The DB row was already toggled. Roll back so we don't have
        // an "enabled in DB, no QStash schedule" zombie.
        await db.database.from("agent_cron_jobs")
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq("id", jobId);
        return safeErrorResponse(err, { scope: "/api/cron/manage:toggle", status: 502 });
      }
    } else {
      await pauseJobSchedule(jobId);
    }

    return NextResponse.json({ ok: true, enabled });
  }

  if (action === "delete") {
    // Critical: scope the delete by user_id AND require .select() so we know
    // a row was actually deleted before we tell QStash to remove the schedule.
    const { data: deleted, error: deleteErr } = await db.database.from("agent_cron_jobs")
      .delete()
      .eq("id", jobId)
      .eq("user_id", userId)
      .select("id");

    if (deleteErr) {
      return safeErrorResponse(deleteErr, { scope: "/api/cron/manage:delete", status: 500 });
    }

    if (!deleted || deleted.length === 0) {
      // Either the job doesn't exist or it belongs to another user.
      // Return 404 either way — never let QStash see the foreign jobId.
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Ownership confirmed — safe to remove the QStash schedule.
    await deleteJobSchedule(jobId);

    return NextResponse.json({ ok: true, deleted: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
