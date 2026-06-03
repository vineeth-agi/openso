/**
 * Per-user Telegram Webhook — Full AI agent with all connected apps
 *
 * URL: POST /api/telegram/webhook/[userId]
 *
 * Implements patterns from OpenClaw (openclaw.ai) & chatgpt-telegram-bot:
 *  - Placeholder → editMessageText (user sees instant "⏳" then the real answer)
 *  - Long message splitting at paragraph boundaries (Telegram 4096 char limit)
 *  - HTML → plain-text fallback (Telegram rejects bad entities silently)
 *  - Typing indicator loop (refreshed every 4s while AI is working)
 *  - All connected apps: Gmail, GitHub
 *  - Memory context + memory tools (rememberFact, recallMemory, getUserProfile)
 *  - Daytona sandbox for code execution
 *  - Multi-step tool calls (up to 10 steps)
 *
 * Uses createAdminClient everywhere — no session cookies required in webhooks.
 */
import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";

import { streamText, stepCountIs } from "ai";
import { format } from "date-fns";

import { classifyAndRoute, type RouteResult } from "@/lib/ai/model-router";
import { createTelemetryConfig, logAIOperation, logAICost } from "@/lib/ai/telemetry";
import { saveConversation, saveMessages, getMessages } from "@/lib/chat-store";
import { createAdminClient } from "@/lib/insforge/admin";
import { discoverMCPTools, getMCPServers } from "@/lib/mcp";
import { writeToBuffer, shouldRunDreamCycle } from "@/lib/memory/dream-cycle";
import { extractFacts } from "@/lib/memory/extractor";
import { inferPatternsFromToolUsage, observePattern } from "@/lib/memory/procedural";
import { shouldExtractInline, extractAndStoreInline } from "@/lib/memory/realtime-extractor";
import { getMemoryContext, formatMemoryPrompt } from "@/lib/memory/retriever";
import { updateSessionSummary } from "@/lib/memory/session";
import { addFact } from "@/lib/memory/store";
import { buildMemoryTools } from "@/lib/memory/tools";
import { buildProfileTools } from "@/lib/profile/chat-tools";
import { rateLimit } from "@/lib/rate-limit";
import { timingSafeEqualStr } from "@/lib/security/timing-safe";
import { decryptToken } from "@/lib/security/token-crypto";
import { buildDaytonaTools } from "@/lib/tools/daytona-tools";
import {
  buildWebSearchTools,
  buildDeepResearchTool,
  buildDiagramTools,
  buildReportTools,
} from "@/lib/tools/extra-tools";
import { getConnectedSlugsAdmin, fetchNativeAppToolsAdmin } from "@/lib/tools/telegram";
import { routeUserIntent } from "@/lib/tools/tool-router";
import { workflowClient, workflowUrl } from "@/lib/workflow/client";

export const runtime = "nodejs";
export const maxDuration = 60;

// ── Deduplication — prevent reprocessing on Telegram retries ────────────────
// In-memory LRU: holds last 200 update_ids for ~5 min. Safe because Vercel
// serverless functions are short-lived; Telegram only retries on timeouts.
const recentUpdateIds = new Map<number, number>();
const DEDUP_MAX = 200;
const DEDUP_TTL_MS = 5 * 60 * 1000;

// Cache MCP tool discovery results (2-minute TTL) — avoids re-connecting every request
let _mcpCache: { tools: Record<string, unknown>; discoveredCount: number; ts: number } | null = null;
const MCP_CACHE_TTL_MS = 2 * 60 * 1000;

function isDuplicate(updateId: number): boolean {
  const now = Date.now();
  // Prune expired entries
  if (recentUpdateIds.size > DEDUP_MAX) {
    for (const [id, ts] of recentUpdateIds) {
      if (now - ts > DEDUP_TTL_MS) recentUpdateIds.delete(id);
    }
  }
  if (recentUpdateIds.has(updateId)) return true;
  recentUpdateIds.set(updateId, now);
  return false;
}

// ── Error cooldown — prevent error spam (matches OpenClaw errorCooldownMs) ──
const lastErrorTime = new Map<number, number>();
const ERROR_COOLDOWN_MS = 60_000;

// ── Telegram Bot API helpers ─────────────────────────────────────────────────

