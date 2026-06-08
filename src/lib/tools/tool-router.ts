import { generateObject } from "ai";
import { z } from "zod";

import { buildGithubTools } from "./native-tools/github";

import { google } from "@/lib/ai/google-provider";
import { getConnectionAdmin } from "@/lib/connections";
import type { Connection, Provider } from "@/lib/connections";

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
      requiredConnectedApps: [],
    };
  }

  // ALWAYS use the default model for intent
  // classification — it's a simple boolean routing task that must be fast.
  const INTENT_MODEL = process.env.INTENT_ROUTER_MODEL || "grok-4.20-0309-non-reasoning";
  const model = google(INTENT_MODEL);
  
  const schema = z.object({
    needsDaytona: z.boolean().describe("True if user needs to run python, bash, install dependencies, run scripts safely, test system outputs, or requires an isolated execution environment. Also true if user wants to OPEN A PR, fix a bug in a repo, contribute code changes, clone a repo and make edits, or anything that requires writing/modifying files in a codebase."),
    needsMemory: z.boolean().describe("True if the user is asking to remember something, recall a past conversation, get their profile, or forget a fact about them."),
    needsResearch: z.boolean().describe("True if asking for deep market research on a startup or concept."),
    needsDiagram: z.boolean().describe("True if asking to draw a diagram, UML, flowchart, or architecture."),
    needsReport: z.boolean().describe("True if user asks for a visual report, dashboard, chart, data visualization, comparison table, or when deep research results should be presented visually. Also true if user says 'show me a chart', 'visualize this', 'create a report', 'make a dashboard'."),
    needsWebSearch: z.boolean().describe("True if the user is asking about current events, needs to look something up online, asks 'what is X', 'latest news', 'search for', 'look up', 'find info about', wants real-time information, or the answer requires up-to-date internet knowledge. Also true if user shares a URL and wants it read/summarized."),
    needsContribution: z.boolean().describe("True if user wants to find open source issues, bugs, or tasks to contribute to or work on. Detect from: 'find issues', 'open source', 'contribute', 'good first issue', 'beginner issues', 'bugs to fix', 'help with projects', 'want to contribute', 'any issues I can work on', 'show me something to fix', 'i want to help', 'open PR', 'open source contribution', 'find me a bug', 'what can I work on', 'any open issues'. Also true for follow-up queries like 'show more', 'easier ones', 'Python only' if the previous message was about open source."),
    requiredConnectedApps: z.array(z.string()).describe("A list of apps needed based ONLY on connected apps provided via instructions. Example: ['github']"),
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

        const token = conn.access_token;

        if (app === "github") {
          Object.assign(allTools, buildGithubTools(token, conn.github_username ?? undefined, userId));
        }
      }),
    );
    return allTools;
  } catch (error) {
    console.error(`[Native-Tools] Failed to build native tools for user ${userId}`, error);
    return {};
  }
}
