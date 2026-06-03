// POST /api/memory/dream-cycle — trigger async memory processing
// Called by cron (Upstash Workflow or Vercel Cron) every 10 minutes

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { runDreamCycle, shouldRunDreamCycle } from "@/lib/memory/dream-cycle";
import { timingSafeEqualStr } from "@/lib/security/timing-safe";

export async function POST(req: Request) {
  try {
    // Require CRON_SECRET in every environment (Finding 11 — previously
    // we fell through silently when CRON_SECRET was unset in non-production,
    // which let any preview / staging URL accept unauthenticated requests).
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error("[dream-cycle-api] CRON_SECRET not set — rejecting request.");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !timingSafeEqualStr(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = (await req.json().catch(() => ({}))) as { userId?: string };

    // If specific user requested, process just that user
    if (userId) {
      const result = await runDreamCycle(userId);
      return NextResponse.json({ processed: 1, userId, results: result });
    }

    // Otherwise, find all users with pending buffer messages
    const db = createAdminClient();
    const { data: activeUsers } = await db.database.from("memory_buffer")
      .select("user_id")
      .eq("processed", false)
      .limit(50);

    if (!activeUsers || activeUsers.length === 0) {
      return NextResponse.json({ processed: 0, message: "No pending buffers" });
    }

    // Deduplicate user IDs
    const uniqueUsers = [...new Set(activeUsers.map((r) => r.user_id as string))];

    const results: Record<string, unknown>[] = [];
    for (const uid of uniqueUsers) {
      const shouldRun = await shouldRunDreamCycle(uid);
      if (shouldRun) {
        const cycleResults = await runDreamCycle(uid);
        results.push({ userId: uid, cycles: cycleResults });
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    console.error("[dream-cycle-api] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}

// GET — check pending buffer counts
export async function GET() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user, db } = auth;

  const { count } = await db.database.from("memory_buffer")
    .select("*", { count: "exact", head: true })
    .eq("processed", false)
    .eq("user_id", user.id);

  const { data: recentLogs } = await db.database.from("memory_dream_log")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    pendingBufferMessages: count ?? 0,
    recentDreamCycles: recentLogs ?? [],
  });
}
