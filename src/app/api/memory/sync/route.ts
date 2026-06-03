/**
 * POST /api/memory/sync — user-session memory sync.
 *
 * Consolidated onto the durable workflow (audit CQA-02). Instead of running the
 * ingestGitHub → buildProfile → narrate → sendNotification orchestration inline,
 * this route now resolves the caller from their session and hands the work off
 * to the canonical durable workflow at `/api/workflow/memory-sync` via
 * `workflowClient.trigger()`. That keeps ONE implementation of the sync pipeline.
 *
 * Default response is a 202-style `{ triggered: true }` — the heavy lifting runs
 * out-of-band in the workflow and the user is notified in-app on completion.
 *
 * Back-compat: callers that still need a synchronous totals response (e.g. a UI
 * button that displays "N new facts" on return) can pass `?sync=1`, which runs
 * the pipeline inline and returns totals. Prefer the default async trigger for
 * anything new — the workflow is durable and retried by QStash.
 */
import { NextRequest, NextResponse } from "next/server";

import { getAuthUser } from "@/lib/insforge/server";
import {
  ingestGitHub,
} from "@/lib/memory/ingestors";
import { sendNotification } from "@/lib/memory/notifications";
import { buildProfile } from "@/lib/memory/profile";
import { workflowClient, workflowUrl } from "@/lib/workflow/client";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user } = auth;
  const userId = user.id;

  let body: { sources?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body OK */
  }
  const sources: string[] = body.sources ?? ["github"];

  const wantsSync = new URL(req.url).searchParams.get("sync") === "1";

  // ── Default path: hand off to the durable workflow (one implementation) ──
  if (!wantsSync) {
    const { workflowRunId } = await workflowClient.trigger({
      url: workflowUrl("memory-sync"),
      body: { userId, sources },
      retries: 3,
    });
    return NextResponse.json(
      { triggered: true, workflowRunId },
      { status: 202 },
    );
  }

  // ── Opt-in synchronous path (?sync=1): preserves the totals response ──
  const results: Record<string, { factsAdded: number }> = {};
  if (sources.includes("github")) results.github = await ingestGitHub(userId);

  await buildProfile(userId);

  const totalFacts = Object.values(results).reduce(
    (sum, r) => sum + (r.factsAdded ?? 0),
    0,
  );

  await sendNotification({
    userId,
    title: "Memory Sync Complete",
    body: `Synced ${sources.join(", ")} — ${totalFacts} new facts added.`,
    channel: "in_app",
    priority: "low",
    activityType: "memory_update",
    metadata: { results },
  });

  return NextResponse.json({ status: "synced", results, totalFacts });
}
