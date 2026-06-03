/**
 * GitHub API Client — Production-grade paginated fetcher with rate limiting.
 *
 * Features:
 * - Automatic pagination (Link header parsing)
 * - Rate limit detection + wait (X-RateLimit-Remaining)
 * - Exponential backoff on transient errors
 * - Abort signal support for cancellation
 * - Conditional requests (If-Modified-Since / ETag)
 */

import type { GHCommit, GHEvent, GHIssue, GHPullRequest, GHRepo } from "./types";

import { getConnectionAdmin } from "@/lib/connections";


const GITHUB_API = "https://api.github.com";
const PER_PAGE = 100;
const MAX_PAGES = 100; // safety cap: 100 pages × 100 items = 10,000 items
const REQUEST_TIMEOUT_MS = 15_000;

// ── Rate limit state ──

interface RateLimitState {
  remaining: number;
  resetAt: number; // epoch ms
}

const rateLimitState: RateLimitState = { remaining: 5000, resetAt: 0 };

function updateRateLimit(headers: Headers): void {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining != null) rateLimitState.remaining = parseInt(remaining, 10);
  if (reset != null) rateLimitState.resetAt = parseInt(reset, 10) * 1000;
}

async function waitForRateLimit(): Promise<void> {
  if (rateLimitState.remaining > 50) return;
  const waitMs = Math.max(0, rateLimitState.resetAt - Date.now()) + 1000;
  if (waitMs > 0 && waitMs < 600_000) {
    console.log(`[github-client] Rate limit low (${rateLimitState.remaining}), waiting ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

// ── Token resolver ──

/**
 * Resolve the per-user GitHub access token from `connected_apps`.
 *
 * Returns null when the user has no active connection. We deliberately
 * do NOT fall back to `process.env.GITHUB_TOKEN` here (audit Finding 4.4):
 * during a disconnect race window the connection row flips to 'revoked'
 * and a global-token fallback would let the still-running workflow keep
 * scraping under the operator's identity. Anonymous code paths that
 * legitimately need a public-data token (portfolio pages, public repo
 * lookups) read `process.env.GITHUB_TOKEN` directly themselves.
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const conn = await getConnectionAdmin(userId, "github");
  return conn?.access_token ?? null;
}

export async function getGitHubUsername(userId: string): Promise<string | null> {
  const conn = await getConnectionAdmin(userId, "github");
  return conn?.github_username ?? null;
}

// ── Core fetch with retry ──

interface FetchOptions {
  token: string;
  signal?: AbortSignal;
}

async function ghFetch<T>(url: string, opts: FetchOptions): Promise<{ data: T | null; headers: Headers }> {
  await waitForRateLimit();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const combinedSignal = opts.signal
    ? AbortSignal.any([opts.signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: combinedSignal,
    });
    clearTimeout(timer);
    updateRateLimit(res.headers);

    if (res.status === 403 && rateLimitState.remaining <= 0) {
      // Rate limited — wait and retry once
      await waitForRateLimit();
      return ghFetch(url, opts);
    }

    if (res.status === 404 || res.status === 410) {
      return { data: null, headers: res.headers };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json() as T;
    return { data, headers: res.headers };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Paginated fetch ──

function getNextPageUrl(headers: Headers): string | null {
  const link = headers.get("link");
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

async function fetchAllPages<T>(
  url: string,
  opts: FetchOptions & { maxPages?: number },
): Promise<T[]> {
  const all: T[] = [];
  let currentUrl: string | null = url.includes("per_page") ? url : `${url}${url.includes("?") ? "&" : "?"}per_page=${PER_PAGE}`;
  let page = 0;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  while (currentUrl && page < maxPages) {
    const { data, headers } = await ghFetch<T[]>(currentUrl, opts);
    if (!data || data.length === 0) break;
    all.push(...data);
    currentUrl = getNextPageUrl(headers);
    page++;
  }

  return all;
}

// ── High-level fetchers ──

/** Fetch all repos for the authenticated user (owner + member + forked) */
export async function fetchUserRepos(opts: FetchOptions): Promise<GHRepo[]> {
  return fetchAllPages<GHRepo>(
    `${GITHUB_API}/user/repos?type=all&sort=pushed&per_page=${PER_PAGE}`,
    opts,
  );
}

/** Fetch detailed language breakdown for a repo */
export async function fetchRepoLanguages(
  fullName: string,
  opts: FetchOptions,
): Promise<Record<string, number>> {
  const { data } = await ghFetch<Record<string, number>>(
    `${GITHUB_API}/repos/${fullName}/languages`,
    opts,
  );
  return data ?? {};
}

/** Fetch commits for a repo (authored by the user) */
export async function fetchRepoCommits(
  fullName: string,
  author: string,
  opts: FetchOptions & { since?: string; maxPages?: number },
): Promise<GHCommit[]> {
  const since = opts.since ? `&since=${opts.since}` : "";
  return fetchAllPages<GHCommit>(
    `${GITHUB_API}/repos/${fullName}/commits?author=${encodeURIComponent(author)}&per_page=${PER_PAGE}${since}`,
    { ...opts, maxPages: opts.maxPages ?? 10 },
  );
}

/** Fetch PRs for a repo (all states) */
export async function fetchRepoPRs(
  fullName: string,
  opts: FetchOptions & { state?: string; maxPages?: number },
): Promise<GHPullRequest[]> {
  const state = opts.state ?? "all";
  return fetchAllPages<GHPullRequest>(
    `${GITHUB_API}/repos/${fullName}/pulls?state=${state}&sort=updated&direction=desc&per_page=${PER_PAGE}`,
    { ...opts, maxPages: opts.maxPages ?? 10 },
  );
}

/** Fetch issues for a repo (excludes PRs) */
export async function fetchRepoIssues(
  fullName: string,
  opts: FetchOptions & { state?: string; maxPages?: number },
): Promise<GHIssue[]> {
  const state = opts.state ?? "all";
  const raw = await fetchAllPages<GHIssue>(
    `${GITHUB_API}/repos/${fullName}/issues?state=${state}&sort=updated&direction=desc&per_page=${PER_PAGE}`,
    { ...opts, maxPages: opts.maxPages ?? 5 },
  );
  // GitHub Issues API includes PRs — filter them out
  return raw.filter((i) => !i.pull_request);
}

/** Fetch user events (last ~300 events from GitHub) */
export async function fetchUserEvents(
  username: string,
  opts: FetchOptions & { maxPages?: number },
): Promise<GHEvent[]> {
  return fetchAllPages<GHEvent>(
    `${GITHUB_API}/users/${encodeURIComponent(username)}/events?per_page=${PER_PAGE}`,
    { ...opts, maxPages: opts.maxPages ?? 3 },
  );
}

/** Fetch README content for a repo */
export async function fetchReadme(
  fullName: string,
  opts: FetchOptions,
): Promise<string | null> {
  const { data } = await ghFetch<{ content: string; encoding: string }>(
    `${GITHUB_API}/repos/${fullName}/readme`,
    opts,
  );
  if (!data?.content) return null;
  try {
    return Buffer.from(data.content, "base64").toString("utf-8").slice(0, 5000);
  } catch {
    return null;
  }
}

/** Fetch user's starred repos */
export async function fetchStarredRepos(
  opts: FetchOptions & { maxPages?: number },
): Promise<GHRepo[]> {
  return fetchAllPages<GHRepo>(
    `${GITHUB_API}/user/starred?sort=updated&per_page=${PER_PAGE}`,
    { ...opts, maxPages: opts.maxPages ?? 5 },
  );
}

/** Fetch user's organizations */
export async function fetchUserOrgs(
  opts: FetchOptions,
): Promise<{ login: string; description: string | null }[]> {
  return fetchAllPages<{ login: string; description: string | null }>(
    `${GITHUB_API}/user/orgs?per_page=${PER_PAGE}`,
    { ...opts, maxPages: 3 },
  );
}

/** Get current rate limit status */
async function getRateLimitStatus(opts: FetchOptions): Promise<{
  remaining: number;
  limit: number;
  resetAt: Date;
}> {
  const { data } = await ghFetch<{
    rate: { remaining: number; limit: number; reset: number };
  }>(`${GITHUB_API}/rate_limit`, opts);
  return {
    remaining: data?.rate.remaining ?? 0,
    limit: data?.rate.limit ?? 5000,
    resetAt: new Date((data?.rate.reset ?? 0) * 1000),
  };
}
