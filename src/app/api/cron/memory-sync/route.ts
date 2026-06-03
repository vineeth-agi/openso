/**
 * Internal API: Memory Sync — cron entrypoint.
 *
 * Consolidated onto the durable workflow (audit CQA-02). This route no longer
 * runs the ingestGitHub → buildProfile → narrate → sendNotification pipeline
 * inline. Instead it authenticates the cron caller and delegates each user's
 * sync to the canonical durable workflow at `/api/workflow/memory-sync` via
 * `workflowClient.trigger()`, so there is ONE implementation of the pipeline.
 *
 * Auth (audit Finding 7.4) — unchanged gate:
 *   - Cron-secret REQUIRED (Bearer CRON_SECRET, timing-safe compared).
 *   - Per-user invocation (`userId` in body) must match the
 *     `INTERNAL_CRON_USER_IDS` allowlist (comma-separated). This keeps a
 *     leaked CRON_SECRET from being used for arbitrary-user impersonation.
 *   - Sweep mode (no `userId`): triggers one workflow per active
 *     GitHub-connected user.
 *
 * Note: there is no user-session path here — that lives in
 * `/api/memory/sync`. This endpoint is cron-only.
 */
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { timingSafeEqualStr } from "@/lib/security/timing-safe";
import { workflowClient, workflowUrl } from "@/lib/workflow/client";

export const runtime = "nodejs";

function isAllowedCronUser(userId: string): boolean {
  const raw = process.env.INTERNAL_CRON_USER_IDS;
  if (!raw) return false;
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(userId);
}

async function listActiveGithubUserIds(): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db.database.from("connected_apps")
    .select("user_id")
    .eq("provider", "github")
    .eq("status", "active");
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
}

/** Hand a single user's memory sync off to the durable workflow. */
async function triggerSync(userId: string, sources: string[]) {
  const { workflowRunId } = await workflowClient.trigger({
    url: workflowUrl("memory-sync"),
    body: { userId, sources },
    retries: 3,
  });
  return workflowRunId;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  // ── Cron-secret gate (only caller for this endpoint) ─────────────
  if (!cronSecret || !auth || !timingSafeEqualStr(auth, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { sources?: string[]; userId?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const sources = body.sources ?? ["github"];

  const claimedUserId = body.userId;

  // ── Per-user invocation: requires an allowlist match ─────────────
  if (claimedUserId) {
    if (typeof claimedUserId !== "string" || !isAllowedCronUser(claimedUserId)) {
      return NextResponse.json(
        { error: "userId not in INTERNAL_CRON_USER_IDS allowlist" },
        { status: 403 },
      );
    }
    const workflowRunId = await triggerSync(claimedUserId, sources);
    return NextResponse.json({ triggered: true, workflowRunId }, { status: 202 });
  }

  // ── Sweep mode: trigger one workflow per active GitHub user ──────
  const userIds = await listActiveGithubUserIds();
  const triggered: string[] = [];
  for (const userId of userIds) {
    try {
      await triggerSync(userId, sources);
      triggered.push(userId);
    } catch (err) {
      console.warn(`[cron/memory-sync] trigger for user ${userId} failed:`, err);
    }
  }
  return NextResponse.json(
    { swept: userIds.length, triggered: triggered.length },
    { status: 202 },
  );
}
