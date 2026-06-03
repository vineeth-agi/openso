import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { CACHE_KEYS, withCache } from "@/lib/redis";
import { safeErrorResponse } from "@/lib/security/safe-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/countries — Distinct, non-null country values across
 * active (non-ghost) job listings. Used to populate the Location
 * multi-select on the Job Board page.
 *
 * The InsForge SDK doesn't expose a DISTINCT primitive, so we pull a
 * capped page of country values from the indexed `country` column
 * (idx_jbl_country) and dedupe in JS. The set of distinct country
 * codes is bounded (low hundreds), so 5000 rows is comfortably enough
 * even with very lopsided distributions.
 *
 * Caching: this list barely changes across days. We cache it in Redis
 * with a 24-hour TTL — the listings ingestion pipeline can bust the
 * key when new countries appear. Auth is validated on every request
 * before serving the cached payload.
 */

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export async function GET() {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { data: countries, cached } = await withCache<string[]>(
      CACHE_KEYS.jobsCountries,
      CACHE_TTL_SECONDS,
      async () => {
        const admin = createAdminClient();
        const { data, error } = await admin.database
          .from("job_board_listings")
          .select("country")
          .eq("is_active", true)
          .eq("is_likely_ghost", false)
          .not("country", "is", null)
          .limit(5000);

        if (error) {
          // Surface the InsForge error up to the caller so the outer
          // handler can return a structured `safeErrorResponse`.
          const wrapped = new Error(error.message ?? "Query failed");
          (wrapped as { cause?: unknown }).cause = error;
          throw wrapped;
        }

        const set = new Set<string>();
        for (const row of (data ?? []) as Array<{ country: string | null }>) {
          const c = row.country?.trim();
          if (c) set.add(c);
        }

        return Array.from(set).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" }),
        );
      },
    );

    const res = NextResponse.json({ countries });
    res.headers.set("X-Cache", cached ? "HIT" : "MISS");
    return res;
  } catch (err) {
    return safeErrorResponse(err, { scope: "/api/jobs/countries", status: 500 });
  }
}
