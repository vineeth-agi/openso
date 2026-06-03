/**
 * Cron: Task Runner — RETIRED global poller (no-op fallback).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Why this is a no-op (audit CQA-01)
 * ──────────────────────────────────────────────────────────────────────────
 * This endpoint used to be a global 5-minute poller (driven by Cloudflare
 * Workers Cron) that scanned `agent_cron_jobs` for every due task and ran them
 * inline. That model has been replaced by the **per-job QStash schedule** model:
 *
 *   - Each user job now owns its own QStash schedule with the user's exact
 *     cron expression (see `src/lib/workflow/task-runner-schedule.ts`).
 *   - QStash invokes `/api/cron/run-job?id=<jobId>` per job, signature-verified
 *     and idempotent.
 *
 * Running both systems at once let jobs DOUBLE-FIRE (the poller and the per-job
 * schedule could each execute the same due task). The per-job model is canonical,
 * so the poller is retired.
 *
 * This route is intentionally NOT deleted: a stale external cron (e.g. a
 * Cloudflare Worker) may still be pointed at this URL. Keeping the handler means
 * those callers get a clean, authenticated 200 `{ disabled: true }` instead of a
 * surprising 404 — and, crucially, no jobs are queried or executed here.
 *
 * To fully decommission: remove the external cron trigger, then delete this route.
 */
import { NextRequest, NextResponse } from "next/server";

import { verifyCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Preserve the CRON_SECRET gate so this URL still rejects unauthenticated
  // callers exactly like it used to — even though it no longer does any work.
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  // Per-job QStash schedules are canonical (audit CQA-01). Return early WITHOUT
  // querying or running any jobs to avoid double-firing alongside `run-job`.
  return NextResponse.json({
    disabled: true,
    reason:
      "Per-job QStash schedules are canonical; global poller retired (audit CQA-01).",
  });
}
