/**
 * Job-board chat tool — pgvector search over `job_board_listings`.
 *
 * Mirrors the architecture of `github_search_contributor_issues`:
 *   1. Embed the user's query with `voyage-code-3` (1024-dim).
 *   2. Stage 1 — call the `match_jobs` SQL RPC for top-50 candidates.
 *   3. Stage 2 — re-rank in TS using boosts (top company, fresh listing,
 *      salary disclosed, equity, etc.) and de-boosts (ghost listing,
 *      no salary disclosed, very old).
 *   4. Return the top-N as a structured payload the model can format
 *      into job cards.
 *
 * Used by the Vercel AI SDK chat route — see `app/api/chat/route.ts`
 * where `intent.needsJobBoardSearch` enables this tool.
 */

import { tool } from "ai";
import { z } from "zod";

import { createAdminClient } from "@/lib/insforge/admin";
import { voyageEmbedRaw } from "@/lib/memory/embeddings";

const VAGUE_QUERY_RE =
  /^(anything|something|any\s+job|whatever|surprise|find\s+me|give\s+me|pick\b|i\s+don.?t\s+know)/i;

type JobCandidate = {
  id: string;
  external_id: string;
  title: string;
  url: string;
  apply_url?: string | null;
  location_raw?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  is_remote?: boolean;
  is_hybrid?: boolean;
  is_onsite?: boolean;
  workplace_type?: string | null;
  department?: string | null;
  team?: string | null;
  category?: string | null;
  experience_level?: string | null;
  years_experience_min?: number | null;
  job_type?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_interval?: string | null;
  salary_raw?: string | null;
  has_equity?: boolean | null;
  skills?: string[] | null;
  tech_stack?: string[] | null;
  programming_languages?: string[] | null;
  visa_sponsorship?: string | null;
  benefits_detected?: string[] | null;
  posted_at?: string | null;
  last_seen_at?: string | null;
  is_likely_ghost?: boolean | null;
  company_id: string;
  company_name?: string | null;
  company_slug?: string | null;
  company_logo_url?: string | null;
  company_one_liner?: string | null;
  company_industry?: string | null;
  company_hq_location?: string | null;
  company_is_yc?: boolean | null;
  company_yc_batch?: string | null;
  company_is_top?: boolean | null;
  similarity?: number | null;
};

