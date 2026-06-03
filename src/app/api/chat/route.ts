// Unified Chat API — Native OAuth connections (Gmail, GitHub, Calendar) + Job Search mode

import { tool, streamText, convertToModelMessages, generateId, stepCountIs, type UIMessage } from "ai";
import { generateObject } from "ai";
import { format } from "date-fns";
import { z } from "zod";

import { google } from "@/lib/ai/google-provider";
import { classifyAndRoute, type RouteResult } from "@/lib/ai/model-router";
import { createTelemetryConfig, logAIOperation, logAICost } from "@/lib/ai/telemetry";
import { saveConversation, saveMessages, generateTitle, updateConversationTitle } from "@/lib/chat-store";
import { getConnectedSlugsAdmin } from "@/lib/connections";
import { interceptAndParseAttachments } from "@/lib/file-parsing";
import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { discoverMCPTools, getMCPServers } from "@/lib/mcp";
import { searchDocuments } from "@/lib/memory/documents";
import { writeToBuffer, shouldRunDreamCycle } from "@/lib/memory/dream-cycle";
import { inferPatternsFromToolUsage, observePattern } from "@/lib/memory/procedural";
import { shouldExtractInline, extractAndStoreInline } from "@/lib/memory/realtime-extractor";
import { getMemoryContext, formatMemoryPrompt } from "@/lib/memory/retriever";
import { updateSessionSummary } from "@/lib/memory/session";
import { buildMemoryTools } from "@/lib/memory/tools";
import { buildProfileTools } from "@/lib/profile/chat-tools";
import { rateLimit } from "@/lib/rate-limit";
import { buildRepoAgentTools } from "@/lib/repo-agent/tools";
import { buildDaytonaTools } from "@/lib/tools/daytona-tools";
import {
  buildWebSearchTools,
  buildDeepResearchTool,
  buildDiagramTools,
  buildReportTools,
} from "@/lib/tools/extra-tools";
import { routeUserIntent, fetchNativeAppTools } from "@/lib/tools/tool-router";
import { workflowClient, workflowUrl } from "@/lib/workflow/client";

// Preload GitHub tools module to avoid dynamic import() latency on hot path
let _cachedGithubToolsModule: Awaited<typeof import("@/lib/tools/native-tools/github")> | null = null;
const getGithubToolsModule = async () => {
  if (!_cachedGithubToolsModule) {
    _cachedGithubToolsModule = await import("@/lib/tools/native-tools/github");
  }
  return _cachedGithubToolsModule;
};

// Cache MCP tool discovery results (2-minute TTL) to avoid re-connecting every request
let _mcpCache: { tools: Record<string, unknown>; discoveredCount: number; ts: number } | null = null;
const MCP_CACHE_TTL_MS = 2 * 60 * 1000;

// ── Model (Auto-Router) ──
// Legacy getModel replaced by classifyAndRoute() — auto-selects model based on
// query complexity, task type, and conversation context with fallback + retry.

// ── Auth helpers ──
async function getAuthContext() {
  const auth = await getAuthUser();
  if (!auth) throw new Error("Not authenticated");
  return { userId: auth.user.id };
}

// Tool builders imported from shared modules (single source of truth)
// buildDiagramTools, buildReportTools, buildWebSearchTools,
// buildDeepResearchTool — all shared with Telegram webhook
// buildJobSearchTools — shared from lib/job-search/chat-tools

