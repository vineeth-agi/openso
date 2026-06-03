import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";

/**
 * GET /api/cron/jobs
 *
 * Lists agent_cron_jobs rows for the dashboard /cron-jobs page.
 * Server-side because the table is RLS-enabled and the browser SDK
 * cannot authenticate cross-origin (httpOnly cookie + anon JWT).
 */
export async function GET() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.database
      .from("agent_cron_jobs")
      .select(
        "id, name, description, cron_expression, function_id, enabled, run_count, last_run_at, last_result, next_run_at, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[/api/cron/jobs] InsForge error", error);
      return NextResponse.json(
        { error: error.message ?? "Query failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    console.error("[/api/cron/jobs] threw", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
