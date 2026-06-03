/**
 * POST /api/cron/recalculate-next-run
 *
 * Recomputes next_run_at for all of the user's enabled cron jobs and
 * ensures each has a QStash schedule (creates if missing).
 * Use this to fix/migrate jobs to the per-job schedule system.
 */
import { NextResponse } from "next/server";

import { computeNextRunAt } from "@/lib/cron";
import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { createJobSchedule } from "@/lib/workflow/task-runner-schedule";

export const runtime = "nodejs";

export async function POST() {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user } = auth;

  const admin = createAdminClient();
  const { data: jobs, error } = await admin
    .database.from("agent_cron_jobs")
    .select("id, cron_expression")
    .eq("user_id", user.id)
    .eq("enabled", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const updates = await Promise.allSettled(
    (jobs ?? []).map(async (job) => {
      const next = computeNextRunAt(job.cron_expression as string, now);
      await admin
        .database.from("agent_cron_jobs")
        .update({ next_run_at: next.toISOString() })
        .eq("id", job.id);

      // Ensure this job has a QStash schedule
      await createJobSchedule(job.id, job.cron_expression as string);

      return { id: job.id, next_run_at: next.toISOString() };
    }),
  );

  const fixed = updates.filter((r) => r.status === "fulfilled").length;
  return NextResponse.json({ fixed, total: (jobs ?? []).length });
}
