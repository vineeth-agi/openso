/**
 * Profile Rebuild Workflow — runs every Sunday at 03:00 UTC.
 */

import { serve } from "@upstash/workflow/nextjs";

import { createAdminClient } from "@/lib/insforge/admin";
import { buildProfile } from "@/lib/memory/profile";
import { expireStaleMemories } from "@/lib/memory/store";

export const { POST } = serve(async (context) => {
  const db = createAdminClient();

  const expired = await context.run("expire-stale", async () =>
    expireStaleMemories(),
  );

  const users = (await context.run("get-users", async () => {
    const { data } = await db.database.from("memory_facts")
      .select("user_id")
      .eq("is_latest", true);
    const unique = [...new Set((data ?? []).map((d) => d.user_id))];
    return unique.map((id) => ({ id })) as { id: string }[];
  })) as { id: string }[];

  if (users.length === 0) return { rebuilt: 0, expired };

  let rebuilt = 0;
  for (const user of users) {
    await context.run(`rebuild-${user.id}`, async () => {
      await buildProfile(user.id);
      return null;
    });
    rebuilt++;
  }

  return { rebuilt, expired };
});
