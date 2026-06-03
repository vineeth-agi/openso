/**
 * Portfolio user resolver for the public recruiter chatbot.
 *
 * Resolves a `/portfolio/[username]` slug into the full bundle of data the
 * chat route needs from InsForge in a single shape so the route doesn't have
 * to re-query: portfolio config, resume, and (optional) GitHub OAuth token.
 *
 * Why the admin client?
 * --------------------
 * The recruiter is anonymous — there is no authenticated session — so the
 * normal RLS-protected client would block reads against `user_portfolios`,
 * `user_profiles`, and `connected_apps`. The admin client uses the service
 * role key and bypasses RLS. This is safe here because the resolver only
 * surfaces fields that are explicitly meant to be public (published
 * portfolio config, resume body, GitHub username) plus the OAuth token,
 * which never leaves the server — it is consumed by the GitHub tool builder
 * inside the same request and never serialized to the client.
 *
 * Lookup flow:
 * 1. `user_portfolios` by `username` AND `is_published = true` (single query
 *    so unpublished and missing slugs are indistinguishable to the route —
 *    matches error matrix rows #3 and #4 in the design).
 * 2. If (1) fails, return `null` immediately. Skip every downstream read.
 * 3. Otherwise, in parallel via `Promise.all`:
 *      - `user_profiles.resume_structured`
 *      - `connected_apps` with `provider = "github"` and `status = "active"`
 *    Both reads are optional. Any database error or missing row is silently
 *    coerced to `null` — a candidate without a resume or without a connected
 *    GitHub account is still a valid published portfolio that should serve
 *    chat traffic. The data assembler downstream uses what is available.
 *
 * See `.kiro/specs/portfolio-recruiter-chatbot/design.md`
 *  - "Components and Interfaces" → User Resolver Module
 *  - "Failure Matrix" rows #3, #4, #6, #9
 *  - Property 3 (Username resolver correctness)
 *  - Requirements 2.2, 2.3, 2.4, 4.2, 10.1, 10.2
 *
 * NOTE: Pure server code. Do not import this from a client component.
 */

import type {
  PortfolioSiteConfig,
  ResolvedUser,
  ResumeStructured,
} from "./types";

import { getConnectionAdmin } from "@/lib/connections";
import { createAdminClient } from "@/lib/insforge/admin";


// ── Internal row shapes (narrow, only the columns we select) ───────────────

interface PortfolioRow {
  user_id: string;
  site_config: unknown;
}

interface UserProfileRow {
  resume_structured: unknown;
}

interface GithubConnectionRow {
  access_token: string | null;
  github_username: string | null;
}

/**
 * Resolve a portfolio username to the data bundle the chat route needs.
 *
 * Returns `null` for any of:
 *   - Unknown username
 *   - Username belongs to an unpublished portfolio (`is_published = false`)
 *   - Database error during the portfolio lookup
 *
 * Optional reads (resume, GitHub connection) never cause `null` — missing
 * rows or read errors degrade to `null` fields on the returned `ResolvedUser`.
 */
export async function resolvePortfolioUser(
  username: string,
): Promise<ResolvedUser | null> {
  if (!username) return null;

  const db = createAdminClient();

  // ── 1. Portfolio lookup (gated on is_published) ─────────────────────────
  //
  // `.maybeSingle()` returns `data: null` instead of throwing when no row
  // matches, which is exactly what we want here: unknown and unpublished
  // collapse to the same `null` outcome without distinguishing log lines.
  const { data: portfolio, error: portfolioError } = await db.database.from("user_portfolios")
    .select("user_id, site_config")
    .eq("username", username)
    .eq("is_published", true)
    .maybeSingle<PortfolioRow>();

  if (portfolioError || !portfolio) return null;
  if (!portfolio.site_config) return null;

  const userId = portfolio.user_id;
  const portfolioConfig = portfolio.site_config as unknown as PortfolioSiteConfig;

  // ── 2. Optional reads in parallel ───────────────────────────────────────
  //
  // Both branches catch database errors and return `null` so a transient
  // failure on one optional source never breaks resolution. The tool builder
  // and prompt builder downstream already handle null inputs gracefully
  // (Failure Matrix rows #6 and #9 in the design).
  const [resumeStructured, githubConnection] = await Promise.all([
    fetchResumeStructured(db, userId),
    fetchGithubConnection(db, userId),
  ]);

  return {
    userId,
    username,
    resumeStructured,
    portfolioConfig,
    githubToken: githubConnection?.access_token ?? null,
    githubUsername: githubConnection?.github_username ?? null,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Fetch the candidate's `user_profiles.resume_structured` JSON.
 * Returns `null` for missing rows, missing column, or any database error.
 * Never throws.
 */
async function fetchResumeStructured(
  db: AdminClient,
  userId: string,
): Promise<ResumeStructured | null> {
  try {
    const { data, error } = await db.database.from("user_profiles")
      .select("resume_structured")
      .eq("user_id", userId)
      .maybeSingle<UserProfileRow>();

    if (error || !data || !data.resume_structured) return null;
    return data.resume_structured as unknown as ResumeStructured;
  } catch {
    return null;
  }
}

/**
 * Fetch the candidate's active GitHub OAuth connection.
 *
 * Routes through `getConnectionAdmin` so the access_token column is
 * decrypted via `decryptConnectionRow` before it leaves the resolver
 * (DB-HIGH-01). The previous direct `from("connected_apps").select(...)`
 * read raw ciphertext for any `enc:v1:`-wrapped row, which then failed
 * silently as a malformed bearer token in the GitHub tool builder.
 *
 * Filters: `user_id`, `provider = "github"`, `status = "active"` — the
 * filter is applied inside `getConnectionAdmin` itself.
 *
 * Preserves the original "fail open silently" semantics: any error or
 * missing row returns `null`, never throws. Callers (the public
 * recruiter chat) tolerate `null` (a candidate without GitHub linked is
 * still a valid published portfolio).
 */
async function fetchGithubConnection(
  _db: AdminClient,
  userId: string,
): Promise<GithubConnectionRow | null> {
  try {
    const conn = await getConnectionAdmin(userId, "github");
    if (!conn) return null;
    return {
      access_token: conn.access_token ?? null,
      github_username: conn.github_username ?? null,
    };
  } catch {
    return null;
  }
}
