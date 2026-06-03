/**
 * On-demand GitHub API tools for the Portfolio Recruiter Chatbot.
 *
 * Builds three Vercel AI SDK tools (`get_repo_file_tree`, `get_file_content`,
 * `get_repo_details`) registered with `streamText` when the candidate has a
 * stored GitHub OAuth token. The model invokes them when the recruiter asks
 * about specific code, file structure, or implementation details that are
 * NOT pre-indexed in GitHub Memory.
 *
 * Design constraints (see `.kiro/specs/portfolio-recruiter-chatbot/design.md`
 *  - "Components and Interfaces" → "4. GitHub Tools Builder"
 *  - "Failure Matrix" → rows #10, #11, #12
 *  - Properties 6 and 9):
 *
 *  1. Allowlist enforcement. Every tool accepts a `repo` argument in
 *     `owner/name` form. The route passes `allowedRepos` derived from the
 *     candidate's GitHub Memory, so the model can only browse repositories
 *     it has indexed evidence for. Calls outside the allowlist short-circuit
 *     to `{ ok: false, error: "repo_not_allowed" }` WITHOUT issuing an HTTP
 *     request.
 *
 *  2. Authentication. Every outbound request sends
 *     `Authorization: Bearer <token>` and `Accept: application/vnd.github+json`
 *     so GitHub treats the call as the candidate (private repos and higher
 *     rate limits).
 *
 *  3. Total error containment. Tool `execute()` MUST NOT throw — it always
 *     resolves to a serializable object. The model receives a structured
 *     `{ ok: false, error, ... }` payload and continues the conversation,
 *     which keeps the stream open even when GitHub is down.
 *
 *  4. Stable error codes. The route's logging and the model's user-facing
 *     fallback messages branch on these codes:
 *
 *       - `repo_not_allowed`     — repo outside the allowlist
 *       - `github_token_expired` — 401 from GitHub
 *       - `github_rate_limited`  — 403 with `X-RateLimit-Remaining: 0`
 *                                  (`retryAfter` derived from `X-RateLimit-Reset`)
 *       - `not_found`            — 404 from GitHub
 *       - `github_api_error`     — 5xx, network, or any other failure
 *
 *  5. No octokit. Uses `fetch` directly. The Next.js Node runtime supports
 *     the global `fetch`, and we want fine-grained control over headers and
 *     error parsing without pulling another dependency into the public route.
 */

import { tool } from "ai";
import { z } from "zod";

import type { PortfolioGithubTools } from "./types";

// ── Constants ──────────────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com";

/**
 * Headers attached to every GitHub REST request issued by these tools.
 *
 * STRICT TOKEN RULE (Issue #8):
 *   - The `token` is OPERATOR-OWNED (server PAT) — NEVER a user OAuth token.
 *   - When `token` is empty the request is sent UNAUTHENTICATED. GitHub's
 *     public REST API still serves public repo data without auth (subject
 *     to a 60 req/h IP-shared rate limit), which is acceptable for a
 *     low-volume public chatbot. This is the documented fallback path.
 *   - We never include a user's `gho_*` token here. Any path that would
 *     have to do so should already have been filtered upstream in
 *     `route.ts`.
 */
function buildHeaders(token: string): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "portfolio-chat/1.0",
  };
  if (token && token.length > 0) {
    (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return headers;
}

// ── Result types (informational — encoded as serializable objects) ────────
//
// We intentionally type these via the tool result shape rather than exposing
// a discriminated union on the public surface. The model sees JSON; the
// route logs the `error` field; nothing in the codebase needs to import the
// success/failure types.

type ToolResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: GithubToolError; message?: string; retryAfter?: number };

type GithubToolError =
  | "repo_not_allowed"
  | "github_token_expired"
  | "github_rate_limited"
  | "not_found"
  | "github_api_error";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Issue a GitHub REST request with the operator PAT. If the response is
 * a 401/403 (token expired / abuse-flagged / rate-limited), AND we
 * actually had a token, retry ONCE without authentication so the public
 * API can still serve the request. This is the "PAT fails ⇒ fallback
 * to official GitHub public APIs" rule from Issue #8.
 *
 * Returns the raw `Response` so the caller can map status codes to its
 * existing `mapErrorResponse` logic without changes.
 */
