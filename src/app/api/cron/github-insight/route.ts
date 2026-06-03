/**
 * Cron: GitHub Insight — called by Cloudflare Workers Cron at 9 AM Monday
 *
 * Weekly re-ingest of GitHub data + insight notification for connected users.
 */
import { NextRequest, NextResponse } from "next/server";

import { verifyCronAuth } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/insforge/admin";
import { ingestGitHub } from "@/lib/memory/ingestors";
import { sendNotification } from "@/lib/memory/notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const db = createAdminClient();

  const { data: users } = await db.database.from("profiles")
    .select("id, github_username, github_stats")
    .eq("github_connected", true)
    .not("github_username", "is", null);

  if (!users || users.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;

  for (const user of users) {
    try {
      const { factsAdded } = await ingestGitHub(user.id);
      const stats = user.github_stats as { total_repos?: number; total_stars?: number } | null;

      await sendNotification({
        userId: user.id,
        title: "Weekly GitHub Summary",
        body: `GitHub profile refreshed (${stats?.total_repos ?? 0} repos, ${stats?.total_stars ?? 0} stars). ${factsAdded} new insights captured.`,
        channel: "in_app",
        priority: "low",
        activityType: "github_insight",
      });
      processed++;
    } catch (err) {
      console.error(`[cron/github-insight] Error for user ${user.id}:`, err);
    }
  }

  return NextResponse.json({ processed });
}
