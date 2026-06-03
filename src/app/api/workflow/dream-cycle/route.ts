/**
 * Dream Cycle Workflow.
 *
 * Two trigger modes:
 *
 *   1. **On-demand (single user)** — fired from chat/telegram `onFinish` when
 *      `shouldRunDreamCycle(userId)` returns true. Body: `{ userId }`.
 *      Processes that user immediately so consolidation happens within seconds
 *      of the last meaningful message.
 *
 *   2. **Scheduled sweeper (all users)** — fired by QStash cron once per day
 *      with no body. Catches users who have unprocessed buffer but never
 *      crossed the on-demand threshold (idle / low-volume sessions), and
 *      ensures forgetting / decay / narrative refresh runs even for users
 *      who haven't chatted recently.
 *
 * Replaces the previous Vercel cron at `/api/memory/dream-cycle` and the
 * GitHub Actions 12-hour fallback. Signature-verified via `serve()`.
 *
 * Companion route: `/api/memory/dream-cycle` is preserved for the dashboard
 * GET (pending buffer counts) and ad-hoc bearer-auth POSTs.
 */

import { serve } from "@upstash/workflow/nextjs";

import { createAdminClient } from "@/lib/insforge/admin";
import { runDreamCycle, shouldRunDreamCycle } from "@/lib/memory/dream-cycle";

type DreamCyclePayload = {
  userId?: string;
};

type DreamCycleResult = {
  userId: string;
  cycles: unknown;
};

export const { POST } = serve<DreamCyclePayload>(async (context) => {
  const { userId: targetUserId } = context.requestPayload ?? {};

  // ── Mode 1: on-demand single user ────────────────────────────────────────
  if (targetUserId) {
    const cycleResult = await context.run(`dream-${targetUserId}`, async () => {
      const shouldRun = await shouldRunDreamCycle(targetUserId);
      if (!shouldRun) return null;
      return runDreamCycle(targetUserId);
    });

    if (cycleResult === null) {
      return { mode: "on-demand", processed: 0, userId: targetUserId, skipped: true };
    }

    return {
      mode: "on-demand",
      processed: 1,
      results: [{ userId: targetUserId, cycles: cycleResult }],
    };
  }

  // ── Mode 2: scheduled sweeper across all users with pending buffer ───────
  const db = createAdminClient();

  const uniqueUsers = (await context.run("collect-active-users", async () => {
    const { data: activeUsers } = await db.database.from("memory_buffer")
      .select("user_id")
      .eq("processed", false)
      .limit(50);

    if (!activeUsers || activeUsers.length === 0) return [] as string[];

    return [...new Set(activeUsers.map((r) => r.user_id as string))];
  })) as string[];

  if (uniqueUsers.length === 0) {
    return { mode: "sweeper", processed: 0, message: "No pending buffers" };
  }

  const results: DreamCycleResult[] = [];

  for (const userId of uniqueUsers) {
    const cycleResult = await context.run(`dream-${userId}`, async () => {
      const shouldRun = await shouldRunDreamCycle(userId);
      if (!shouldRun) return null;
      return runDreamCycle(userId);
    });

    if (cycleResult !== null) {
      results.push({ userId, cycles: cycleResult });
    }
  }

  return { mode: "sweeper", processed: results.length, results };
});
