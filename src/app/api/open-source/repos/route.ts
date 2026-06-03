import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { CACHE_KEYS, withCache } from "@/lib/redis";

/**
 * GET /api/open-source/repos
 *
 * Returns the open_source_repos catalog for the authenticated user.
 * Browser-side InsForge SDK calls would fail here because:
 *   1. The httpOnly insforge_access_token cookie cannot be read by JS.
 *   2. Browsers strip cookies on cross-origin requests to InsForge.
 *   3. open_source_repos is RLS-enabled so the anon JWT returns 0 rows.
 *
 * This same-origin endpoint reads the cookie server-side, validates
 * the session, then queries via the admin client (project_admin
 * bypasses RLS, which is fine for a user-facing catalog).
 *
 * Caching: the repo catalog is identical across users (no user-scoped
 * filtering) and is refreshed by the `open-issues-sync` workflow at
 * most a few times a day. We cache the response in Redis with a 6-hour
 * TTL and let the workflow bust the key when it finishes a sync. Auth
 * is still enforced on every request before we serve the cached body.
 */

const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

type RepoRow = {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  stars: number | null;
  forks: number | null;
  issues: number | null;
  language: string | null;
  language_color: string | null;
  tags: string[] | null;
  owner: string;
  avatar: string | null;
  yc_backed: boolean | null;
  last_commit_at: string | null;
  activity_level: string | null;
};

export async function GET() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  try {
    const { data, cached } = await withCache<RepoRow[]>(
      CACHE_KEYS.openSourceRepos,
      CACHE_TTL_SECONDS,
      async () => {
        const admin = createAdminClient();
        const { data, error } = await admin.database
          .from("open_source_repos")
          .select(
            "id, name, description, url, stars, forks, issues, language, language_color, tags, owner, avatar, yc_backed, last_commit_at, activity_level",
          )
          .order("name", { ascending: true });

        if (error) {
          // Throwing here means the cache write is skipped — only successful
          // payloads ever land in Redis.
          throw new Error(error.message ?? "Query failed");
        }

        return (data ?? []) as RepoRow[];
      },
    );

    const res = NextResponse.json({ data });
    // Lightweight diagnostic header — handy in DevTools to confirm hits.
    res.headers.set("X-Cache", cached ? "HIT" : "MISS");
    return res;
  } catch (err) {
    console.error("[/api/open-source/repos] threw", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
