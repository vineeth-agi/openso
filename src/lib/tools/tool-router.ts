import { generateObject } from "ai";
import { google as googleapis } from "googleapis";
import { z } from "zod";

import { buildGithubTools } from "./native-tools/github";
import { buildGmailTools } from "./native-tools/gmail";

import { google } from "@/lib/ai/google-provider";
import { getConnectionAdmin, refreshConnectionTokens } from "@/lib/connections";
import type { Connection, Provider } from "@/lib/connections";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

const GOOGLE_PROVIDERS = new Set<string>(["gmail"]);

/** Refresh an expired Google token and persist to DB. */
async function getFreshGoogleToken(userId: string, conn: Connection): Promise<string | null> {
  if (!conn.access_token) return null;
  const isExpired = conn.expiry_date && Date.now() > conn.expiry_date - 60_000;
  if (!isExpired) return conn.access_token;

  if (!conn.refresh_token || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn(`[tool-router] Cannot refresh ${conn.provider}: missing refresh_token or credentials`);
    return conn.access_token;
  }

  try {
    const oauth2 = new googleapis.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: conn.refresh_token });
    const { credentials } = await oauth2.refreshAccessToken();

    // Persist via the encrypted-write helper (DB-HIGH-01) — never write the
    // raw access_token column directly so encryption is non-skippable.
    await refreshConnectionTokens(userId, conn.provider as Provider, {
      access_token: credentials.access_token ?? null,
      expiry_date: credentials.expiry_date ?? conn.expiry_date,
    });

    console.log(`[tool-router] Refreshed ${conn.provider} token for user`);
    return credentials.access_token ?? conn.access_token;
  } catch (err) {
    console.error(`[tool-router] Token refresh failed for ${conn.provider}:`, err);
    return conn.access_token;
  }
}

interface ToolRouterOptions {
  queryText: string;
  userId: string;
  connectedSlugs: string[];
  conversationHistory?: string;
}