// ── Job Mode System Prompt ──
function getJobModeSystemPrompt(memoryPrompt?: string, userTimezone?: string) {
  const now = format(new Date(), "EEEE, MMMM do, yyyy 'at' h:mm a");
  return `You are a professional Job Search Assistant. Your ONLY purpose is to help users find jobs.
Current date: ${now}
${memoryPrompt || ""}

You have EIGHT specialized tools — pick the right one for the user's intent:

**Job Search Tools:**
1. **searchJobs** — Find jobs across many platforms (Wellfound, Greenhouse, Lever, Ashby, Workable, LinkedIn, Indeed, Remotive, RemoteOK, Arbeitnow). Applies a deterministic 10-signal quality gate. Returns ranked listings with quality tier + match score.
2. **evaluateJob** — Deep 3-layer evaluation of a single job (URL or pasted JD): archetype detection, keyword + semantic + knowledge-graph matching, gap analysis, ghost-job detection, 1-5 score.
3. **generateApplicationPackage** — Produces a tailored ATS-optimized resume + cover letter + outreach messages for a specific job. Grounded in the user's memory facts.

**Profile Tools:**
5. **checkProfileStatus** — Check if resume and GitHub data are loaded. Use this first to understand what data is available.
6. **analyzeGitHubProfile** — Analyze connected GitHub: repos, languages, PRs, contributions → writes facts to memory. Requires GitHub connected.
7. **ingestResumeText** — Parse resume text and extract structured data (skills, experience, projects) → writes facts to memory. Use when user pastes resume content.
8. **viewProfile** — Get the full synthesized profile markdown with skill credibility (verified/claimed/discovered).

HOW TO RESPOND (SMART INTAKE):
1. For VAGUE searches like "find me jobs", ask clarifying questions first:
   - What role/title?
   - Location (or remote)?
   - Experience level?
   - Full-time, contract, internship?
   - Salary expectations or specific companies?
2. Only call searchJobs AFTER you have at least a clear role and location/remote preference.
3. If user provides resume text, pass it as resumeText for match scoring.
4. Set deep=true on searchJobs only when the user explicitly asks for "deep analysis" or "rank top matches" — it's slower but uses the 3-layer evaluator.

JOB RESULT FORMAT:
The UI already renders interactive job cards with Apply buttons from the searchJobs tool output.
DO NOT repeat or re-list every job in markdown — the user already sees them as cards above your text.
Instead write a SHORT summary like:
"I found a few Senior React Developer positions in Bangalore. Here are the top matches:"
Then highlight only the TOP 2-3 most relevant jobs with a sentence each explaining WHY they're a good fit.
If many results look irrelevant, acknowledge it and suggest the user refine their search.

EVALUATION REPORT FORMAT (after evaluateJob):

## 📋 {title} @ {company}
**Score: {score.overall}/5.0** — {score.recommendation} · {score.interpretation}

**Archetype:** {archetype.primary} ({archetype.seniority}) — {archetype.tldr}

**Match breakdown:** Keyword {match.keyword} · Semantic {match.semantic} · Graph {match.graph}
- ✅ Matched: {match.matched joined}
- ❌ Missing: {match.missing joined}
- 🔗 Inferred via graph: {match.inferredSkills joined}

**Gaps:**
- Hard blockers: {gaps.hardBlockers joined or "none"}
- Nice-to-haves: {gaps.niceToHaveGaps joined}

**Legitimacy:** {ghost.tier} ({ghost.score}) {concerns if any}

GUIDELINES:
- Always use the tools — never invent listings, scores, or evaluations.
- Show ALL results from searchJobs — don't filter further.
- Highlight 🔥 hot-tier and ⭐ top-3 matches.
- After evaluateJob with score ≥ 4.0, proactively offer: "Want me to generate an application package for this one?"
- After generateApplicationPackage, give the user the cover letter inline and tell them the resume HTML can be downloaded as PDF from the dashboard.
- Be encouraging — job searching is stressful!`;
}