async function fetchWithFallback(
  url: string,
  token: string,
): Promise<Response> {
  const initialHeaders = buildHeaders(token);
  const initialResp = await fetch(url, { headers: initialHeaders });

  // If we sent a token AND got 401/403, retry unauthenticated. Only retry
  // for these status codes — a 404 / 5xx / 422 is a real API answer and
  // should not be retried.
  if ((initialResp.status === 401 || initialResp.status === 403) && token) {
    try {
      const fallbackResp = await fetch(url, { headers: buildHeaders("") });
      // Only return the fallback if it's a better answer.
      if (fallbackResp.ok) return fallbackResp;
      // If fallback also fails, return whichever has the more informative
      // status (prefer the original to preserve the original error code).
      return initialResp;
    } catch {
      return initialResp;
    }
  }
  return initialResp;
}

/**
 * Validate that `repo` (in `owner/name` form) appears in `allowedRepos`.
 * Comparison is case-insensitive because GitHub treats owner/repo names
 * case-insensitively even though the canonical casing is preserved on the
 * platform. Also supports `owner/*` wildcard to allow all public repos
 * from a specific user.
 */
function isRepoAllowed(repo: string, allowedRepos: string[]): boolean {
  const trimmed = repo.trim().toLowerCase();
  if (!trimmed.includes("/")) return false;
  const [owner] = trimmed.split("/");
  for (const allowed of allowedRepos) {
    if (typeof allowed !== "string") continue;
    const normalizedAllowed = allowed.trim().toLowerCase();
    // Exact match
    if (normalizedAllowed === trimmed) return true;
    // Wildcard match: "owner/*" allows any repo from that owner
    if (normalizedAllowed.endsWith("/*") && normalizedAllowed.slice(0, -2) === owner) {
      return true;
    }
  }
  return false;
}

/**
 * Split an `owner/name` string into its two components. Caller is expected
 * to have already validated the format via `isRepoAllowed`.
 */
function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, ...rest] = repo.trim().split("/");
  return { owner, name: rest.join("/") };
}

/**
 * Map a GitHub HTTP response (or a thrown network error) to one of our
 * stable error codes. Only invoked from inside `execute()` `try/catch`
 * blocks so the tool surface never throws.
 */
async function mapErrorResponse(
  res: Response,
): Promise<Extract<ToolResult<unknown>, { ok: false }>> {
  if (res.status === 401) {
    return { ok: false, error: "github_token_expired" };
  }
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = res.headers.get("x-ratelimit-reset");
      const retryAfter = parseRetryAfter(reset);
      return { ok: false, error: "github_rate_limited", retryAfter };
    }
    // 403s without exhausted rate limit (e.g. SSO required, abuse detection)
    // surface as a generic API error so the model can fall back to memory.
    const message = await safeText(res);
    return { ok: false, error: "github_api_error", message };
  }
  if (res.status === 404) {
    return { ok: false, error: "not_found" };
  }
  // 5xx and anything else
  const message = await safeText(res);
  return { ok: false, error: "github_api_error", message };
}

/**
 * Convert GitHub's `X-RateLimit-Reset` (epoch seconds) into a positive
 * integer number of seconds to wait. Returns `60` as a safe default if the
 * header is missing or unparseable.
 */
function parseRetryAfter(resetHeader: string | null): number {
  if (!resetHeader) return 60;
  const resetEpochSeconds = Number.parseInt(resetHeader, 10);
  if (!Number.isFinite(resetEpochSeconds)) return 60;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const diff = resetEpochSeconds - nowSeconds;
  if (diff <= 0) return 1;
  return diff;
}

/** Read a Response body as text without throwing — clipped to 200 chars. */
async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

/** Normalise any thrown value into a stable shape for the model. */
function networkErrorResult(
  err: unknown,
): Extract<ToolResult<unknown>, { ok: false }> {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "network error";
  return { ok: false, error: "github_api_error", message: message.slice(0, 200) };
}

// ── Builder ────────────────────────────────────────────────────────────────

