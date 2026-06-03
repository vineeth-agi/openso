import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { CACHE_KEYS, withCache } from "@/lib/redis";

/**
 * GET /api/open-source/issues
 *
 * Returns the open_source_issues feed for the authenticated user,
 * filtered to the "actionable" set the UI cares about (not locked,
 * not stale, not blocked, not duplicate, not needs-triage), with the
 * embedded repo joined via the FK relationship. Paginates the query
 * server-side to avoid the client touching InsForge directly (same
 * cross-origin / RLS reasons as `/api/open-source/repos`).
 *
 * Caching: this endpoint can return up to 10k rows and runs a JOIN on
 * every request. The data only changes when `open-issues-sync` fires
 * (hourly incremental, weekly full). We cache the assembled payload in
 * Redis with a 1-hour TTL and let the workflow bust the key when it
 * finishes. Auth is still validated on every request before serving
 * the cached body.
 */
const PAGE = 1000;
const MAX_PAGES = 10;
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

export async function GET() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  try {
    const { data, cached } = await withCache<unknown[]>(
      CACHE_KEYS.openSourceIssues,
      CACHE_TTL_SECONDS,
      async () => {
        const admin = createAdminClient();
        const all: unknown[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const from = page * PAGE;
          const { data, error } = await admin.database
            .from("open_source_issues")
            .select(
              `
              id, number, title, url, labels,
              difficulty, issue_type, has_help_wanted,
              is_assigned, has_open_pr, is_claimed_by_label, comment_count,
              body_length, reactions_plus_one, reactions_eyes, reactions_rocket,
              author_is_maintainer,
              has_code_block, has_reproduction_steps, has_screenshots, has_error_log,
              has_milestone, milestone_due_soon,
              estimated_minutes, expertise_required,
              has_bounty, bounty_amount,
              is_fresh, is_stuck_long_term,
              is_stale, is_blocked, is_duplicate, is_locked, is_needs_triage,
              created_at, updated_at,
              repo:open_source_repos!open_source_issues_repo_id_fkey (
                id, name, owner, avatar, language, stars,
                activity_level, license_type, contributing_url, is_trending,
                avg_first_response_hours, avg_pr_merge_hours
              )
              `,
            )
            .eq("is_locked", false)
            .eq("is_stale", false)
            .eq("is_blocked", false)
            .eq("is_duplicate", false)
            .eq("is_needs_triage", false)
            .order("updated_at", { ascending: false })
            .range(from, from + PAGE - 1);

          if (error) {
            // Throwing skips the cache write — partial / failed pages must
            // never be persisted.
            throw new Error(error.message ?? "Query failed");
          }

          const rows = data ?? [];
          all.push(...rows);
          if (rows.length < PAGE) break;
        }

        return all;
      },
    );

    const res = NextResponse.json({ data });
    res.headers.set("X-Cache", cached ? "HIT" : "MISS");
    return res;
  } catch (err) {
    console.error("[/api/open-source/issues] threw", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