/** Low-level Telegram API call — returns parsed JSON */
async function tgApi(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: any; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Strip HTML to plain text (for fallback when Telegram rejects HTML) */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/**
 * Split long text into ≤ 4000-char chunks at paragraph boundaries.
 * Mirrors OpenClaw's `textChunkLimit` + `chunkMode="newline"`.
 */
function splitMessage(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    // Find a paragraph break (double newline) before the limit
    let splitAt = remaining.lastIndexOf("\n\n", limit);
    // Fall back to single newline
    if (splitAt < limit * 0.3) splitAt = remaining.lastIndexOf("\n", limit);
    // Fall back to space
    if (splitAt < limit * 0.3) splitAt = remaining.lastIndexOf(" ", limit);
    // Hard cut as last resort
    if (splitAt < limit * 0.3) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

/**
 * Send a placeholder message and return its message_id.
 * Mirrors OpenClaw's "preview message" pattern.
 */
async function sendPlaceholder(
  botToken: string,
  chatId: number,
  text = "⏳",
): Promise<number | null> {
  try {
    const r = await tgApi(botToken, "sendMessage", { chat_id: chatId, text });
    return r.ok ? r.result?.message_id ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Edit a previously-sent message (the placeholder) with the final reply.
 * Tries HTML first, falls back to plain text.
 * Returns true if edit succeeded.
 */
async function editMessage(
  botToken: string,
  chatId: number,
  messageId: number,
  text: string,
): Promise<boolean> {
  try {
    const r1 = await tgApi(botToken, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
    });
    if (r1.ok) return true;
    console.warn("[tg] editMessage HTML failed:", r1.description);
    const r2 = await tgApi(botToken, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: stripHtml(text),
    });
    return r2.ok;
  } catch {
    return false;
  }
}

/**
 * Send one or more fresh messages (for subsequent chunks or when edit fails).
 * Tries HTML first, falls back to plain text.
 */
async function sendMessage(botToken: string, chatId: number, text: string): Promise<void> {
  try {
    const r1 = await tgApi(botToken, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });
    if (r1.ok) return;
    console.warn("[tg] sendMessage HTML failed:", r1.description);
    const r2 = await tgApi(botToken, "sendMessage", {
      chat_id: chatId,
      text: stripHtml(text),
    });
    if (!r2.ok) console.error("[tg] plain send also failed:", r2.description);
  } catch (e) {
    console.error("[tg] sendMessage error:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }
}

/**
 * Deliver a full reply to the user — edits placeholder for first chunk,
 * sends additional chunks as new messages. Splits at paragraph boundaries.
 */
async function deliverReply(
  botToken: string,
  chatId: number,
  fullText: string,
  placeholderMsgId: number | null,
): Promise<void> {
  const chunks = splitMessage(fullText);
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0 && placeholderMsgId) {
      const edited = await editMessage(botToken, chatId, placeholderMsgId, chunks[i]);
      if (!edited) await sendMessage(botToken, chatId, chunks[i]);
    } else {
      await sendMessage(botToken, chatId, chunks[i]);
    }
  }
}

/** Typing indicator that repeats every 4s until aborted. */
function startTypingLoop(botToken: string, chatId: number): { stop: () => void } {
  let active = true;
  const tick = () => {
    if (!active) return;
    tgApi(botToken, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  };
  tick(); // fire immediately
  const iv = setInterval(tick, 4000);
  return { stop: () => { active = false; clearInterval(iv); } };
}

/**
 * Ack reaction — send 👀 emoji reaction on the user's message (OpenClaw pattern).
 * Shows the user we received their message before AI starts processing.
 */
async function setAckReaction(
  botToken: string,
  chatId: number,
  messageId: number,
  emoji: string = "👀",
): Promise<void> {
  try {
    await tgApi(botToken, "setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    });
  } catch {
    // Non-critical — some bots may lack reaction permissions
  }
}

/** Remove ack reaction after processing is done */
async function removeAckReaction(
  botToken: string,
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    await tgApi(botToken, "setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [],
    });
  } catch {
    // Non-critical
  }
}

/** Set success ✅ or error ❌ reaction (OpenClaw/Hermes pattern) */
async function setFinalReaction(
  botToken: string,
  chatId: number,
  messageId: number,
  success: boolean,
): Promise<void> {
  try {
    await tgApi(botToken, "setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji: success ? "✅" : "❌" }],
    });
  } catch {
    // Non-critical — some bots may lack reaction permissions
  }
}

/**
 * Download a Telegram file (voice, photo, document) and return its Buffer.
 * Used for voice transcription and image/document handling.
 */
async function downloadTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{ buffer: Buffer; filePath: string } | null> {
  try {
    const fileInfo = await tgApi(botToken, "getFile", { file_id: fileId });
    if (!fileInfo.ok || !fileInfo.result?.file_path) return null;
    const url = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuf), filePath: fileInfo.result.file_path };
  } catch (e) {
    console.error("[tg] downloadFile error:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return null;
  }
}

/**
 * Transcribe a voice message using multimodal AI.
 * Falls back to returning a placeholder if transcription fails.
 */
async function transcribeVoice(_buffer: Buffer, _mimeType: string): Promise<string> {
  // DeepSeek V4 Flash does not support audio input (supportsAudioInput: false).
  // Voice messages are acknowledged but cannot be transcribed with the current
  // model. Users are prompted to send text instead.
  return "[I received your voice message, but I currently can't transcribe audio. Please send your message as text instead!]";
}

