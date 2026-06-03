/**
 * Memory Sync Workflow — event-driven.
 *
 * Trigger via:
 *   workflowClient.trigger({
 *     url: workflowUrl("memory-sync"),
 *     body: { userId, sources: ["github","email"] }
 *   })
 */

import { serve } from "@upstash/workflow/nextjs";

import {
  ingestGitHub,
} from "@/lib/memory/ingestors";
import { sendNotification } from "@/lib/memory/notifications";
import { buildProfile } from "@/lib/memory/profile";

type MemorySyncPayload = {
  userId: string;
  sources?: string[];
};

export const { POST } = serve<MemorySyncPayload>(async (context) => {
  const { userId, sources } = context.requestPayload;

  const allSources = sources ?? ["github"];
  const results: Record<string, { factsAdded: number }> = {};

  if (allSources.includes("github")) {
    results.github = await context.run("ingest-github", () =>
      ingestGitHub(userId),
    );
  }

  await context.run("rebuild-profile", () => buildProfile(userId));

  const totalFacts = Object.values(results).reduce(
    (sum, r) => sum + (r.factsAdded ?? 0),
    0,
  );

  await context.run("log-activity", () =>
    sendNotification({
      userId,
      title: "Memory Sync Complete",
      body: `Synced ${allSources.join(", ")} — ${totalFacts} new facts added.`,
      channel: "in_app",
      priority: "low",
      activityType: "memory_update",
      metadata: { results },
    }),
  );

  return { results, totalFacts };
});