function getSystemPrompt(memoryPrompt?: string, userTimezone?: string) {
  const now = format(new Date(), "EEEE, MMMM do, yyyy 'at' h:mm a");
  const tzName = userTimezone ?? "UTC";
  let tzOffset = "UTC";
  try {
    const formatter = new Intl.DateTimeFormat("en", { timeZone: tzName, timeZoneName: "longOffset" });
    const parts = formatter.formatToParts(new Date());
    tzOffset = parts.find(p => p.type === "timeZoneName")?.value ?? tzName;
  } catch { tzOffset = tzName; }

  return `You are a helpful AI assistant with access to native integrations (Gmail, GitHub) and powerful tools for research and diagrams.
Current date/time (server UTC): ${now}
User's timezone: ${tzName} (${tzOffset})
${memoryPrompt || ""}

You have access to the apps the user has connected (Gmail, GitHub) via the Connectors page.
Use the available tools to help — never give manual instructions when you can do it directly.
NEVER say you are not connected — if these tools exist, the connection IS active. Just call the tool.

**WEB SEARCH & SCRAPING:**
- ONLY use 'web_search' if it is explicitly listed in your available tools. If it is not in your tools list, do NOT attempt to call it — there is no web search capability in this session.
- When the user asks about current events, news, "what is X", "look up", or anything requiring up-to-date internet info AND web_search IS available, use the 'web_search' tool.
- Use 'sources: ["web", "news"]' when the query is about recent events or breaking news.
- Use 'categories: ["github"]' for code/repo searches, '"research"' for academic papers.
- Use 'tbs' for time filtering: 'qdr:d' (past day), 'qdr:w' (past week), 'qdr:m' (past month).
- When the user shares a URL and asks to read/summarize it, use the 'scrape_url' tool.
- After searching, if you need more detail from a specific result, scrape that URL.

**VISUAL REPORTS & CHARTS:**
- When the user asks for charts, reports, dashboards, data visualization, or when presenting deep research results visually, use the 'generate_visual_report' tool.
- Pass ALL the data and a detailed description of what to show (charts, tables, KPIs, sections).
- Do NOT use this for simple text answers — only when explicitly asked for visual reports or charts.
- After deep research completes, if the data is substantial, offer to visualize it with a report.

GITHUB TOOL RULES (critical):
- When a user provides a specific GitHub URL (like https://github.com/openclaw/openclaw/issues/69959) or explicitly names an owner/repo, ALWAYS use THAT EXACT owner/repo string. Do NOT substitute it with a repo from github_list_repos.
- If the user just says "my repo", call github_list_repos first to discover the user's real repo names.
- To verify connectivity or get the username, call github_get_authenticated_user.
- NEVER pass * or blank strings as owner/repo — always use real names.

OPEN SOURCE CONTRIBUTION SEARCH (CRITICAL RULES):
- ALWAYS call github_search_contributor_issues for ANY query about finding issues, contributing, open source, beginner tasks, bugs to fix, etc.
- NEVER answer from training data or memory — issues change daily, only the tool has live data.
- NEVER call web_search for open source issues — it is not available for this intent.
- Call the tool FIRST, then format the results it returns. Do NOT add, modify, or invent issue details.
- Pass a descriptive topic (e.g. "Python memory leak bugs", "TypeScript documentation improvements") — not just the raw user query.
- Set difficulty="easy" if user mentions beginner/easy/starter/good first issue.
- Set language if user mentions Python, TypeScript, etc.
- Set repo_name if user names a specific repo.
- Present the results naturally (e.g., as bullet points, groups by repository/topic, or a numbered list) rather than forcing a table format.
- IMPORTANT: Providing a working markdown link for each issue (e.g., [View on GitHub](url)) is STRICTLY MANDATORY. Do not omit the link under any circumstances.
- Show all results the tool returns — never hide or skip any.
- If the tool returns no results, say so and suggest broader filters.

JOB BOARD SEARCH (CRITICAL RULES):
- ALWAYS call search_job_board_jobs for ANY query about finding JOBS, careers, openings, hiring, roles at companies (paid employment).
- This is DIFFERENT from open-source contribution — that's github_search_contributor_issues. Only use search_job_board_jobs for paid roles.
- NEVER answer from training data or memory — listings change daily, only the tool has live data.
- NEVER call web_search for jobs — search_job_board_jobs has the curated database (~7000 listings from ~70 top tech companies).
- Pass a descriptive 'query' field that captures the role semantically (e.g. "senior backend engineer Postgres", "AI/ML researcher", "data scientist remote"), NOT just the raw user message.
- Set experience_level if user says senior/staff/junior/intern/new-grad.
- Set workplace_type if user says "remote", "hybrid", or "in-office".
- Set country/city if user names a location.
- Set company_slug if user asks about a specific company (e.g. user says "jobs at Stripe" → company_slug="stripe").
- Set is_yc=true if user wants only YC startups.
- Set programming_languages if user mentions specific languages.
- Present results as a SHORT summary at the top, then highlight the TOP 2-3 jobs with one sentence each explaining why they're a good fit.
- IMPORTANT: For every job, include a working markdown link to the apply_url (e.g., [Apply on Greenhouse](apply_url)). This is STRICTLY MANDATORY.
- Show similarity % and salary when available — those are signal-rich.
- 🌟 Mark YC-backed companies and ⭐ mark top_company entries.
- If the tool returns no results, say so and suggest broader filters (e.g., drop the city filter, broaden the experience level).


DAYTONA SANDBOX USAGE:
You should only use the Daytona sandbox tools ('create_sandbox', 'execute_command', 'write_file') for SMALL, one-off scripts, testing code snippets, or answering questions about simple file paths, NOT for full repository PR lifecycles.
Guidelines:
- For destructive actions (deleting, sending), confirm with the user first
- Be concise and action-oriented
- Use the memory context above to personalize your responses
- You can also remember and recall facts about the user across conversations

**DAYTONA CODE CAPABILITIES:**
If the user asks you to "write a script", "ping", "test this code", or any execution task, YOU MUST ACTUALLY EXECUTE IT using your Sandbox Tools instead of just printing the code! 
1. Use 'create_sandbox' to get an isolated environment.
2. Use 'write_file', 'execute_command', or 'code_run' to test your scripts logic automatically.
3. Once finished getting the stdout/results, report the result to the user, and immediately use 'delete_sandbox' to clean up resources.`;
}