export async function routeUserIntent({ queryText, userId, connectedSlugs, conversationHistory }: ToolRouterOptions) {
  if (!queryText || queryText.trim() === "") {
    return {
      needsDaytona: false,
      needsMemory: false,
      needsResearch: false,
      needsDiagram: false,
      needsReport: false,
      needsWebSearch: false,
      needsContribution: false,
      needsJobBoardSearch: false,
      requiredConnectedApps: [],
    };
  }

  // ALWAYS use the default Pioneer model (DeepSeek V4 Flash) for intent
  // classification — it's a simple boolean routing task that must be fast.
  const INTENT_MODEL = process.env.INTENT_ROUTER_MODEL || "deepseek-ai/DeepSeek-V4-Flash";
  const model = google(INTENT_MODEL);
  
  const schema = z.object({
    needsDaytona: z.boolean().describe("True if user needs to run python, bash, install dependencies, run scripts safely, test system outputs, or requires an isolated execution environment. Also true if user wants to OPEN A PR, fix a bug in a repo, contribute code changes, clone a repo and make edits, or anything that requires writing/modifying files in a codebase."),
    needsMemory: z.boolean().describe("True if the user is asking to remember something, recall a past conversation, set a reminder, schedule a task, create a cron job, set up a recurring task, or anything related to scheduling/reminders/cron. Detect from: 'remind me', 'set a reminder', 'schedule', 'cron job', 'every day at', 'every morning', 'recurring', 'set up a task', 'check my mails daily', 'notify me at', 'list my tasks', 'what reminders do I have'."),
    needsResearch: z.boolean().describe("True if asking for deep market research on a startup or concept."),
    needsDiagram: z.boolean().describe("True if asking to draw a diagram, UML, flowchart, or architecture."),
    needsReport: z.boolean().describe("True if user asks for a visual report, dashboard, chart, data visualization, comparison table, or when deep research results should be presented visually. Also true if user says 'show me a chart', 'visualize this', 'create a report', 'make a dashboard'."),
    needsWebSearch: z.boolean().describe("True if the user is asking about current events, needs to look something up online, asks 'what is X', 'latest news', 'search for', 'look up', 'find info about', wants real-time information, or the answer requires up-to-date internet knowledge. Also true if user shares a URL and wants it read/summarized."),
    needsContribution: z.boolean().describe("True if user wants to find open source issues, bugs, or tasks to contribute to or work on. Detect from: 'find issues', 'open source', 'contribute', 'good first issue', 'beginner issues', 'bugs to fix', 'help with projects', 'want to contribute', 'any issues I can work on', 'show me something to fix', 'i want to help', 'open PR', 'open source contribution', 'find me a bug', 'what can I work on', 'any open issues'. Also true for follow-up queries like 'show more', 'easier ones', 'Python only' if the previous message was about open source."),
    needsJobBoardSearch: z.boolean().describe("True if user wants to find JOBS / careers / openings / hiring / roles at companies. Detect from: 'find me a job', 'jobs at <company>', 'remote jobs', 'senior backend roles', 'YC startup jobs', 'fintech engineer', 'who's hiring', 'careers at Stripe', 'tech jobs in India', 'AI/ML roles', 'data scientist openings'. ALSO true for follow-up queries like 'show more', 'remote only', 'with equity' if the previous message was about jobs. NOT the same as 'open source contribution' — that's needsContribution. If the user wants to PAID employment, use needsJobBoardSearch."),
    requiredConnectedApps: z.array(z.string()).describe("A list of apps needed based ONLY on connected apps provided via instructions. Example: ['github', 'gmail']"),
  });

  try {
    const { object } = await generateObject({
      model,
      schema,
      prompt: `Analyze the user's latest query to route them to the proper tools. 
The user has the following apps connected: [${connectedSlugs.join(", ")}].
Do not invent unconnected apps.

Look for contribution intent in phrases like:
- "find issues to contribute to"
- "help with open source" 
- "beginner-friendly bugs"
- "want to contribute"
- "looking for projects to help"
- "find good first issues"
- "open source contributions"

Look for JOB-BOARD intent (paid employment) in phrases like:
- "find me a job"
- "jobs at <company>"
- "remote jobs"
- "senior backend roles"
- "YC startup jobs"
- "AI/ML roles in San Francisco"
- "who's hiring"
- "careers at Stripe"
- "data scientist openings"
- "tech jobs in India"

Look for SCHEDULING / CRON / REMINDER intent in phrases like:
- "set a cron job"
- "remind me every day at 9pm"
- "schedule a recurring task"
- "check my mails every morning"
- "every Monday send me a summary"
- "set a reminder for tomorrow"
- "list my scheduled tasks"
- "what cron jobs do I have"
These should set needsMemory=true (scheduling tools live in memory tools).

CRITICAL: distinguish needsContribution (unpaid open-source contributions) from needsJobBoardSearch (paid job openings). They are mutually exclusive 99% of the time.

IMPORTANT: Consider the full conversation context when routing. Short follow-up messages like "all", "yes", "do it", "public" etc. should be interpreted in the context of the preceding conversation.
${conversationHistory ? `\nRecent conversation context:\n${conversationHistory}\n` : ""}
User's latest message: "${queryText}"
`,
    });
    
    // Filter out hallucinated apps
    object.requiredConnectedApps = object.requiredConnectedApps.filter(appName => 
      connectedSlugs.includes(appName.toLowerCase())
    );

    // If contribution intent is detected and GitHub is connected, add GitHub to required apps
    if (object.needsContribution && connectedSlugs.includes('github') && !object.requiredConnectedApps.includes('github')) {
      object.requiredConnectedApps.push('github');
    }

    return object;
  } catch (error) {
    console.error("[Intent-Router] Failed to parse intent, falling back with all connected apps.", error);
    return {
      needsDaytona: true,
      needsMemory: true,
      needsResearch: false,
      needsDiagram: false,
      needsReport: false,
      needsWebSearch: true,
      needsContribution: false,
      needsJobBoardSearch: false,
      // Fallback: load tools for ALL connected apps so chat still works
      requiredConnectedApps: connectedSlugs,
    };
  }
}

/**
 * Replaces the old Composio endpoint subsetting.
 * Fetches user tokens from our database and instantly builds native AI tools.
 * 100x faster than triggering remote MCP networks.
 */
export async function fetchNativeAppTools(userId: string, requiredApps: string[]) {
  if (requiredApps.length === 0) return {};

  const allTools: Record<string, unknown> = {};

  try {
    await Promise.all(
      requiredApps.map(async (app) => {
        const conn = await getConnectionAdmin(userId, app as any);
        if (!conn?.access_token) return;

        // For Google services, refresh token if expired
        const token = GOOGLE_PROVIDERS.has(app)
          ? (await getFreshGoogleToken(userId, conn)) ?? conn.access_token
          : conn.access_token;

        if (app === "github") {
          Object.assign(allTools, buildGithubTools(token, conn.github_username ?? undefined, userId));
        } else if (app === "gmail") {
          Object.assign(allTools, buildGmailTools(token));
        }
      }),
    );
    return allTools;
  } catch (error) {
    console.error(`[Native-Tools] Failed to build native tools for user ${userId}`, error);
    return {};
  }
}
