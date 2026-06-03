/**
 * GitHub Insight Workflow — runs every Monday at 09:00 UTC.
 */

import { serve } from "@upstash/workflow/nextjs";

import { createAdminClient } from "@/lib/insforge/admin";
import { ingestGitHub } from "@/lib/memory/ingestors";
import { sendNotification } from "@/lib/memory/notifications";

export const { POST } = serve(async (context) => {
  const db = createAdminClient();

  const users = (await context.run("get-github-users", async () => {
    const { data } = await db.database.from("profiles")
      .select("id, github_username, github_stats")
      .eq("github_connected", true)
      .not("github_username", "is", null);
    return (data ?? []) as Array<{
      id: string;
      github_username: string;
      github_stats: { total_repos?: number; total_stars?: number } | null;
    }>;
  })) as Array<{
    id: string;
    github_username: string;
    github_stats: { total_repos?: number; total_stars?: number } | null;
  }>;

  if (users.length === 0) return { processed: 0 };

  let processed = 0;
  for (const user of users) {
    await context.run(`insight-${user.id}`, async () => {
      const { factsAdded } = await ingestGitHub(user.id);
      const stats = user.github_stats;
      await sendNotification({
        userId: user.id,
        title: "Weekly GitHub Summary",
        body: `GitHub profile refreshed (${stats?.total_repos ?? 0} repos, ${stats?.total_stars ?? 0} stars). ${factsAdded} new insights captured.`,
        channel: "in_app",
        priority: "low",
        activityType: "github_insight",
      });
      return null;
    });
    processed++;
  }

  return { processed };
});
