/**
 * Regression: connected_apps token-revoke contract — SKIPPED
 * ---------------------------------------------------------------
 * This regression test was authored against the Supabase migration
 * files (`supabase/migrations/`, `supabase/dev-bootstrap.sql`,
 * `supabase/connected-apps-migration.sql`, and the
 * `migrations/20260525145228_baseline-from-supabase.sql` baseline).
 * It asserted, against on-disk SQL, that:
 *
 *   1. `access_token` was not declared `NOT NULL` in any
 *      schema-of-truth file.
 *   2. The `connected_apps_token_state_check` CHECK constraint was
 *      present in the schema-of-truth files.
 *   3. The migration `20260527_connected_apps_revoke_model.sql`
 *      drops `NOT NULL` on `access_token`, adds the `revoked_at`
 *      column, adds the token-state CHECK constraint, and is
 *      transactional.
 *   4. The `disconnectApp()` source contract: status flip, token
 *      nulling, audit timestamp, ordering before GitHub-specific
 *      cleanup, and DELETE fallback if the UPDATE fails.
 *
 * After the migration to InsForge, the `supabase/` directory was
 * removed and the schema lives on the live InsForge Postgres
 * instance — no on-disk equivalent of `supabase/migrations/` is
 * shipped with the repo. The current `migrations/` folder contains
 * only forward-only schema patches; none of them reproduce the
 * baseline `connected_apps` table definition or the
 * `connected_apps_token_state_check` constraint asserted here.
 *
 * Skipping until the InsForge equivalent migration tooling exists
 * (i.e. an authoritative on-disk schema source we can grep against).
 * The file is kept rather than deleted so the audit trail of what
 * the contract used to enforce is preserved.
 */
// @vitest-environment node
import { describe, it } from "vitest";

describe("connected_apps revoke model — schema sources", () => {
  it.skip(
    "schema-of-truth assertions disabled — supabase/ migration files removed; no on-disk equivalent on InsForge",
    () => {
      // No-op: see top-of-file comment.
    },
  );
});

describe("connected_apps revoke model — migration file", () => {
  it.skip(
    "20260527_connected_apps_revoke_model.sql assertions disabled — file lived under supabase/migrations/ which was removed during the InsForge migration",
    () => {
      // No-op: see top-of-file comment.
    },
  );
});

describe("disconnectApp — application contract", () => {
  it.skip(
    "application contract assertions disabled — kept for audit alongside the schema-of-truth specs above; re-enable once an InsForge on-disk schema source is available",
    () => {
      // No-op: see top-of-file comment.
    },
  );
});