/**
 * Build the on-demand GitHub tool set scoped to a single candidate.
 *
 * @param token         The candidate's GitHub OAuth token from
 *                      `connected_apps.access_token`. Sent verbatim in the
 *                      `Authorization` header on every outbound call.
 * @param allowedRepos  `owner/name` allowlist (typically the candidate's
 *                      indexed repos from GitHub Memory). Tool calls outside
 *                      this list short-circuit before any HTTP request.
 *
 * @returns Object with `get_repo_file_tree`, `get_file_content`, and
 *          `get_repo_details` keyed exactly as named — these are the names
 *          the model is told it can call in the system prompt.
 */
export function buildPortfolioGithubTools(
  token: string,
  allowedRepos: string[],
): PortfolioGithubTools {
  // ── 1. get_repo_file_tree ────────────────────────────────────────────────

  const get_repo_file_tree = tool({
    description:
      "Fetch the recursive file tree of one of the candidate's repositories. " +
      "Use this to discover what files exist before reading a specific one. " +
      "The `repo` argument MUST be in `owner/name` form and MUST be one of " +
      "the candidate's indexed repositories. Returns a list of file paths " +
      "and their types (`blob` for files, `tree` for directories).",
    inputSchema: z.object({
      repo: z
        .string()
        .describe("Repository in `owner/name` form (e.g. `octocat/hello-world`)"),
      branch: z
        .string()
        .optional()
        .describe(
          "Branch, tag, or commit SHA. Defaults to the repo's default branch.",
        ),
    }),
    execute: async ({ repo, branch }) => {
      if (!isRepoAllowed(repo, allowedRepos)) {
        return { ok: false, error: "repo_not_allowed" } as const;
      }

      const { owner, name } = splitRepo(repo);
      const ref = branch && branch.trim().length > 0 ? branch.trim() : "HEAD";

      try {
        const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
        const res = await fetchWithFallback(url, token);
        if (!res.ok) {
          return await mapErrorResponse(res);
        }
        const data = (await res.json()) as {
          sha?: string;
          truncated?: boolean;
          tree?: { path: string; type: string; size?: number }[];
        };
        return {
          ok: true,
          repo,
          ref,
          truncated: Boolean(data.truncated),
          entries: (data.tree ?? []).map((entry) => ({
            path: entry.path,
            type: entry.type, // "blob" or "tree"
            size: entry.size ?? null,
          })),
        } as const;
      } catch (err) {
        return networkErrorResult(err);
      }
    },
  });

  // ── 2. get_file_content ──────────────────────────────────────────────────

  const get_file_content = tool({
    description:
      "Read the full text content of a single file from one of the " +
      "candidate's repositories. Use this AFTER `get_repo_file_tree` to " +
      "inspect specific implementation details. The `repo` argument MUST be " +
      "in `owner/name` form and MUST be one of the candidate's indexed " +
      "repositories. Returns the decoded file text (UTF-8) along with the " +
      "resolved ref and SHA.",
    inputSchema: z.object({
      repo: z
        .string()
        .describe("Repository in `owner/name` form (e.g. `octocat/hello-world`)"),
      path: z.string().describe("Path to the file within the repository."),
      ref: z
        .string()
        .optional()
        .describe(
          "Branch, tag, or commit SHA. Defaults to the repo's default branch.",
        ),
    }),
    execute: async ({ repo, path, ref }) => {
      if (!isRepoAllowed(repo, allowedRepos)) {
        return { ok: false, error: "repo_not_allowed" } as const;
      }

      const { owner, name } = splitRepo(repo);
      const trimmedPath = path.replace(/^\/+/, "");
      const refQuery =
        ref && ref.trim().length > 0
          ? `?ref=${encodeURIComponent(ref.trim())}`
          : "";

      try {
        const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${trimmedPath
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/")}${refQuery}`;
        const res = await fetchWithFallback(url, token);
        if (!res.ok) {
          return await mapErrorResponse(res);
        }
        const data = (await res.json()) as
          | {
              type: "file";
              content?: string;
              encoding?: string;
              sha?: string;
              size?: number;
              path?: string;
            }
          | { type: string };

        if ((data as { type: string }).type !== "file") {
          // Path resolved to a directory or symlink — the model should call
          // `get_repo_file_tree` instead. Surface a 404-equivalent so we
          // never accidentally return raw directory listings here.
          return { ok: false, error: "not_found" } as const;
        }

        const fileData = data as {
          type: "file";
          content?: string;
          encoding?: string;
          sha?: string;
          size?: number;
          path?: string;
        };

        let text = "";
        if (fileData.encoding === "base64" && typeof fileData.content === "string") {
          try {
            text = Buffer.from(fileData.content, "base64").toString("utf-8");
          } catch (err) {
            return networkErrorResult(err);
          }
        } else if (typeof fileData.content === "string") {
          text = fileData.content;
        }

        return {
          ok: true,
          repo,
          path: fileData.path ?? trimmedPath,
          ref: ref?.trim() || null,
          sha: fileData.sha ?? null,
          size: fileData.size ?? text.length,
          content: text,
        } as const;
      } catch (err) {
        return networkErrorResult(err);
      }
    },
  });

  // ── 3. get_repo_details ──────────────────────────────────────────────────

  const get_repo_details = tool({
    description:
      "Fetch metadata and the README for one of the candidate's repositories. " +
      "Use this for high-level questions about a project (purpose, languages, " +
      "stars, last update). The `repo` argument MUST be in `owner/name` form " +
      "and MUST be one of the candidate's indexed repositories.",
    inputSchema: z.object({
      repo: z
        .string()
        .describe("Repository in `owner/name` form (e.g. `octocat/hello-world`)"),
    }),
    execute: async ({ repo }) => {
      if (!isRepoAllowed(repo, allowedRepos)) {
        return { ok: false, error: "repo_not_allowed" } as const;
      }

      const { owner, name } = splitRepo(repo);

      try {
        const repoUrl = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
        const repoRes = await fetchWithFallback(repoUrl, token);
        if (!repoRes.ok) {
          return await mapErrorResponse(repoRes);
        }
        // STRICT REQUIREMENT (Issue #4): even with the allowlist gate,
        // double-check that this repo is NOT private. A repo could be
        // public at allowlist-build time and turn private later; the
        // tool must refuse to surface metadata in that case.
        const repoData = (await repoRes.json()) as {
          full_name?: string;
          description?: string | null;
          language?: string | null;
          stargazers_count?: number;
          forks_count?: number;
          open_issues_count?: number;
          default_branch?: string;
          html_url?: string;
          homepage?: string | null;
          topics?: string[];
          pushed_at?: string;
          updated_at?: string;
          archived?: boolean;
          fork?: boolean;
          private?: boolean;
          visibility?: string;
        };
        if (repoData.private === true || repoData.visibility === "private") {
          return { ok: false, error: "not_found" } as const;
        }

        // README is best-effort: a missing README MUST NOT fail the whole
        // call. We swallow non-OK responses for this secondary fetch.
        let readme: string | null = null;
        try {
          const readmeRes = await fetchWithFallback(`${repoUrl}/readme`, token);
          if (readmeRes.ok) {
            const readmeData = (await readmeRes.json()) as {
              content?: string;
              encoding?: string;
            };
            if (
              readmeData.encoding === "base64" &&
              typeof readmeData.content === "string"
            ) {
              try {
                readme = Buffer.from(readmeData.content, "base64").toString(
                  "utf-8",
                );
              } catch {
                readme = null;
              }
            } else if (typeof readmeData.content === "string") {
              readme = readmeData.content;
            }
          }
          // 404 / 401 / 403 on README: silently fall through with readme=null.
        } catch {
          readme = null;
        }

        return {
          ok: true,
          repo: repoData.full_name ?? repo,
          description: repoData.description ?? null,
          language: repoData.language ?? null,
          stars: repoData.stargazers_count ?? 0,
          forks: repoData.forks_count ?? 0,
          openIssues: repoData.open_issues_count ?? 0,
          defaultBranch: repoData.default_branch ?? null,
          url: repoData.html_url ?? null,
          homepage: repoData.homepage ?? null,
          topics: repoData.topics ?? [],
          pushedAt: repoData.pushed_at ?? null,
          updatedAt: repoData.updated_at ?? null,
          archived: Boolean(repoData.archived),
          fork: Boolean(repoData.fork),
          readme,
        } as const;
      } catch (err) {
        return networkErrorResult(err);
      }
    },
  });

  return {
    get_repo_file_tree,
    get_file_content,
    get_repo_details,
  };
}