function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  let removedIncompleteToolParts = 0;

  return messages
    .map((message) => {
      const parts = (message.parts ?? []).filter((part) => {
        const partAny = part as Record<string, unknown>;
        const partType = typeof partAny.type === "string" ? partAny.type : "";

        if (partType === "tool-invocation") {
          const invocation = partAny.toolInvocation as Record<string, unknown> | undefined;
          const hasResult = invocation?.state === "result" || "result" in (invocation ?? {});
          if (!hasResult) removedIncompleteToolParts++;
          return hasResult;
        }

        if (partType.startsWith("tool-")) {
          const state = partAny.state;
          const hasOutput = state === "output-available" || state === "output-error" || "output" in partAny || "result" in partAny;
          if (!hasOutput) removedIncompleteToolParts++;
          return hasOutput;
        }

        if ("toolCallId" in partAny) {
          const state = partAny.state;
          const hasOutput = state === "output-available" || state === "output-error" || "output" in partAny || "result" in partAny;
          if (!hasOutput) removedIncompleteToolParts++;
          return hasOutput;
        }

        if (part.type !== "text") return true;
        const text = (part as { type: "text"; text?: string }).text;
        return typeof text === "string" && text.trim().length > 0;
      });

      return {
        ...message,
        parts,
      };
    })
    .filter((message) => (message.parts?.length ?? 0) > 0)
    .map((message, index, arr) => {
      if (index === arr.length - 1 && removedIncompleteToolParts > 0) {
        console.warn(`[Chat-Sanitize] Removed ${removedIncompleteToolParts} incomplete tool part(s) from message history`);
      }
      return message;
    });
}

function textOnlyMessages(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message) => ({
      ...message,
      parts: (message.parts ?? []).filter((part) => {
        if (part.type !== "text") return false;
        const text = (part as { type: "text"; text?: string }).text;
        return typeof text === "string" && text.trim().length > 0;
      }),
    }))
    .filter((message) => (message.parts?.length ?? 0) > 0);
}


// ── Document Search Tool (for RAG-indexed uploads) ──
function buildDocSearchTools(userId: string) {
  return {
    search_uploaded_docs: tool({
      description: "Search through large documents that the user uploaded in this conversation. Use this when the user asks about content from a document that was indexed for deep search. Returns the most relevant text chunks.",
      inputSchema: z.object({
        query: z.string().describe("The search query — what information to find in the uploaded documents"),
        limit: z.number().optional().default(5).describe("Number of chunks to return (default 5)"),
      }),
      execute: async ({ query, limit }) => {
        try {
          const results = await searchDocuments(userId, query, "chat_upload", limit);
          if (results.length === 0) {
            return { found: false, message: "No relevant content found in uploaded documents." };
          }
          return {
            found: true,
            chunks: results.map((r) => ({
              title: r.title,
              content: r.content,
              chunkIndex: r.chunkIndex,
              similarity: r.similarity,
            })),
          };
        } catch (e) {
          console.error("[search_uploaded_docs] Error:", e);
          return { found: false, message: "Search failed." };
        }
      },
    }),
  };
}

