import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { CACHE_KEYS, stableQueryKey, withCache } from "@/lib/redis";
import { safeErrorResponse } from "@/lib/security/safe-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs — Fetch job board listings with company data
 * Supports filters: category, experience_level, workplace_type, is_yc,
 * country (single value or comma-separated list for multi-select).
 *
 * Caching: each unique combination of (filters, page) is cached in
 * Redis under a hash of its query params with a 15-minute TTL. The
 * Job Board page is read-heavy, listings only refresh when new ones
 * are ingested, and 15 minutes is a comfortable freshness window for
 * a careers feed. Auth still runs on every request before we serve
 * the cached body. To wipe everything (e.g. after an ingestion run),
 * call `cacheDelByPattern("jobs:list:v1*")`.
 */

const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

type JobsResponse = {
  jobs: unknown[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
  };
};

export async function GET(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const experience = searchParams.get("experience_level");
  const workplace = searchParams.get("workplace_type");
  const isYc = searchParams.get("is_yc");
  const country = searchParams.get("country");
  const search = searchParams.get("search");

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = Math.max(1, Number(searchParams.get("limit") ?? "24"));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Country can be comma-separated to allow multi-select location filtering.
  // We split, trim, drop empties, and normalize "all" → no filter.
  const countryList =
    country && country.trim() !== "" && country !== "all"
      ? country
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c !== "" && c !== "all")
      : [];

  // Build a stable cache key from the normalised filter set. We pass the
  // already-cleaned `countryList` (sorted by `stableQueryKey`) instead of
  // the raw `country` string so `?country=US,IN` and `?country=IN,US`
  // hash to the same entry.
  const cacheKey = stableQueryKey(CACHE_KEYS.jobsListPrefix, {
    category: category && category !== "all" ? category : null,
    experience: experience && experience !== "all" ? experience : null,
    workplace: workplace && workplace !== "all" ? workplace : null,
    is_yc: isYc === "true" ? "1" : null,
    country: countryList,
    search: search?.trim() || null,
    page,
    limit,
  });

  try {
    const { data, cached } = await withCache<JobsResponse>(
      cacheKey,
      CACHE_TTL_SECONDS,
      async () => {
        const admin = createAdminClient();
        let query = admin
          .database.from("job_board_listings")
          .select(`
            id, title, url, apply_url,
            location_raw, city, state, country,
            is_remote, workplace_type,
            department, category, experience_level, job_type,
            salary_min, salary_max, salary_currency, salary_raw,
            has_equity, skills, tech_stack, programming_languages,
            visa_sponsorship, posted_at, first_seen_at, last_seen_at,
            days_listed, is_likely_ghost, benefits_detected,
            company_id,
            job_board_companies (
              name, slug, logo_url, one_liner, industry, team_size, stage,
              is_yc, yc_batch, hq_location, tags
            )
          `, { count: "exact" })
          .eq("is_active", true)
          .eq("is_likely_ghost", false)
          .order("posted_at", { ascending: false })
          .range(from, to);

        if (category && category !== "all") query = query.eq("category", category);
        if (experience && experience !== "all") query = query.eq("experience_level", experience);
        if (workplace && workplace !== "all") query = query.eq("workplace_type", workplace);
        if (countryList.length === 1) {
          query = query.eq("country", countryList[0]);
        } else if (countryList.length > 1) {
          query = query.in("country", countryList);
        }
        if (isYc === "true") query = query.eq("job_board_companies.is_yc", true);
        if (search && search.trim() !== "") {
          const s = `%${search.trim()}%`;
          query = query.or(`title.ilike.${s},location_raw.ilike.${s}`);
        }

        const { data, error, count } = await query;

        if (error) {
          // Throwing skips the cache write — only successful query results
          // are persisted.
          const wrapped = new Error(error.message ?? "Query failed");
          (wrapped as { cause?: unknown }).cause = error;
          throw wrapped;
        }

        const totalCount = count ?? 0;
        const totalPages = Math.ceil(totalCount / limit);

        return {
          jobs: data ?? [],
          pagination: {
            page,
            limit,
            totalCount,
            totalPages,
            hasMore: totalCount > to + 1,
          },
        };
      },
    );

    const res = NextResponse.json(data);
    res.headers.set("X-Cache", cached ? "HIT" : "MISS");
    return res;
  } catch (err) {
    return safeErrorResponse(err, { scope: "/api/jobs", status: 500 });
  }
}