/** Human-readable tool progress labels */
const TOOL_PROGRESS_LABELS: Record<string, string> = {
  // Gmail
  gmail_search_messages: "📧 Searching emails...",
  gmail_read_message: "📧 Reading email...",
  gmail_send_message: "📧 Sending email...",
  gmail_reply_message: "📧 Replying to email...",
  gmail_trash_message: "📧 Moving to trash...",
  gmail_forward_message: "📧 Forwarding email...",
  gmail_download_attachment: "📧 Downloading attachment...",
  // GitHub
  github_list_repos: "💻 Listing repositories...",
  github_list_issues: "💻 Checking issues...",
  github_get_issue: "💻 Reading issue...",
  github_create_issue: "💻 Creating issue...",
  github_update_issue: "💻 Updating issue...",
  github_list_issue_comments: "💻 Loading comments...",
  github_create_issue_comment: "💻 Commenting on issue...",
  github_list_pull_requests: "💻 Checking pull requests...",
  github_get_pull_request: "💻 Reading PR...",
  github_create_pull_request: "💻 Creating PR...",
  github_merge_pull_request: "💻 Merging PR...",
  github_list_pr_files: "💻 Listing PR files...",
  github_list_pr_reviews: "💻 Loading PR reviews...",
  github_create_pr_review: "💻 Reviewing PR...",
  github_get_file_contents: "💻 Reading file...",
  github_search_code: "💻 Searching code...",
  // Memory
  rememberFact: "🧠 Remembering...",
  recallMemory: "🧠 Recalling...",
  getUserProfile: "🧠 Loading profile...",
  forgetFact: "🧠 Forgetting...",
  setReminder: "⏰ Setting reminder...",
  scheduleRecurringTask: "🔄 Scheduling task...",
  listScheduledTasks: "📋 Listing tasks...",
  // Code & sandbox
  runCode: "⚙️ Running code...",
  create_sandbox: "🖥️ Creating sandbox...",
  execute_command: "🖥️ Running command...",
  write_file: "🖥️ Writing file...",
  read_file: "🖥️ Reading file...",
  delete_sandbox: "🖥️ Cleaning up sandbox...",
  // Web & research
  web_search: "🌐 Searching the web...",
  scrape_url: "🌐 Reading webpage...",
  deepResearch: "🔬 Deep researching...",
  create_diagram: "📐 Drawing diagram...",
  generate_visual_report: "📊 Generating report...",
};

function getToolProgressText(toolNames: string[]): string {
  if (toolNames.length === 0) return "🔧 Working...";
  const label = TOOL_PROGRESS_LABELS[toolNames[0]];
  if (label) return label;
  return `🔧 ${toolNames[0].replace(/_/g, " ")}...`;
}

// ── System prompt — mirrors main chat, adds Telegram formatting rules ─────────
interface IntentFlags {
  needsDaytona?: boolean;
  needsContribution?: boolean;
  needsWebSearch?: boolean;
  needsResearch?: boolean;
  [key: string]: unknown;
}

function buildSystemPrompt(memoryPrompt: string, connectedApps: string[], intent?: IntentFlags): string {
  const now = format(new Date(), "EEEE, MMMM do, yyyy 'at' h:mm a");
  const appList = connectedApps.length > 0 ? connectedApps.join(", ") : "none";

  const prWorkflowSection = (intent?.needsContribution || intent?.needsDaytona)
    ? `
OPEN SOURCE PR WORKFLOW (follow this exact sequence when asked to open a PR or fix an issue):
1. github_get_issue — fetch the issue to understand what needs to change.
2. github_fork_repo — fork the UPSTREAM repo (e.g. mem0ai/mem0), not your own fork.
3. github_create_branch — create a branch named fix/<issue-number>-<short-description> in YOUR FORK.
4. To find the right files to edit: ALWAYS search the UPSTREAM repo (owner=original org) NOT your fork.
   Use github_search_code with repo:<upstream-owner>/<repo> to locate files.
   Use github_get_file_contents with the UPSTREAM owner to read them.
5. github_update_file — write the fix. Use YOUR FORK as owner (not the upstream org).
   You MUST include the current file's sha from the get_file_contents response.
   Branch MUST be the branch you created in step 3.
6. github_create_pull_request — open the PR from YOUR FORK branch → UPSTREAM default branch.
   Title format: "fix: <short description> (closes #<issue-number>)".
   Body: explain what changed and why, reference the issue.
7. Tell the user the PR URL.

CRITICAL PATH RULES:
- NEVER call github_get_file_contents with an empty path or a path ending in "/"
- If a file path returns 404, call github_get_file_contents with just the parent directory path to list its contents (e.g. "src/lib" not "src/lib/")
- Search code in the UPSTREAM repo. Create/update files in YOUR FORK
- Do NOT hallucinate file paths — always verify with search or directory listing first
- Complete the PR in one session — do NOT stop at exploration`
    : "";

  return `You are Jarvis, a powerful AI assistant. The user is chatting with you via Telegram.
Current date/time (UTC): ${now}
Connected apps: ${appList}
${memoryPrompt ? `\n${memoryPrompt}` : ""}

TELEGRAM FORMATTING RULES (critical — Telegram HTML only, no markdown):
- Use <b>bold</b>, <i>italic</i>, <code>inline code</code>
- Code blocks: <pre><code>code here</code></pre>
- Links: <a href="url">text</a>
- Lists: numbered lines or "-" bullets
- NO asterisks, NO backtick fences, NO # headers
- Keep replies concise — this is a chat interface

CRITICAL BEHAVIOR RULES:
- When a user asks about emails (ANY wording: "emails", "mails", "inbox", "unread", "unreadmails", etc.),
  IMMEDIATELY call gmail_search_messages. Do NOT ask what kind of emails. Just do it.
- When a user asks about GitHub, IMMEDIATELY call github_list_repos or the appropriate tool.
- NEVER ask for clarification before using a tool — just use the most reasonable interpretation.
- After getting tool results, ALWAYS write a clear text response summarizing what you found.
- If a tool returns an error like {"error": "...", try to help or explain briefly.
- You MUST produce a text reply after every tool call — never end on a tool call alone.
- Use rememberFact to save important things the user tells you.
- Use recallMemory when the user asks about something you might have remembered.

WEB SEARCH & SCRAPING:
- When the user asks about current events, news, "what is X", "look up", or anything requiring up-to-date internet info, use the 'web_search' tool.
- Use 'sources: ["web", "news"]' when the query is about recent events or breaking news.
- Use 'categories: ["github"]' for code/repo searches, '"research"' for academic papers.
- Use 'tbs' for time filtering: 'qdr:d' (past day), 'qdr:w' (past week), 'qdr:m' (past month).
- When the user shares a URL and asks to read/summarize it, use the 'scrape_url' tool.
- After searching, if you need more detail from a specific result, scrape that URL.

VISUAL REPORTS & CHARTS:
- When the user asks for charts, reports, dashboards, or data visualization, use the 'generate_visual_report' tool.
- Pass ALL the data and a detailed description of what to show (charts, tables, KPIs, sections).

DEEP RESEARCH:
- When asked to research a startup idea or market analysis, use the 'deepResearch' tool.
- It returns comprehensive analysis with verdict, market sizing, competitors, and go-to-market strategy.

DIAGRAMS:
- When asked to draw a diagram, UML, flowchart, or architecture diagram, use 'create_diagram'.
- Returns a draw.io URL the user can open.

GITHUB RULES:
- When given a specific repo URL, use THAT exact owner/repo
- If you don't know the repo, call github_list_repos first
- NEVER pass empty strings as owner/repo
${prWorkflowSection}
DAYTONA SANDBOX:
- For "write a script", "test this code", "run code", use Daytona sandbox tools.
- Use 'create_sandbox' → 'write_file'/'execute_command' → report results → 'delete_sandbox'.`;
}