function daysSince(iso?: string | null): number {
  if (!iso) return 999;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function rerankScore(j: JobCandidate): number {
  return (
    (j.similarity ?? 0) * 1.0 +
    (j.company_is_top ? 0.15 : 0) +
    (j.company_is_yc ? 0.08 : 0) +
    (j.salary_max && j.salary_max > 0 ? 0.10 : 0) +
    (j.has_equity ? 0.05 : 0) +
    ((j.benefits_detected?.length ?? 0) >= 3 ? 0.05 : 0) +
    (daysSince(j.posted_at) <= 14 ? 0.10 : 0) +
    (daysSince(j.posted_at) <= 30 ? 0.05 : 0) -
    (j.is_likely_ghost ? 0.40 : 0) -
    (daysSince(j.last_seen_at) > 30 ? 0.20 : 0)
  );
}

export function buildJobBoardTools(_userId?: string) {
  const search_job_board_jobs = tool({
    description: `Search the curated job board (${"`"}job_board_listings${"`"}) — 7000+ live listings from ${"~"}70 top tech companies on Ashby/Greenhouse/Lever. Uses semantic search (voyage-code-3 embeddings) — understands meaning, not just keywords.
Use this for ANY query about: finding jobs, careers, hiring, openings, roles at specific companies, "jobs at YC startups", remote tech jobs, fintech engineer roles, etc.
Supports filters: programming language, experience level (intern/entry/mid/senior/staff), workplace (remote/hybrid/onsite), country, city, YC-only, minimum salary, specific company slug, visa sponsorship.`,
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "What kind of job the user wants, expressed semantically. E.g. 'senior backend engineer with Postgres', 'AI/ML researcher remote', 'data engineer at YC fintech'. Use 'software engineer' if user has no specific role.",
        ),
      experience_level: z
        .enum(["intern", "entry", "mid", "senior", "staff", "any"])
        .optional()
        .default("any")
        .describe(
          "intern = internships; entry = junior/new-grad/fresher (0-2 yrs); mid = 2-5 yrs; senior = 5+; staff = staff/principal/distinguished. 'any' = no filter. IMPORTANT: when user says 'fresher' or 'no experience' or 'new grad', set experience_level='entry' AND max_years_experience=0.",
        ),
      max_years_experience: z
        .number()
        .optional()
        .describe("Maximum years_experience_min allowed. Use 0 for 'fresher/no experience', 1 for '1 year max', etc. Omit for no cap."),
      workplace_type: z
        .enum(["remote", "hybrid", "onsite", "any"])
        .optional()
        .default("any")
        .describe("Filter by workplace mode."),
      category: z
        .enum([
          "engineering",
          "data",
          "design",
          "product",
          "devops",
          "security",
          "marketing",
          "sales",
          "support",
          "operations",
          "legal",
          "finance",
          "hr",
          "other",
          "any",
        ])
        .optional()
        .default("any")
        .describe("High-level role category."),
      country: z.string().optional().describe("Filter by country (e.g. 'United States', 'India'). ILIKE match."),
      city: z.string().optional().describe("Filter by city (e.g. 'San Francisco'). ILIKE match."),
      company_slug: z.string().optional().describe("Filter to one company by its slug (e.g. 'stripe', 'linear', 'vercel')."),
      is_yc: z.boolean().optional().describe("True = only YC-backed companies."),
      visa_sponsorship: z
        .enum(["yes", "no", "unknown", "any"])
        .optional()
        .default("any")
        .describe("Visa sponsorship filter."),
      min_salary: z.number().optional().describe("Minimum maximum-salary in USD (e.g. 150000)."),
      programming_languages: z
        .array(z.string())
        .optional()
        .describe("Filter to listings mentioning at least one of these languages (e.g. ['Python', 'Go'])."),
      offset: z.number().optional().default(0).describe("Pagination — set to current_count for 'show more'."),
      limit: z.number().optional().default(10).describe("Number of results to return."),
    }),

    execute: async ({
      query,
      experience_level,
      max_years_experience,
      workplace_type,
      category,
      country,
      city,
      company_slug,
      is_yc,
      visa_sponsorship,
      min_salary,
      programming_languages,
      offset = 0,
      limit = 10,
    }) => {
      try {
        const db = createAdminClient();

        // 1. Embed query with voyage-code-3
        let queryVector: number[] | null = null;
        if (!VAGUE_QUERY_RE.test(query) && query.length >= 4) {
          try {
            const vectors = await voyageEmbedRaw([query], "query", {
              model: "voyage-code-3",
              outputDimension: 1024,
            });
            queryVector = vectors[0] ?? null;
          } catch {
            // fall through; treated as no-vector below
          }
        }
        if (!queryVector) {
          return {
            jobs: [],
            total: 0,
            message: "Could not embed query. Try a more specific job description.",
          };
        }

        // 2. Stage 1: pgvector search
        const rpcParams: Record<string, unknown> = {
          query_embedding: queryVector,
          filter_category: category && category !== "any" ? category : null,
          filter_experience_level:
            experience_level && experience_level !== "any" ? experience_level : null,
          filter_workplace_type:
            workplace_type && workplace_type !== "any" ? workplace_type : null,
          filter_country: country ? `%${country}%` : null,
          filter_city: city ? `%${city}%` : null,
          filter_is_remote: workplace_type === "remote" ? true : null,
          filter_visa_sponsorship:
            visa_sponsorship && visa_sponsorship !== "any" ? visa_sponsorship : null,
          filter_company_slug: company_slug || null,
          filter_is_yc: typeof is_yc === "boolean" ? is_yc : null,
          filter_min_salary: min_salary || null,
          filter_languages:
            programming_languages && programming_languages.length > 0
              ? programming_languages
              : null,
          filter_skills: null,
          filter_max_age_days: 60,
          filter_exclude_ghost: true,
          filter_exclude_ids: null,
          match_count: 50,
          min_similarity: 0.10,
        };

        const { data: candidates, error } = await db.database.rpc(
          "match_jobs",
          rpcParams,
        );

        if (error) {
          console.error("[JobBoard] RPC error:", error.message);
          return {
            jobs: [],
            total: 0,
            message: "Search failed: " + error.message,
          };
        }

        if (!candidates || candidates.length === 0) {
          return {
            jobs: [],
            total: 0,
            message:
              "No matching jobs found. Try a broader query or remove filters (e.g. drop city, experience level).",
          };
        }

        // 3. Stage 2: TS re-ranking with boosts/penalties
        let filtered = candidates as JobCandidate[];

        // Post-filter: max_years_experience (for "fresher" queries)
        if (typeof max_years_experience === "number") {
          filtered = filtered.filter(
            (j) =>
              j.years_experience_min === null ||
              j.years_experience_min === undefined ||
              j.years_experience_min <= max_years_experience,
          );
        }

        const reranked = (filtered)
          .map((j) => ({ ...j, score: rerankScore(j) }))
          .sort((a, b) => b.score - a.score)
          .slice(offset, offset + limit);

        // 4. Format for the LLM
        const formatted = reranked.map((j) => {
          const salaryDisplay =
            j.salary_min && j.salary_max
              ? `${j.salary_currency ?? "USD"} ${j.salary_min.toLocaleString()}–${j.salary_max.toLocaleString()} / ${j.salary_interval ?? "year"}`
              : j.salary_raw ?? null;

          const locationDisplay = j.is_remote
            ? "Remote"
            : [j.city, j.state, j.country].filter(Boolean).join(", ") ||
              j.location_raw ||
              "Unspecified";

          return {
            id: j.id,
            title: j.title,
            url: j.url,
            apply_url: j.apply_url ?? j.url,
            company: {
              name: j.company_name,
              slug: j.company_slug,
              logo_url: j.company_logo_url,
              one_liner: j.company_one_liner,
              industry: j.company_industry,
              hq: j.company_hq_location,
              is_yc: j.company_is_yc,
              yc_batch: j.company_yc_batch,
              is_top_company: j.company_is_top,
            },
            location: locationDisplay,
            workplace: j.workplace_type ?? "unknown",
            department: j.department,
            category: j.category,
            experience_level: j.experience_level,
            job_type: j.job_type,
            salary: salaryDisplay,
            has_equity: j.has_equity ?? false,
            programming_languages: j.programming_languages ?? [],
            tech_stack: j.tech_stack ?? [],
            skills: j.skills ?? [],
            visa_sponsorship: j.visa_sponsorship ?? "unknown",
            benefits: j.benefits_detected ?? [],
            posted_at: j.posted_at,
            similarity: Math.round((j.similarity ?? 0) * 100) + "%",
          };
        });

        return {
          jobs: formatted,
          total_candidates: candidates.length,
          showing: `${offset + 1}-${offset + formatted.length} of ${candidates.length}`,
          filters_applied: {
            experience_level,
            workplace_type,
            category,
            country,
            city,
            company_slug,
            is_yc,
            visa_sponsorship,
            min_salary,
            programming_languages,
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[JobBoard] Error:", msg);
        return { jobs: [], total: 0, message: "Internal error: " + msg };
      }
    },
  });

  return { search_job_board_jobs };
}
