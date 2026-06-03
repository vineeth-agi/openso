/**
 * Public Portfolio Recruiter Chatbot — `/api/portfolio-chat` POST handler.
 *
 * This is the single failure boundary for unauthenticated recruiter traffic
 * to `/portfolio/[username]`. It orchestrates the resolver, data assembler,
 * GitHub Memory retriever, GitHub tools builder, system-prompt builder, and
 * `streamText` into one streaming response.
 *
 * High-level sequence (matches `tasks.md` Task 6.1):
 *
 *  1. Parse and validate the request body via `PortfolioChatRequestSchema`.
 *  2. Extract the recruiter's IP (`extractClientIp`) and apply
 *     `rateLimit("portfolio-chat:" + ip, PORTFOLIO_CHAT_RATE_LIMIT ?? 60)`.
 *  3. Resolve the username → portfolio + resume + GitHub OAuth token via
 *     `resolvePortfolioUser`. Unknown / unpublished collapse to 404.
 *  4. In parallel: fetch the GitHub Memory context for the latest user query
 *     (`getPortfolioGitHubContext`, wrapped in `.catch(() => null)`) and
 *     build the static context (`formatStaticContext`).
 *  5. Compute the `owner/name` allowlist from the memory repos and
 *     conditionally register on-demand `buildPortfolioGithubTools` only when
 *     a valid OAuth token is present AND there is at least one allowed repo.
 *  6. Build the system prompt with `buildPortfolioChatSystemPrompt`.
 *  7. Short-circuit (error matrix #16) when ALL three data sources are empty
 *     by returning a fixed AI SDK UIMessage stream containing the message
 *     "This portfolio isn't configured for chat yet." `streamText` is NOT
 *     called in this branch (Property 10).
 *  8. Otherwise call `streamText` with the Pioneer model from
 *     `google(getDefaultPioneerModel())`, telemetry from
 *     `createTelemetryConfig({ chatType: "portfolio", userId })`, and the
 *     `onError` callback that maps stream-time errors to the transient
 *     fallback message defined in error matrix #15.
 *  9. Return `result.toUIMessageStreamResponse()`.
 *
 * Error matrix (mirrors design.md "Failure Matrix"):
 *
 *    #1, #2 → 400 invalid_request
 *    #3, #4 → 404 user_not_found  (also for unpublished — does not differentiate)
 *    #5     → 429 rate_limited    (with `Retry-After` header)
 *    #13    → 500 internal_error
 *    #14    → 503 internal_error  (Pioneer 429 mapped to 503 + `Retry-After: 30`)
 *    #15    → partial stream then close — handled in `onError` callback
 *    #16    → 200 stream with fixed "not configured" message
 *    #17    → 500 internal_error  (outer try/catch fallback)
 *
 * Notes on adaptations from the task spec:
 *
 *  - The task spec lists `maxSteps` and `maxTokens` as `streamText` options.
 *    The installed AI SDK version (`ai@^6.0.154`, see `package.json`)
 *    renamed those to `stopWhen: stepCountIs(...)` and `maxOutputTokens`
 *    respectively. We honour the same env vars
 *    (`PORTFOLIO_CHAT_MAX_STEPS`, `PORTFOLIO_CHAT_MAX_TOKENS`) but pass them
 *    via the v6 names, mirroring `src/app/api/chat/route.ts`.
 *
 *  - The task spec lists imports from `@/lib/portfolio-chat` (the barrel)
 *    only. We follow that exactly — no reaching into individual modules.
 *
 *  - Telemetry uses `createTelemetryConfig({ chatType: "portfolio", userId })`,
 *    confirmed available in `@/lib/ai/telemetry`.
 *
 * See `.kiro/specs/portfolio-recruiter-chatbot/design.md`
 *  - "Components and Interfaces" → "1. Chat API Route"
 *  - "Failure Matrix"
 *  - "Logging and Privacy"
 *  - Properties 4, 5, 7, 8, 10, 11, 12
 */

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { createHash } from "node:crypto";


