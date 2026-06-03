/**
 * Daily Digest Workflow — runs every day at 08:00 UTC.
 *
 * Triggered by a QStash schedule pointing at this URL.
 */

import { serve } from "@upstash/workflow/nextjs";

import { createAdminClient } from "@/lib/insforge/admin";
import { sendNotification } from "@/lib/memory/notifications";
import { expireStaleMemories, searchFacts } from "@/lib/memory/store";

export const { POST } = serve(async (context) => {
  const db = createAdminClient();

  await context.run("expire-stale-memories", async () => {
    return { expired: await expireStaleMemories() };
  });

  const users = (await context.run("get-active-users", async () => {
    const { data } = await db.database.from("profiles")
      .select("id")
      .not("email", "is", null);
    return (data ?? []) as { id: string }[];
  })) as { id: string }[];

  if (users.length === 0) return { processed: 0 };

  let processed = 0;

  for (const user of users) {
    const sent = await context.run(`digest-${user.id}`, async () => {
      const parts: string[] = [];

      const recentFacts = await searchFacts(
        user.id,
        "today's priorities and upcoming deadlines",
        3,
      );
      if (recentFacts.length > 0) {
        parts.push(
          "Relevant memories: " + recentFacts.map((f) => f.fact).join("; "),
        );
      }

      if (parts.length === 0) return false;

      await sendNotification({
        userId: user.id,
        title: "Daily Digest",
        body: parts.join("\n\n"),
        channel: "in_app",
        priority: "medium",
        activityType: "email_digest",
      });
      return true;
    });

    if (sent) processed++;
  }

  return { processed };
});