// ── POST Handler ──
export async function POST(req: Request) {
  try {
    const { messages, threadId, currentFolder, conversationId, timezone, mode, model, resumeText, selectedRepo, repoSandboxId }: { messages: UIMessage[]; threadId?: string; currentFolder?: string; conversationId?: string; timezone?: string; mode?: string; model?: string; resumeText?: string; selectedRepo?: string; repoSandboxId?: string } = await req.json();

    const convId = conversationId ?? generateId();
    const isJobMode = mode === "jobs";
    const hasRepoAgent = !!(selectedRepo && repoSandboxId);
    const { userId } = await getAuthContext();

    // SECURITY: when the client supplies a conversationId, verify the
    // caller actually owns it before doing any AI work or writes. If
    // we skipped this and let saveConversation throw later, an
    // attacker could still observe model behaviour for the current
    // turn. Returning 403 up-front is cheaper and clearer.
    if (conversationId) {
      try {
        const db = createAdminClient();
        const { data: existingConv } = await db.database
          .from("conversations")
          .select("user_id")
          .eq("id", conversationId)
          .maybeSingle();
        if (existingConv && existingConv.user_id !== userId) {
          return new Response(
            JSON.stringify({ error: "Conversation not found" }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        }
      } catch (ownerErr) {
        console.warn("[Chat] ownership check failed (continuing):", ownerErr);
      }
    }

    // Rate limiting — 20 requests per minute per user
    const rl = await rateLimit(`chat:${userId}`, 20);
    if (!rl.ok) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfter) },
      });
    }

    // Sanitize then process attachments + fetch connected slugs in parallel (async-parallel)
    const rawMessages = sanitizeMessages(messages);
    const connectedSlugsPromise = !isJobMode
      ? getConnectedSlugsAdmin(userId).catch((e) => {
          console.error(`[Mail-Chat] Failed to fetch connected slugs for user ${userId}:`, e);
          return [] as string[];
        })
      : Promise.resolve([] as string[]);

    const [{ messages: sanitizedMessages, ragIndexedFiles }, connectedSlugs] = await Promise.all([
      interceptAndParseAttachments(rawMessages, userId, convId),
      connectedSlugsPromise,
    ]);

    if (!sanitizedMessages.some((m) => m.role === "user" && (m.parts?.length ?? 0) > 0)) {
      return new Response(JSON.stringify({ error: "Please send a message before starting chat." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (ragIndexedFiles.length > 0) {
      console.log(`[FileParsing] RAG-indexed ${ragIndexedFiles.length} files for conversation ${convId}`);
    }
    if (!isJobMode) {
      console.log(`[Mail-Chat] Found ${connectedSlugs.length} connected apps for user ${userId}:`, connectedSlugs);
    }

    const lastUserMessage = sanitizedMessages.filter((m: UIMessage) => m.role === "user").pop();
    const queryText = lastUserMessage?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join(" ") ?? "";
    const sessionKey = convId;

    // Build recent conversation history for intent routing context
    // Include last few messages so follow-up messages ("all", "yes", etc.) are understood
    const recentMessages = sanitizedMessages.slice(-6);
    const conversationHistory = recentMessages.length > 1
      ? recentMessages
          .map((m) => {
            const text = m.parts
              ?.filter((p) => p.type === "text")
              .map((p) => (p as { type: "text"; text: string }).text)
              .join(" ") ?? "";
            return `${m.role}: ${text.slice(0, 200)}`;
          })
          .join("\n")
      : undefined;

    // Intent routing + memory context in parallel (async-parallel)
    const [intent, memoryPromptResult] = await Promise.all([
      routeUserIntent({ queryText, userId, connectedSlugs, conversationHistory }),
      getMemoryContext(userId, queryText, "mail", sessionKey)
        .then((ctx) => formatMemoryPrompt(ctx))
        .catch(() => ""),
    ]);
    console.log(`[Mail-Intent] Result for ${userId}:`, intent);

    const memoryPrompt = memoryPromptResult;
    // Memory tools (only if intent matches or job mode)
    const memoryTools = (intent.needsMemory || isJobMode) ? buildMemoryTools(userId, timezone) : {};

    let allTools: Record<string, unknown> = {};
    let systemPrompt: string;

    if (isJobMode) {
      // Job mode removed — fall through to normal mode
      const profileTools = buildProfileTools(userId);
      allTools = { ...profileTools, ...memoryTools };
      systemPrompt = getJobModeSystemPrompt(memoryPrompt, timezone);
    } else {
      // Normal mode: Identical tool set to Jarvis agent
      const diagramTools = intent.needsDiagram ? buildDiagramTools() : {} ;
      const reportTools = (intent.needsReport || intent.needsResearch) ? buildReportTools() : {};
      const deepResearchTool = intent.needsResearch ? buildDeepResearchTool() : {};
      const daytonaTools = (process.env.DAYTONA_API_KEY && (intent.needsDaytona || hasRepoAgent)) ? buildDaytonaTools(userId) : {};
      const docSearchTools = ragIndexedFiles.length > 0 ? buildDocSearchTools(userId) : {};
      const webSearchTools = (process.env.FIRECRAWL_API_KEY && intent.needsWebSearch) ? buildWebSearchTools() : {};
      let nativeAppTools: Record<string, unknown> = {};
      if (intent.requiredConnectedApps && intent.requiredConnectedApps.length > 0) {
        nativeAppTools = await fetchNativeAppTools(userId, intent.requiredConnectedApps);
        console.log('[Chat-Intent] Loaded ' + Object.keys(nativeAppTools).length + ' native tools for: ' + intent.requiredConnectedApps.join(', '));
      }

      // MCP tool discovery — use cached results if fresh, otherwise re-discover
      let mcpTools: Record<string, unknown> = {};
      try {
        if (_mcpCache && Date.now() - _mcpCache.ts < MCP_CACHE_TTL_MS) {
          mcpTools = _mcpCache.tools;
        } else {
          const mcpServers = getMCPServers();
          if (mcpServers.some((s) => s.enabled)) {
            const mcpResult = await discoverMCPTools(mcpServers, userId);
            mcpTools = mcpResult.tools;
            _mcpCache = { tools: mcpResult.tools, discoveredCount: mcpResult.discoveredTools.length, ts: Date.now() };
            if (mcpResult.discoveredTools.length > 0) {
              console.log(`[MCP] Loaded ${mcpResult.discoveredTools.length} MCP tools from ${mcpServers.filter(s => s.enabled).length} server(s)`);
            }
          }
        }
      } catch (mcpErr) {
        console.warn('[MCP] Tool discovery failed (non-blocking):', mcpErr);
      }

      // Ensure contribution tool is ALWAYS available when needed — it uses Voyage+InsForge,
      // not the user's GitHub token, so GitHub connection is not required.
      if (intent.needsContribution && !nativeAppTools['github_search_contributor_issues']) {
        try {
          const mod = await getGithubToolsModule();
          const contributionTools = mod.buildGithubTools(process.env.GITHUB_TOKEN || 'no-token');
          nativeAppTools['github_search_contributor_issues'] = contributionTools['github_search_contributor_issues'];
          console.log('[Chat-Intent] Loaded contribution tool via server GITHUB_TOKEN fallback');
        } catch (e) {
          console.warn('[Chat-Intent] Failed to load contribution tool fallback:', e);
        }
      }

      // Ensure job-board search tool is ALWAYS available when needed — it uses
      // Voyage embeddings + InsForge RPC (match_jobs), no third-party auth.
      if (intent.needsJobBoardSearch && !nativeAppTools['search_job_board_jobs']) {
        try {
          const { buildJobBoardTools } = await import("@/lib/tools/native-tools/job-board");
          const jobBoardTools = buildJobBoardTools(userId);
          nativeAppTools['search_job_board_jobs'] = jobBoardTools['search_job_board_jobs'];
          console.log('[Chat-Intent] Loaded job-board search tool');
        } catch (e) {
          console.warn('[Chat-Intent] Failed to load job-board tool:', e);
        }
      }

      const profileTools = buildProfileTools(userId);
      const repoAgentTools = hasRepoAgent ? buildRepoAgentTools(repoSandboxId!, selectedRepo!) : {};
      allTools = { ...nativeAppTools, ...diagramTools, ...reportTools, ...memoryTools, ...deepResearchTool, ...daytonaTools, ...docSearchTools, ...webSearchTools, ...mcpTools, ...profileTools, ...repoAgentTools };

      // Extend system prompt with Repo Agent context when a repo is selected
      let repoAgentPromptAddon = "";
      if (hasRepoAgent) {
        repoAgentPromptAddon = `\n\n**REPO AGENT MODE (ACTIVE — ${selectedRepo}):**
You are connected to the repository **${selectedRepo}** inside an active Daytona sandbox (ID: ${repoSandboxId}).
You have powerful code intelligence tools:
- **search_repo_code**: Semantic search across the entire indexed codebase. Use this FIRST for any code question.
- **get_repo_structure**: Get the file tree and skeleton from the sandbox — file paths and structural overview. Call this first to orient.
- **read_repo_file**: Read specific files or line ranges after search points you to them.
- You also have all Daytona sandbox tools (execute_command, write_file, etc.) for live code execution.

**WORKFLOW**: Search → Understand → Read full files → Answer/Act.
Always use your tools — never guess about code. You have the LIVE codebase indexed.
When fixing bugs or implementing features, use execute_command to run builds/tests to verify.
You can also create branches, commit changes, and push to create PRs using git commands.`;
      }

      systemPrompt = getSystemPrompt(memoryPrompt, timezone) + repoAgentPromptAddon;
    }

    let convertedMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
    try {
      convertedMessages = await convertToModelMessages(sanitizedMessages);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes("Tool result is missing")) throw e;
      console.warn(`[Chat-Sanitize] convertToModelMessages failed due to missing tool result; retrying with text-only history`);
      convertedMessages = await convertToModelMessages(textOnlyMessages(sanitizedMessages));
    }
    const modelMessages = convertedMessages.filter((message) => {
      const content = (message as { content?: unknown }).content;
      if (typeof content === "string") return content.trim().length > 0;
      if (Array.isArray(content)) return content.length > 0;
      // Keep messages with unexpected content structure rather than risk
      // filtering out tool-call or tool-result messages that break the chain.
      return true;
    });

    if (modelMessages.length === 0) {
      return new Response(JSON.stringify({ error: "Could not build a valid prompt from the provided messages." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const maxSteps = isJobMode ? 5 : (hasRepoAgent ? 25 : (intent.needsDaytona ? 25 : 10));

    // ── Auto-route: classify query → pick best model → wrap with fallback + retry ──
    const hasAttachments = lastUserMessage?.parts?.some((p) => p.type === "file") ?? false;
    const routeResult: RouteResult = classifyAndRoute(queryText, {
      selectedModel: model,
      conversationLength: sanitizedMessages.length,
      hasAttachments,
      systemPromptLength: systemPrompt.length,
      mode: model ?? "auto",
    });
    console.log(
      `[Chat-Route] conv=${convId} model=${routeResult.primaryModel.id} ` +
      `category=${routeResult.classification.category} complexity=${routeResult.classification.complexity.toFixed(2)} ` +
      `thinking=${routeResult.classification.needsThinking} override=${routeResult.isUserOverride} ` +
      `fallbacks=[${routeResult.fallbackChain.map((m) => m.id).join(",")}]`
    );

    // Use the model's actual max output tokens from the registry (Pioneer API uses exclusive upper bound)
    const maxTokens = routeResult.recommendedMaxTokens;

    // Log AI operation start with telemetry
    logAIOperation("streamText", {
      modelId: routeResult.primaryModel.id,
      userId,
      conversationId: convId,
      extra: {
        mode: isJobMode ? "jobs" : "normal",
        tools: Object.keys(allTools).length,
        steps: maxSteps,
        reasoning: routeResult.reasoning?.type ?? "off",
        complexity: routeResult.classification.complexity.toFixed(2),
      },
    });

    console.log(
      `[Chat-Stream] Start conv=${convId} user=${userId} mode=${isJobMode ? "jobs" : "normal"} ` +
      `tools=${Object.keys(allTools).length} steps=${maxSteps} tokens=${maxTokens} messages=${modelMessages.length} ` +
      `sys=${systemPrompt.length} chars ` +
      `reasoning=${routeResult.reasoning?.type ?? "off"}`
    );

    const result = streamText({
      model: routeResult.model,
      system: systemPrompt,
      messages: modelMessages,
      tools: allTools as Parameters<typeof streamText>[0]["tools"],
      stopWhen: stepCountIs(maxSteps),
      maxOutputTokens: maxTokens,
      // Enable reasoning/thinking mode when appropriate
      ...(routeResult.reasoning && {
        reasoning: {
          type: routeResult.reasoning.type,
          summarize: routeResult.reasoning.summarize,
        },
      }),
      // Use telemetry helper for consistent observability
      ...createTelemetryConfig({
        userId,
        conversationId: convId,
        chatType: isJobMode ? "jobs" : "mail",
        operation: "streamText",
        metadata: {
          modelId: routeResult.primaryModel.id,
          reasoning: routeResult.reasoning?.type ?? "off",
          complexity: routeResult.classification.complexity,
          category: routeResult.classification.category,
        },
      }),
      onStepFinish: (event) => {
        console.log(
          `[Chat-Step] conv=${convId} step=${(event as unknown as { stepType?: string }).stepType} ` +
          `text=${event.text ? `"${event.text.slice(0, 120)}"` : "<empty>"} ` +
          `finish=${event.finishReason} usage=${JSON.stringify(event.usage)} ` +
          `tools=${event.toolCalls?.length ?? 0}`
        );
        if (event.toolCalls && event.toolCalls.length > 0) {
          for (const tc of event.toolCalls) {
            console.log(`[tool-call] mail/${convId}: ${tc.toolName}`, JSON.stringify((tc as unknown as { args?: unknown; input?: unknown }).args ?? (tc as unknown as { input?: unknown }).input).slice(0, 200));
          }
        }
        if (event.toolResults && event.toolResults.length > 0) {
          for (const tr of event.toolResults) {
            const trAny = tr as unknown as { result?: unknown; output?: unknown };
            const trVal = trAny.result ?? trAny.output;
            const res = typeof trVal === "string" ? trVal : JSON.stringify(trVal);
            console.log(`[tool-result] mail/${convId}: ${tr.toolName}=${res.slice(0, 200)}`);
          }
        }
      },
      onFinish: (event) => {
        const finalText = event.text ?? "";
        console.log(
          `[Chat-Finish] conv=${convId} finish=${event.finishReason} ` +
          `textLen=${finalText.length} steps=${event.steps.length} ` +
          `usage=${JSON.stringify(event.usage)}`
        );
        if (finalText.trim().length === 0) {
          console.warn(`[Chat-Finish] EMPTY TEXT conv=${convId} — model produced no visible text!`);
        }
        // Log cost for telemetry
        if (event.usage) {
          logAICost(
            routeResult.primaryModel.id,
            event.usage.inputTokens ?? 0,
            event.usage.outputTokens ?? 0,
            "chat-completion"
          );
        }
        // Build assistant message synchronously
        const assistantMsg: UIMessage = {
          id: generateId(),
          role: "assistant",
          parts: finalText.trim().length > 0
            ? [{ type: "text", text: finalText }]
            : [{ type: "text", text: "" }],
        };
        const allMessages: UIMessage[] = sanitizeMessages([...sanitizedMessages, assistantMsg]);
        const capturedText = event.text ?? "";

        // Fire-and-forget: do NOT await — stream closes immediately, work runs in background
        void (async () => {
          // 1. Save conversation + all messages to InsForge
          try {
            const title = generateTitle(allMessages);
            // Use a single base timestamp and increment by index to guarantee
            // chronological ordering matches conversation order (user before assistant).
            const saveBase = Date.now();
            const messagesToSave = allMessages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m, i) => ({
                id: m.id ?? generateId(),
                conversationId: convId,
                role: m.role as "user" | "assistant",
                parts: m.parts ?? [],
                createdAt: (m as unknown as { createdAt?: Date }).createdAt ?? new Date(saveBase + i),
              }));
            // Sequential: conversation row must exist before messages (FK constraint)
            await saveConversation(convId, userId, "mail", title);
            await saveMessages(messagesToSave, userId);
            if (allMessages.filter((m) => m.role === "assistant").length === 1) {
              await updateConversationTitle(convId, title, userId);
            }
          } catch (e) {
            console.warn("[chat-store] Failed to save conversation:", e);
          }

          // 2. Memory: session summary (inline, needed for next turn) + buffer write (async Dream Cycle)
          try {
            const chatMessages = [
              ...sanitizedMessages
                .filter((m: UIMessage) => m.role === "user" || m.role === "assistant")
                .map((m: UIMessage) => ({
                  role: m.role as "user" | "assistant",
                  text: m.parts
                    ?.filter((p) => p.type === "text")
                    .map((p) => (p as { type: "text"; text: string }).text)
                    .join(" ") ?? "",
                })),
              { role: "assistant" as const, text: capturedText },
            ];

            // Session summary stays inline — needed immediately for next turn
            await updateSessionSummary(
              userId, "mail", sessionKey,
              chatMessages.map((m) => ({ role: m.role, text: m.text })),
            );

            // Write to buffer for async Dream Cycle processing (facts + graph extraction deferred)
            await writeToBuffer(userId, convId, chatMessages);

            // On-demand Dream Cycle trigger: if this user's buffer crossed the
            // threshold, fire a single-user QStash run instead of waiting for
            // the daily sweeper. Fire-and-forget; never blocks the chat reply.
            try {
              if (await shouldRunDreamCycle(userId)) {
                void workflowClient
                  .trigger({
                    url: workflowUrl("dream-cycle"),
                    body: { userId },
                    workflowRunId: `dream-${userId}-${Date.now()}`,
                  })
                  .catch((err) => {
                    console.warn("[chat] Dream Cycle trigger failed (non-blocking):", err);
                  });
              }
            } catch (err) {
              console.warn("[chat] shouldRunDreamCycle threw (non-blocking):", err);
            }

            // Real-time extraction: immediately persist high-importance facts
            // (closes the gap between message and recall — no waiting for Dream Cycle)
            const lastUserMsg = chatMessages.filter((m) => m.role === "user").pop();
            if (lastUserMsg && shouldExtractInline(lastUserMsg.text)) {
              void extractAndStoreInline(userId, lastUserMsg.text, capturedText).then((r) => {
                if (r.stored > 0) {
                  console.log(`[realtime-memory] Inline extracted ${r.stored} facts for user ${userId}`);
                }
              }).catch(() => { /* non-blocking */ });
            }
          } catch (e) {
            console.warn("[memory] Failed to process memory:", e);
          }

          // 3. Procedural memory: track tool usage patterns (fire-and-forget)
          try {
            const toolsUsed = event.steps
              .flatMap((s) => (s.toolCalls ?? []).map((tc: { toolName: string }) => tc.toolName))
              .filter(Boolean);
            if (toolsUsed.length > 0) {
              const patterns = inferPatternsFromToolUsage([...new Set(toolsUsed)]);
              await Promise.allSettled(
                patterns.map((p) => observePattern(userId, p.patternType, p.patternKey, p.observation))
              );
            }
          } catch {
            // non-blocking
          }
        })();
      },
    });

    console.log(`[Chat-Stream] Returning UIMessage stream for conv=${convId}`);
    return result.toUIMessageStreamResponse({
      originalMessages: sanitizedMessages,
      generateMessageId: () => generateId(),
      headers: { "X-Conversation-Id": convId },
      onError: (error) => {
        console.error(`[Chat-Stream-Error] conv=${convId}:`, error);
        if (error instanceof Error) return error.message;
        return "An error occurred";
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Not authenticated") ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}


// Force Turbopack reload