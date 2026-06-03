/**
 * Workflow: Cleanup expired oauth_states rows.
 *
 * Schedule: declared in `src/lib/workflow/schedules.ts`; reconciled by
 * `scripts/sync-workflow-schedules.ts`.
 *
 * The `oauth_states` table accumulates rows for every aborted OAuth
 * flow (the row's TTL is 10 minutes for matching purposes; deletion
 * is separate). The migration declared the `cleanup_oauth_states()`
 * SECURITY DEFINER SQL function but never scheduled it, so the
 * table grew monotonically (audit Finding 4.5). This workflow
 * reconciles that.
 *
 * Auth: provided by `serve()` from `@upstash/workflow/nextjs` — every
 * incoming request must carry a valid QStash signature
 * (`QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`).
 */

import { serve } from "@upstash/workflow/nextjs";

import { createAdminClient } from "@/lib/insforge/admin";

export const { POST } = serve(async (context) => {
  await context.run("delete-expired", async () => {
    const db = createAdminClient();
    const { error } = await db.database.rpc("cleanup_oauth_states", {});
    if (error) {
      throw new Error(`cleanup_oauth_states failed: ${error.message}`);
    }
    return null;
  });
  return { ok: true };
});