import { google, getDefaultPioneerModel } from "@/lib/ai/google-provider";
import {
  createTelemetryConfig,
  logAICost,
  logAIOperation,
} from "@/lib/ai/telemetry";
import { formatGitHubMemoryPrompt } from "@/lib/github-memory";
import {
  buildPortfolioChatSystemPrompt,
  buildPortfolioGithubTools,
  extractAllowedRepos,
  extractClientIp,
  formatStaticContext,
  getPortfolioGitHubContext,
  PortfolioChatRequestSchema,
  resolvePortfolioUser,
  type PortfolioChatError,
  type PortfolioChatMessage,
} from "@/lib/portfolio-chat";
import { rateLimit } from "@/lib/rate-limit";

// ── Constants ──────────────────────────────────────────────────────────────

/** Default rate limit: 60 requests per minute per IP (design "Configuration & env"). */
const DEFAULT_RATE_LIMIT = 60;

/** Default `streamText` step cap. Public traffic doesn't need long tool chains. */
const DEFAULT_MAX_STEPS = 5;

/** Default `streamText` output token cap. Allows substantive responses while preventing runaway streams. */
const DEFAULT_MAX_TOKENS = 4096;

/** No-data fallback message (error matrix #16, Property 10). */
const NO_DATA_FALLBACK_MESSAGE =
  "This portfolio isn't configured for chat yet.";

/** Stream-time transient-error message (error matrix #15). */
const TRANSIENT_STREAM_ERROR_MESSAGE =
  "I hit a transient issue, please ask again.";