// ── Main webhook handler ──────────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Deduplicate — Telegram retries on timeout, so the same update_id can arrive twice
  const updateId: number | undefined = update?.update_id;
  if (updateId && isDuplicate(updateId)) {
    console.log(`[tg/webhook] Duplicate update_id=${updateId}, skipping`);
    return NextResponse.json({ ok: true });
  }

  // Handle text messages, voice messages, photos, and documents
  const message = update?.message;
  if (!message?.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  // Skip unsupported update types (edited messages, channel posts, etc.)
  if (!message.text && !message.voice && !message.audio && !message.photo && !message.document && !message.caption) {
    return NextResponse.json({ ok: true });
  }

  const chatId: number = message.chat.id;
  const msgId: number = message.message_id;
  const text: string = (message.text || message.caption || "").trim();
  const fromName: string = message.from?.first_name ?? message.chat?.first_name ?? "there";

  // Voice/audio message handling — extract fileId for later transcription
  let voiceFileId: string | null = null;
  let voiceMimeType = "audio/ogg";
  if (message.voice) {
    voiceFileId = message.voice.file_id;
    voiceMimeType = message.voice.mime_type || "audio/ogg";
  } else if (message.audio) {
    voiceFileId = message.audio.file_id;
    voiceMimeType = message.audio.mime_type || "audio/mpeg";
  }

  // Photo handling — get highest resolution
  let photoFileId: string | null = null;
  if (message.photo && message.photo.length > 0) {
    photoFileId = message.photo[message.photo.length - 1].file_id;
  }

  // Document handling
  let documentFileId: string | null = null;
  let documentFileName: string | null = null;
  if (message.document) {
    documentFileId = message.document.file_id;
    documentFileName = message.document.file_name || "document";
  }

  // Must have at least text, voice, photo, or document
  if (!text && !voiceFileId && !photoFileId && !documentFileId) {
    return NextResponse.json({ ok: true });
  }

  const db = createAdminClient();

  // Load user profile with bot token + webhook secret
  const { data: profile, error: profileErr } = await db.database.from("profiles")
    .select("id, full_name, telegram_bot_token, telegram_chat_id, telegram_webhook_secret")
    .eq("id", userId)
    .single();

  if (profileErr) {
    console.error("[tg/webhook] DB profile fetch error:", profileErr.message, "userId:", userId);
  }

  if (!profile?.telegram_bot_token) {
    console.warn("[tg/webhook] No bot token for userId:", userId);
    return NextResponse.json({ ok: true }); // Bot not configured or migration not run
  }

  // Validate webhook secret — Telegram sends it in X-Telegram-Bot-Api-Secret-Token header.
  // Use constant-time comparison to avoid timing-oracle leaks (Finding 17).
  const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (
    profile.telegram_webhook_secret &&
    !timingSafeEqualStr(incomingSecret, profile.telegram_webhook_secret)
  ) {
    console.warn("[tg/webhook] Invalid webhook secret for userId:", userId);
    return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
  }

  // Decrypt the stored bot token (Finding 22 — tokens are wrapped with
  // AES-256-GCM at rest). Legacy plaintext rows pass through unchanged.
  const token = decryptToken(profile.telegram_bot_token) ?? "";
  if (!token) {
    console.error("[tg/webhook] Could not decrypt bot token for userId:", userId);
    return NextResponse.json({ ok: true });
  }

  // ── Return 200 IMMEDIATELY — process async via after() ────────────────────
  // Per official Telegram docs: "In case of an unsuccessful request... we will
  // repeat the request." If AI takes 30+s, Telegram times out and retries.
  // OpenClaw pattern: validate + ACK fast, then process asynchronously.
  after(processMessage(userId, chatId, msgId, text, fromName, token, profile, {
    voiceFileId, voiceMimeType, photoFileId, documentFileId, documentFileName,
  }));

  return NextResponse.json({ ok: true });
}