// ── POST handler ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Outer try/catch is the failure-mode #17 (unhandled exception) safety net.
  // Every expected branch returns its own structured response; only truly
  // unexpected throws hit this fallback.
  try {
    // ── 1. Parse body ────────────────────────────────────────────────────
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse(
        400,
        "invalid_request",
        "Request body is not valid JSON.",
      );
    }

    const parsed = PortfolioChatRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      // Surface only the first Zod issue path so we never echo the raw body
      // (which may contain attacker-controlled content).
      const firstIssue = parsed.error.issues[0];
      const path = firstIssue?.path?.join(".") || "(root)";
      return errorResponse(
        400,
        "invalid_request",
        `Invalid request: ${path}`,
      );
    }
    const { username, messages } = parsed.data;

    // ── 2. Rate limit ────────────────────────────────────────────────────
    const ip = extractClientIp(req);
    const rlLimit = Number(
      process.env.PORTFOLIO_CHAT_RATE_LIMIT ?? DEFAULT_RATE_LIMIT,
    );
    const rl = await rateLimit(
      `portfolio-chat:${ip}`,
      Number.isFinite(rlLimit) && rlLimit > 0 ? rlLimit : DEFAULT_RATE_LIMIT,
    );
    if (!rl.ok) {
      const body: PortfolioChatError = {
        error: "Too many requests. Please slow down.",
        code: "rate_limited",
        retryAfter: rl.retryAfter,
      };
      return new Response(JSON.stringify(body), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rl.retryAfter),
        },
      });
    }

    // ── 3. Resolve user (404 collapses unknown + unpublished) ────────────
    const resolved = await resolvePortfolioUser(username);
    if (!resolved) {
      console.info(
        `[portfolio-chat] user_not_found username=${truncateForLog(username)} ip=${hashIp(ip)}`,
      );
      return errorResponse(
        404,
        "user_not_found",
        "Portfolio not found.",
      );
    }
    const { userId, portfolioConfig, resumeStructured } = resolved;
    // NOTE: `githubToken` from `resolved` is intentionally NOT used here.
    // The portfolio chatbot must NEVER fetch repos with the user's OAuth
    // token — it uses an operator-owned PAT or unauthenticated public API.
    // See Issue #8 in the audit report.

    // Latest user query — last message with role === "user", text-only join
    // of `parts`, falling back to `content`, falling back to the empty
    // string. Used both for memory retrieval and for telemetry.
    const latestUserQuery = extractLatestUserQuery(messages);

    // ── 4. Parallel-fetch GitHub Memory + build static context ───────────
    //
    // `formatStaticContext` is synchronous but we wrap it in a try/catch so
    // any unforeseen shape mismatch in `resume_structured` / `site_config`
    // (e.g. a hand-edited row, a future schema change) degrades to an empty
    // static context rather than crashing the whole route. The defensive
    // helpers in `data-assembly.ts` (Array.isArray guards, dual-shape
    // accessors) are the first line of defence; this catch is the safety
    // net so a single bad row never returns a 500 to the recruiter.
    const safeStaticContext = ((): ReturnType<typeof formatStaticContext> => {
      try {
        return formatStaticContext(resumeStructured, portfolioConfig, username);
      } catch (err) {
        console.warn(
          `[portfolio-chat] static_context_failed user=${userId}: ${redactToken(
            err instanceof Error ? err.message : String(err),
          )}`,
        );
        return {
          candidateName: username,
          candidateTitle: "",
          candidateBio: "",
          skills: [],
          contactInfo: "",
          experienceSummary: "",
          educationSummary: "",
          certifications: [],
          topProjects: [],
        };
      }
    })();

    const [memoryContext, staticContext] = await Promise.all([
      // Wrap in `.catch(() => null)` for graceful degradation per task spec.
      // `getPortfolioGitHubContext` already swallows errors internally and
      // returns `null` on timeout / empty / failure, so this is a belt-and-
      // braces guard — but the task explicitly requires the outer `.catch`
      // and we want to honour it.
      getPortfolioGitHubContext(userId, latestUserQuery).catch(() => null),
      Promise.resolve(safeStaticContext),
    ]);

    // ── 5. Build allowed-repo allowlist + conditional GitHub tools ───────
    //
    // Strategy: ALWAYS enable GitHub tools for public repos. The chatbot is
    // a real agent that can browse the user's public code on demand.
    // Private repos are NEVER exposed — we only use the public GitHub API.
    //
    // STRICT TOKEN RULE (Issue #8):
    //   - We NEVER use the user's GitHub OAuth token (`resolved.githubToken`)
    //     for chatbot repo fetching. Doing so could leak access to private
    //     repos via a misuse of allowed scopes.
    //   - We use ONLY the operator-provided PAT
    //     (`process.env.PORTFOLIO_CHAT_GITHUB_PAT` — falls back to
    //     `GITHUB_TOKEN` for backwards compatibility with existing deploys).
    //   - If the PAT is unset OR fails (rate-limit / auth error), the
    //     `github-tools.ts` builder degrades gracefully to UNAUTHENTICATED
    //     calls against the public REST API (60 req/h limit, but works).
    //
    // Allowlist sources (in priority order):
    //   1. Repos from GitHub Memory (already indexed, private-filtered)
    //   2. Portfolio config projects with a `github` field
    //   3. If neither has repos, allow `${githubUsername}/*` so the model
    //      can probe any public repo under the candidate's account.
    const allowedRepos = buildPublicRepoAllowlist(memoryContext, portfolioConfig, resolved.githubUsername);
    const hasGithubTools = allowedRepos.length > 0;

    // PAT for chatbot — operator-owned, never user OAuth (Issue #8).
    const operatorPat =
      process.env.PORTFOLIO_CHAT_GITHUB_PAT ||
      process.env.GITHUB_TOKEN ||
      "";
    const tools = hasGithubTools
      ? buildPortfolioGithubTools(operatorPat, allowedRepos)
      : undefined;

    // ── 6. Build system prompt ───────────────────────────────────────────
    const githubMemoryPrompt = memoryContext
      ? formatGitHubMemoryPrompt(memoryContext)
      : "";
    const systemPrompt = buildPortfolioChatSystemPrompt({
      ...staticContext,
      githubMemoryPrompt,
      hasGithubTools,
    });

    // ── 7. No-data fallback (error matrix #16, Property 10) ──────────────
    //
    // When the candidate has no resume, no portfolio identity, no skills, no
    // experience, no projects, AND no GitHub Memory, there is nothing for
    // the model to talk about. Short-circuit before `streamText` and stream
    // a fixed assistant message via the AI SDK UIMessage data-stream
    // protocol so the widget renders it identically to a normal response.
    if (isCompletelyEmpty(staticContext, githubMemoryPrompt)) {
      return buildFixedAssistantMessageStream(NO_DATA_FALLBACK_MESSAGE);
    }

    // ── 8. streamText ────────────────────────────────────────────────────
    //
    // AI SDK v6 renamed `maxSteps` → `stopWhen: stepCountIs(...)` and
    // `maxTokens` → `maxOutputTokens`. We honour the env vars from the task
    // spec (PORTFOLIO_CHAT_MAX_STEPS, PORTFOLIO_CHAT_MAX_TOKENS) but pass
    // them through the v6 names. This matches the existing `/api/chat`
    // route's pattern.
    const maxSteps = Number(
      process.env.PORTFOLIO_CHAT_MAX_STEPS ?? DEFAULT_MAX_STEPS,
    );
    const maxOutputTokens = Number(
      process.env.PORTFOLIO_CHAT_MAX_TOKENS ?? DEFAULT_MAX_TOKENS,
    );

    let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
    try {
      // `convertToModelMessages` expects the `UIMessage` shape from the AI
      // SDK. The Zod schema is intentionally permissive (parts is `any[]`)
      // so we cast through unknown — the SDK validates internally and any
      // truly malformed messages will be filtered or throw, in which case
      // we fall through to the 400 below.
      modelMessages = await convertToModelMessages(
        messages as unknown as UIMessage[],
      );
    } catch {
      return errorResponse(
        400,
        "invalid_request",
        "Could not build a valid prompt from the provided messages.",
      );
    }

    if (modelMessages.length === 0) {
      return errorResponse(
        400,
        "invalid_request",
        "Please send a message before starting chat.",
      );
    }

    // Capture the model id once — used both as the `model` argument to
    // `streamText` and as the `modelId` reported to telemetry on stream
    // start, finish, and error. Reading it twice would be safe (it's a pure
    // env-var lookup) but a single source-of-truth is clearer.
    const modelId = getDefaultPioneerModel();
    // Wall-clock start time for `durationMs` telemetry on completion / error.
    const streamStartedAt = Date.now();

    const result = streamText({
      model: google(modelId),
      system: systemPrompt,
      messages: modelMessages,
      tools: tools as Parameters<typeof streamText>[0]["tools"],
      stopWhen: stepCountIs(
        Number.isFinite(maxSteps) && maxSteps > 0
          ? maxSteps
          : DEFAULT_MAX_STEPS,
      ),
      maxOutputTokens:
        Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
          ? maxOutputTokens
          : DEFAULT_MAX_TOKENS,
      ...createTelemetryConfig({
        chatType: "portfolio",
        userId,
        operation: "streamText",
      }),
      onFinish: (event) => {
        // Telemetry hookup (Task 13.1): record the operation completion AND
        // the cost so public traffic shows up as a separate `chatType` line
        // ("portfolio") in the dashboards alongside the authenticated chat.
        //
        // `logAIOperation` and `logAICost` accept the shapes defined in
        // `@/lib/ai/telemetry` — `chatType`, `durationMs`, and `success`
        // are not first-class fields on `logAIOperation`, so they go in
        // the `extra` bag (mirroring `src/app/api/chat/route.ts`).
        const durationMs = Date.now() - streamStartedAt;
        const inputTokens = event.usage?.inputTokens ?? 0;
        const outputTokens = event.usage?.outputTokens ?? 0;
        logAIOperation("streamText", {
          modelId,
          userId,
          extra: {
            chatType: "portfolio",
            durationMs,
            success: true,
            finishReason: event.finishReason,
          },
        });
        logAICost(modelId, inputTokens, outputTokens, "streamText");
      },
    });

    // ── 9. Return UIMessage stream response ──────────────────────────────
    //
    // `onError` is the error-matrix #15 hook: any stream-time error (Pioneer
    // 5xx mid-stream, network drop, etc.) is caught here and surfaced as
    // the transient fallback text. Telemetry already captured the error
    // via `experimental_telemetry`; here we only need to give the user a
    // graceful message.
    return result.toUIMessageStreamResponse({
      generateMessageId: () => generateId(),
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[portfolio-chat] stream-error user=${userId} ip=${hashIp(ip)}: ${redactToken(message)}`,
        );
        // Mirror onFinish telemetry for failed streams so dashboards show a
        // `chatType: "portfolio"` line for errors too. We pass the original
        // error as the `extra` bag's `error` field — `logAIOperation` only
        // accepts a typed shape, so the error description goes there.
        logAIOperation("streamText", {
          modelId,
          userId,
          extra: {
            chatType: "portfolio",
            durationMs: Date.now() - streamStartedAt,
            success: false,
            error: redactToken(message),
          },
        });
        return TRANSIENT_STREAM_ERROR_MESSAGE;
      },
    });
  } catch (error) {
    // ── Outer fallback (error matrix #14, #17) ───────────────────────────
    //
    // We map the well-known Pioneer 429 / quota signal to a 503 + `Retry-After`
    // so the client doesn't bash against our IP-based rate limit. Anything
    // else is a generic 500 with a redacted message.
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = redactToken(message);
    if (isUpstreamRateLimit(message)) {
      // Pioneer upstream rate-limit / quota is expected under load — log at
      // `warn` (not `error`) so on-call dashboards don't page on it.
      console.warn(`[portfolio-chat] upstream_rate_limited: ${safeMessage}`);
      const body: PortfolioChatError = {
        error: "Chat is temporarily unavailable. Please try again shortly.",
        code: "internal_error",
        retryAfter: 30,
      };
      return new Response(JSON.stringify(body), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "30",
        },
      });
    }
    console.error(`[portfolio-chat] internal_error: ${safeMessage}`);
    return errorResponse(
      500,
      "internal_error",
      "Chat is temporarily unavailable. Please try again.",
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a JSON `PortfolioChatError` response with a stable shape. */
function errorResponse(
  status: number,
  code: PortfolioChatError["code"],
  message: string,
): Response {
  const body: PortfolioChatError = { error: message, code };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Extract the latest user query as a single string. Strategy:
 *  1. Find the LAST message with `role === "user"`.
 *  2. If it has `parts`, concatenate all `text` parts into one string.
 *  3. Otherwise, use `content` (the legacy AI SDK field).
 *  4. Otherwise, return the empty string.
 *
 * Used for GitHub Memory semantic retrieval. An empty string is acceptable
 * — `getGitHubMemoryContext` accepts arbitrary query text including empty.
 */
function extractLatestUserQuery(messages: PortfolioChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    if (Array.isArray(msg.parts)) {
      const text = msg.parts
        .filter(
          (p): p is { type: "text"; text: string } =>
            typeof p === "object" &&
            p !== null &&
            (p as { type?: unknown }).type === "text" &&
            typeof (p as { text?: unknown }).text === "string",
        )
        .map((p) => p.text)
        .join(" ")
        .trim();
      if (text.length > 0) return text;
    }
    if (typeof msg.content === "string" && msg.content.trim().length > 0) {
      return msg.content.trim();
    }
    return "";
  }
  return "";
}

/**
 * True when ALL three data sources contributed nothing meaningful:
 *
 *  - resume + portfolio identity → `staticContext` has no name beyond the
 *    raw username, no title, no bio, no skills, no experience, no projects.
 *  - GitHub Memory → `githubMemoryPrompt` is empty.
 *
 * In that case the model has nothing useful to ground its answers on, so
 * we short-circuit with the fixed "not configured" message rather than
 * spend Pioneer tokens producing hallucinations. Property 10.
 */
function isCompletelyEmpty(
  staticContext: ReturnType<typeof formatStaticContext>,
  githubMemoryPrompt: string,
): boolean {
  const hasIdentity =
    staticContext.candidateTitle.trim().length > 0 ||
    staticContext.candidateBio.trim().length > 0;
  const hasSkills = staticContext.skills.length > 0;
  const hasExperience = staticContext.experienceSummary.trim().length > 0;
  const hasProjects = staticContext.topProjects.length > 0;
  const hasMemory = githubMemoryPrompt.trim().length > 0;
  return (
    !hasIdentity && !hasSkills && !hasExperience && !hasProjects && !hasMemory
  );
}

/**
 * Synthesize an AI SDK UIMessage data stream containing exactly one
 * assistant text message. Used for the no-data fallback (#16). The stream
 * follows the v6 chunk format (`start`, `start-step`, `text-start`,
 * `text-delta`, `text-end`, `finish-step`, `finish`) so the widget's
 * `useChat` hook renders it as a normal assistant turn.
 */
function buildFixedAssistantMessageStream(message: string): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const textId = generateId();
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id: textId });
      writer.write({ type: "text-delta", id: textId, delta: message });
      writer.write({ type: "text-end", id: textId });
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/**
 * Detect upstream Pioneer quota / 429 errors so we can map them to
 * a 503 with a `Retry-After` header (error matrix #14). The AI SDK doesn't
 * expose a structured error type for this in `streamText` setup-time
 * failures, so we pattern-match the message. Pattern is intentionally
 * loose — false positives are harmless (still returns a 503 to the client),
 * false negatives surface as a 500 which is the correct fallback.
 */
function isUpstreamRateLimit(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("quota") ||
    m.includes("resource_exhausted")
  );
}

/** Cap a string for log output and replace control chars. Defensive — usernames are validated by Zod. */
function truncateForLog(s: string): string {
  return s.replace(/[\r\n\t]/g, " ").slice(0, 100);
}

/**
 * Hash an IP for log output using salted SHA-256.
 *
 * Full IPs are PII; we only want a coarse, non-reversible identifier in
 * telemetry so we can correlate log entries from the same client without
 * storing the address itself. The salt is read from `INSTANCE_SALT` (with
 * a stable fallback so logs remain consistent within a deploy if the env
 * var is unset). We truncate to the first 12 hex chars — 48 bits is more
 * than enough entropy for log aggregation while making rainbow-table
 * lookups against the public IPv4 space prohibitively expensive.
 */
function hashIp(ip: string): string {
  if (ip === "unknown" || ip.length === 0) return "unknown";
  const salt = process.env.INSTANCE_SALT ?? "portfolio-chat";
  return createHash("sha256").update(ip + salt).digest("hex").slice(0, 12);
}

/**
 * Redact GitHub access tokens from any string before logging.
 *
 * GitHub tokens follow well-known prefixes: `ghp_` (personal access),
 * `gho_` (OAuth), `ghu_` (user-to-server), `ghs_` (server-to-server),
 * and `github_pat_` (fine-grained PAT). If a token slips into an error
 * message (e.g., a stack frame referencing a request URL with the token
 * in a query string), this strips it before the message hits any log
 * sink. Pattern is intentionally broad on the alphanumeric body so it
 * tolerates future token-format extensions.
 */
function redactToken(s: string): string {
  if (!s) return s;
  return s.replace(
    /(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]+/g,
    "<TOKEN_REDACTED>",
  );
}

/**
 * Build the public repo allowlist from multiple sources.
 * Only includes public repos — private repos are NEVER exposed.
 */
function buildPublicRepoAllowlist(
  memoryContext: Awaited<ReturnType<typeof getPortfolioGitHubContext>>,
  portfolioConfig: any,
  githubUsername: string | null,
): string[] {
  const repos = new Set<string>();

  // Source 1: GitHub Memory repos (already indexed)
  if (memoryContext) {
    for (const repo of memoryContext.repos) {
      if (repo.fullName && repo.fullName.includes("/")) {
        repos.add(repo.fullName.toLowerCase());
      }
    }
  }

  // Source 2: Portfolio config projects with github field
  if (portfolioConfig?.projects && Array.isArray(portfolioConfig.projects)) {
    for (const project of portfolioConfig.projects) {
      if (project?.github && typeof project.github === "string" && project.github.includes("/")) {
        repos.add(project.github.toLowerCase());
      }
    }
  }

  // Source 3: If we have a github username but no specific repos,
  // allow any repo under that owner (public API only accesses public repos)
  if (repos.size === 0 && githubUsername) {
    repos.add(`${githubUsername.toLowerCase()}/*`);
  }

  return Array.from(repos);
}