// ── Async message processor (runs after 200 is sent to Telegram) ─────────
async function processMessage(
  userId: string,
  chatId: number,
  userMessageId: number,
  text: string,
  fromName: string,
  token: string,
  profile: { full_name?: string; telegram_chat_id?: number },
  media?: {
    voiceFileId: string | null;
    voiceMimeType: string;
    photoFileId: string | null;
    documentFileId: string | null;
    documentFileName: string | null;
  },
) {
  const db = createAdminClient();

  // ── /start command — link Telegram chat to user account ──────────────────
  if (text.startsWith("/start")) {
    // Always update chat_id on /start (handles re-linking or first-time linking)
    await db.database.from("profiles").update({ telegram_chat_id: chatId }).eq("id", userId);
    await sendMessage(
      token, chatId,
      `✅ <b>Connected!</b>\n\nHey <b>${profile.full_name ?? fromName}</b>! I'm Jarvis — your AI assistant.\n\nI have access to all your connected apps (Gmail, GitHub, and more). Just ask me anything!\n\nTry: "Check my emails" or "List my GitHub repos"`,
    );
    return;
  }

  // ── /status command ───────────────────────────────────────────────────────
  if (text === "/status") {
    const slugs = await getConnectedSlugsAdmin(userId);
    const appList = slugs.length > 0 ? slugs.join(", ") : "none";
    await sendMessage(
      token, chatId,
      `✅ <b>Jarvis Status</b>\n\nAccount: <b>${profile.full_name ?? "Linked"}</b>\nConnected apps: <code>${appList}</code>`,
    );
    return;
  }

  // ── /help command ─────────────────────────────────────────────────────────
  if (text === "/help") {
    await sendMessage(
      token, chatId,
      `<b>Jarvis — What I can do:</b>\n\n📧 Read &amp; send Gmail\n💻 Manage GitHub repos, issues, PRs, reviews\n🧠 Remember things about you\n🔬 Deep research any topic\n🌐 Search the web\n💻 Run code in a sandbox\n🎙️ Send voice messages — I'll transcribe &amp; respond\n📷 Send photos — I can analyze them\n\n<b>Commands:</b>\n/new — Start a new conversation\n/status — Show connected apps\n/help — Show this message`,
    );
    return;
  }

  // ── /new command — start fresh conversation (OpenClaw/Hermes pattern) ───
  if (text === "/new") {
    // Clear conversation by using a new convId with timestamp
    await sendMessage(token, chatId, "🆕 Starting a fresh conversation! Previous context cleared.");
    return;
  }

  // ── Auto-link chat if not linked yet (no need to require /start) ─────────
  if (!profile.telegram_chat_id) {
    await db.database.from("profiles").update({ telegram_chat_id: chatId }).eq("id", userId);
    // Update local reference so the rest of the handler works
    profile.telegram_chat_id = chatId;
  }

  // ── Full AI response with complete tool stack ─────────────────────

  // 0. Stable conversation ID per Telegram chat
  //    /new resets by appending a timestamp suffix
  const isNewConvo = text === "/new";
  const convId = isNewConvo
    ? `tg-${userId}-${chatId}-${Date.now()}`
    : `tg-${userId}-${chatId}`;

  // 0a. Ack reaction — instantly show 👀 on the user's message (OpenClaw pattern)
  await setAckReaction(token, chatId, userMessageId);

  // 0b. Send placeholder + start typing indicator loop
  const placeholderMsgId = await sendPlaceholder(token, chatId);
  const typing = startTypingLoop(token, chatId);

  // 0c. Handle voice messages — download and transcribe
  if (media?.voiceFileId && !text) {
    try {
      const file = await downloadTelegramFile(token, media.voiceFileId);
      if (file) {
        if (placeholderMsgId) {
          await editMessage(token, chatId, placeholderMsgId, "🎙️ Transcribing voice message...");
        }
        text = await transcribeVoice(file.buffer, media.voiceMimeType);
        console.log("[tg/webhook] Voice transcribed: chars=%d", text.length);
      } else {
        text = "[User sent a voice message but download failed]";
      }
    } catch (e) {
      console.error("[tg/webhook] Voice processing error:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      text = "[User sent a voice message but processing failed]";
    }
  }

  // 0d. Handle photos — download and include as multimodal content
  let photoBase64: string | null = null;
  if (media?.photoFileId) {
    try {
      const file = await downloadTelegramFile(token, media.photoFileId);
      if (file) {
        photoBase64 = file.buffer.toString("base64");
        if (!text) text = "What do you see in this image? Describe it.";
        console.log("[tg/webhook] Photo downloaded: bytes=%d", file.buffer.length);
      }
    } catch (e) {
      console.error("[tg/webhook] Photo download error:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  // 0e. Handle documents — mention in text context
  if (media?.documentFileId && !text) {
    text = `[User sent a document: ${media.documentFileName || "unknown file"}. Please acknowledge receipt.]`;
  }

  try {
    // 0f. Rate limiting — 20 requests per minute per user
    const rl = await rateLimit(`tg:${userId}`, 20);
    if (!rl.ok) {
      typing.stop();
      await removeAckReaction(token, chatId, userMessageId);
      if (placeholderMsgId) {
        await editMessage(token, chatId, placeholderMsgId, "⏳ You're sending messages too fast. Please wait a moment and try again.");
      } else {
        await sendMessage(token, chatId, "⏳ You're sending messages too fast. Please wait a moment and try again.");
      }
      return;
    }

    // 1. Load conversation history + connected slugs in parallel
    const [connectedSlugs, previousMessages] = await Promise.all([
      getConnectedSlugsAdmin(userId).catch(() => [] as string[]),
      getMessages(convId, userId).catch(() => []),
    ]);

    // Build messages array: history (last 20 turns to keep context window reasonable) + new user message
    const MAX_HISTORY = 20;
    const historyMessages: Array<{ role: "user" | "assistant"; content: string }> = previousMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.parts
          ?.filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ") || "",
      }))
      .filter((m) => m.content.trim().length > 0);

    // Append the new user message (with optional photo as multimodal content)
    if (photoBase64) {
      historyMessages.push({
        role: "user",
        content: [
          { type: "image", image: photoBase64, mimeType: "image/jpeg" },
          { type: "text", text },
        ] as any,
      });
    } else {
      historyMessages.push({ role: "user", content: text });
    }

    console.log(`[tg/webhook] conv=${convId} history=${historyMessages.length - 1} msgs`);

    // 2. Route user intent + load memory context in parallel
    const [intent, memoryPromptResult] = await Promise.all([
      routeUserIntent({ queryText: text, userId, connectedSlugs }),
      getMemoryContext(userId, text, "telegram", String(chatId))
        .then((ctx) => formatMemoryPrompt(ctx))
        .catch(() => ""),
    ]);

    console.log(`[tg/webhook] user=${userId} intent=`, JSON.stringify(intent));

    // 3. Build tool set — full parity with chat route
    const memoryTools = buildMemoryTools(userId);
    const nativeAppTools = intent.requiredConnectedApps && intent.requiredConnectedApps.length > 0
      ? await fetchNativeAppToolsAdmin(userId, intent.requiredConnectedApps)
      : {};
    const daytonaTools = process.env.DAYTONA_API_KEY && intent.needsDaytona
      ? buildDaytonaTools(userId)
      : {};
    const webSearchTools = process.env.FIRECRAWL_API_KEY && intent.needsWebSearch
      ? buildWebSearchTools()
      : {};
    const deepResearchTool = intent.needsResearch ? buildDeepResearchTool() : {};
    const diagramTools = intent.needsDiagram ? buildDiagramTools() : {};
    const reportTools = (intent.needsReport || intent.needsResearch) ? buildReportTools() : {};

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
            console.log(`[tg/webhook] MCP loaded ${mcpResult.discoveredTools.length} tools`);
          }
        }
      }
    } catch (mcpErr) {
      console.warn("[tg/webhook] MCP discovery failed (non-blocking):", mcpErr);
    }

    // Ensure contribution tool is ALWAYS available when needed — it uses Voyage+InsForge,
    // not the user's GitHub token, so GitHub connection is not required.
    if (intent.needsContribution && !nativeAppTools['github_search_contributor_issues']) {
      try {
        const { buildGithubTools } = await import("@/lib/tools/native-tools/github");
        const contributionTools = buildGithubTools(process.env.GITHUB_TOKEN || 'no-token');
        nativeAppTools['github_search_contributor_issues'] = contributionTools['github_search_contributor_issues'];
        console.log('[tg/webhook] Loaded contribution tool via server GITHUB_TOKEN fallback');
      } catch (e) {
        console.warn('[tg/webhook] Failed to load contribution tool fallback:', e);
      }
    }

    // Ensure job-board search tool is ALWAYS available when needed — uses
    // Voyage embeddings + InsForge RPC, no third-party auth.
    if (intent.needsJobBoardSearch && !nativeAppTools['search_job_board_jobs']) {
      try {
        const { buildJobBoardTools } = await import("@/lib/tools/native-tools/job-board");
        const jobBoardTools = buildJobBoardTools(userId);
        nativeAppTools['search_job_board_jobs'] = jobBoardTools['search_job_board_jobs'];
        console.log('[tg/webhook] Loaded job-board search tool');
      } catch (e) {
        console.warn('[tg/webhook] Failed to load job-board tool:', e);
      }
    }

    const profileTools = buildProfileTools(userId);
    const allTools = {
      ...nativeAppTools,
      ...memoryTools,
      ...daytonaTools,
      ...webSearchTools,
      ...deepResearchTool,
      ...diagramTools,
      ...reportTools,
      ...mcpTools,
      ...profileTools,
    };

    console.log(
      `[tg/webhook] tools=${Object.keys(allTools).length} ` +
      `apps=${Object.keys(nativeAppTools).length} connected=[${connectedSlugs.join(",")}]`,
    );

    // 4. Generate reply with block streaming + tool progress
    const systemPrompt = buildSystemPrompt(memoryPromptResult, connectedSlugs, intent);

    // PR/contribution tasks need more steps: fork → search → read files → create branch → edit → PR
    // Regular chat is capped at 10 to avoid runaway tool loops
    const maxSteps = (intent.needsContribution || intent.needsDaytona) ? 25 : 10;

    // ── Auto-route: classify query → pick best model → wrap with fallback + retry ──
    const lastUserText = text;
    const routeResult: RouteResult = classifyAndRoute(lastUserText, {
      conversationLength: historyMessages.length,
      hasAttachments: !!photoBase64,
      systemPromptLength: systemPrompt.length,
      mode: "auto",
    });
    console.log(
      `[tg/webhook] model=${routeResult.primaryModel.id} ` +
      `category=${routeResult.classification.category} complexity=${routeResult.classification.complexity.toFixed(2)} ` +
      `fallbacks=[${routeResult.fallbackChain.map((m) => m.id).join(",")}]`
    );

    const maxTokens = routeResult.recommendedMaxTokens;

    // Log AI operation start with telemetry
    logAIOperation("streamText", {
      modelId: routeResult.primaryModel.id,
      userId,
      conversationId: convId,
      extra: {
        mode: "telegram",
        tools: Object.keys(allTools).length,
        steps: maxSteps,
        complexity: routeResult.classification.complexity.toFixed(2),
      },
    });

    // Use streamText for block streaming — periodically edit the placeholder
    // with accumulated text (respects Telegram rate limits: max 1 edit/2s)
    const stream = streamText({
      model: routeResult.model,
      system: systemPrompt,
      messages: historyMessages,
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
        chatType: "telegram",
        operation: "streamText",
        metadata: {
          modelId: routeResult.primaryModel.id,
          reasoning: routeResult.reasoning?.type ?? "off",
          complexity: routeResult.classification.complexity,
          category: routeResult.classification.category,
        },
      }),
      onStepFinish: (step) => {
        console.log(
          `[tg/webhook] step=${step.finishReason} ` +
          `textLen=${(step.text ?? "").length} ` +
          `tools=${step.toolCalls?.map(t => t.toolName).join(",") ?? "-"}`
        );
        // Tool progress in preview — update placeholder with what tool is running
        if (step.toolCalls && step.toolCalls.length > 0 && placeholderMsgId) {
          const progressText = getToolProgressText(step.toolCalls.map(t => t.toolName));
          editMessage(token, chatId, placeholderMsgId, progressText).catch(() => {});
        }
      },
    });

    // Block streaming — accumulate text and edit placeholder every ~3 seconds
    let accumulatedText = "";
    let lastEditTime = 0;
    const STREAM_EDIT_INTERVAL_MS = 3000; // Telegram rate limit safe: ~20 edits/min

    for await (const chunk of stream.textStream) {
      accumulatedText += chunk;
      const now = Date.now();
      // Edit placeholder with partial text every 3s (block streaming)
      if (
        placeholderMsgId &&
        accumulatedText.length > 10 &&
        now - lastEditTime > STREAM_EDIT_INTERVAL_MS
      ) {
        lastEditTime = now;
        editMessage(token, chatId, placeholderMsgId, accumulatedText + " █").catch(() => {});
      }
    }

    // Wait for full completion (all steps + tool calls)
    const aiReply: string = await stream.text;
    const steps: Array<{ text?: string }> = await stream.steps;

    // 5. Collect text from ALL steps as safety net
    const allStepText = steps
      .map((s) => (s.text ?? "").trim())
      .filter((t) => t.length > 0)
      .join("\n\n");

    const reply = (aiReply?.trim() || allStepText) || "I had trouble forming a reply. Please try again.";

    // 6. Deliver final — edit placeholder with first chunk, send rest as new messages
    typing.stop();
    await setFinalReaction(token, chatId, userMessageId, true);
    await deliverReply(token, chatId, reply, placeholderMsgId);

    // 7. Save conversation + extract memory (non-blocking)
    try {
      const genMsgId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Upsert conversation (creates on first message, updates timestamp on subsequent)
      await saveConversation(convId, userId, "telegram", text.slice(0, 60));
      // Append this turn's messages (unique IDs so they accumulate)
      await saveMessages([
        { id: genMsgId(), conversationId: convId, role: "user", parts: [{ type: "text", text }] },
        { id: genMsgId(), conversationId: convId, role: "assistant", parts: [{ type: "text", text: reply }] },
      ], userId);
    } catch (e) {
      console.warn("[tg/webhook] Failed to save conversation:", e);
    }

    try {
      const sessionKey = `telegram-${chatId}`;
      await updateSessionSummary(userId, "telegram", sessionKey, [
        { role: "user" as const, text },
        { role: "assistant" as const, text: reply },
      ]);

      // Write to buffer for Dream Cycle (observations, associations, reconsolidation)
      await writeToBuffer(userId, convId, [
        { role: "user" as const, text },
        { role: "assistant" as const, text: reply },
      ]);

      // On-demand Dream Cycle trigger: if this user's buffer crossed the
      // threshold, fire a single-user QStash run instead of waiting for the
      // daily sweeper. Fire-and-forget; never blocks the telegram reply.
      try {
        if (await shouldRunDreamCycle(userId)) {
          void workflowClient
            .trigger({
              url: workflowUrl("dream-cycle"),
              body: { userId },
              workflowRunId: `dream-${userId}-${Date.now()}`,
            })
            .catch((err) => {
              console.warn("[telegram] Dream Cycle trigger failed (non-blocking):", err);
            });
        }
      } catch (err) {
        console.warn("[telegram] shouldRunDreamCycle threw (non-blocking):", err);
      }

      const conversationText = `user: ${text}\nassistant: ${reply}`;
      if (conversationText.trim().length > 20) {
        const extracted = await extractFacts(conversationText, "telegram", {
          hint: "Extract facts the user revealed about themselves via Telegram chat.",
        });
        const maxFacts = Number(process.env.MEMORY_MAX_FACTS_PER_TURN ?? "4");
        const prioritized = extracted
          .filter(f => f.fact.trim().length > 0)
          .sort((a, b) => (b.importance + b.confidence) - (a.importance + a.confidence))
          .slice(0, maxFacts);
        await Promise.all(
          prioritized.map(f => addFact(userId, f, "telegram", `tg-${chatId}`))
        );

        // Graph memory extraction — same as chat route
        try {
          const { extractGraph } = await import("@/lib/memory/graph-extractor");
          const { addToGraph } = await import("@/lib/memory/graph-store");
          const graphData = await extractGraph(conversationText, "Telegram chat conversation");
          if (graphData.entities.length > 0 || graphData.relationships.length > 0) {
            await addToGraph(userId, graphData, `tg-${chatId}`);
          }
        } catch (graphErr) {
          console.warn("[tg/webhook] Graph extraction failed (non-blocking):", graphErr);
        }
      }

      // Real-time extraction: immediately persist high-importance facts
      // (closes the gap between message and recall — no waiting for Dream Cycle)
      if (text && shouldExtractInline(text)) {
        void extractAndStoreInline(userId, text, reply).then((r) => {
          if (r.stored > 0) {
            console.log(`[tg/webhook] Inline extracted ${r.stored} facts for user ${userId}`);
          }
        }).catch(() => { /* non-blocking */ });
      }
    } catch (e) {
      console.warn("[tg/webhook] Memory extraction failed (non-blocking):", e);
    }

    // Log cost for telemetry
    try {
      const usage = await stream.usage;
      if (usage) {
        logAICost(
          routeResult.primaryModel.id,
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0,
          "chat-completion"
        );
      }
    } catch {
      // non-blocking
    }

    // Procedural memory: track tool usage patterns from this Telegram turn
    try {
      const toolsUsed = (steps as Array<{ toolCalls?: Array<{ toolName: string }> }>)
        .flatMap((s) => (s.toolCalls ?? []).map((tc) => tc.toolName))
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
  } catch (e) {
    typing.stop();
    console.error("[tg/webhook] Handler error:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));

    // Set error reaction ❌ (OpenClaw/Hermes pattern)
    await setFinalReaction(token, chatId, userMessageId, false);

    // Error cooldown — prevent spam (OpenClaw pattern: errorCooldownMs: 60000)
    const now = Date.now();
    const lastErr = lastErrorTime.get(chatId) ?? 0;
    if (now - lastErr < ERROR_COOLDOWN_MS) {
      console.log(`[tg/webhook] Error cooldown active for chat=${chatId}, suppressing`);
      return;
    }
    lastErrorTime.set(chatId, now);

    if (placeholderMsgId) {
      const edited = await editMessage(token, chatId, placeholderMsgId, "⚠️ Something went wrong. Please try again.");
      if (!edited) await sendMessage(token, chatId, "⚠️ Something went wrong. Please try again.");
    } else {
      await sendMessage(token, chatId, "⚠️ Something went wrong. Please try again.");
    }
  }
}
