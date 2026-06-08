/**
 * Shared extra tool builders — used by both chat/route.ts and telegram webhook.
 *
 * Extracted from the chat route so Telegram has full feature parity.
 * Includes: web search, deep research, diagrams, and visual reports.
 */
import { tool, generateText, generateObject } from "ai";
import { readFileSync } from "fs";
import { join } from "path";
import { deflateRawSync } from "zlib";
import { z } from "zod";

import { google, getDefaultPioneerModel } from "@/lib/ai/google-provider";
import { firecrawlSearch, firecrawlScrape, firecrawlSearchWithContent, isFirecrawlConfigured } from "@/lib/firecrawl";

// ── Web Search & Scrape Tools (Firecrawl-powered) ──────────────────────────

export function buildWebSearchTools() {
  return {
    web_search: tool({
      description: "Search the internet for current information. Use this when the user asks about recent events, needs to look something up, wants real-time data, or asks 'what is', 'who is', 'latest news about', etc. Returns web results with titles, URLs, and page content.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
        limit: z.number().optional().default(5).describe("Number of results (1-10)"),
        sources: z.array(z.enum(["web", "news"])).optional().default(["web"]).describe("Sources to search: 'web' for general, 'news' for recent news"),
        tbs: z.string().optional().describe("Time filter: 'qdr:h' (past hour), 'qdr:d' (past day), 'qdr:w' (past week), 'qdr:m' (past month), 'qdr:y' (past year)"),
        categories: z.array(z.enum(["github", "research", "pdf"])).optional().describe("Filter by category: 'github' for repos/issues, 'research' for academic papers, 'pdf' for documents"),
      }),
      execute: async ({ query, limit, sources, tbs, categories }) => {
        if (!isFirecrawlConfigured()) return { error: "Web search not configured (missing FIRECRAWL_API_KEY)" };
        try {
          const { web, news } = await firecrawlSearch({
            query,
            limit: Math.min(limit || 5, 10),
            sources: sources || ["web"],
            tbs,
            categories,
            scrapeContent: true,
          });
          const webResults = web.map((r) => ({
            title: r.title,
            url: r.url,
            description: r.description,
            content: r.markdown?.slice(0, 3000) || "",
          }));
          return {
            results: webResults,
            news: news.length > 0 ? news : undefined,
            total: webResults.length + news.length,
          };
        } catch (e) {
          console.error("[web_search] Error:", e);
          return { error: `Search failed: ${(e as Error).message}` };
        }
      },
    }),

    scrape_url: tool({
      description: "Scrape a specific URL and return its content as markdown. Use when the user provides a link and wants you to read/summarize its contents, or when you need to get full page details from a search result URL.",
      inputSchema: z.object({
        url: z.string().url().describe("The URL to scrape"),
      }),
      execute: async ({ url }) => {
        if (!isFirecrawlConfigured()) return { error: "Scrape not configured (missing FIRECRAWL_API_KEY)" };
        try {
          const result = await firecrawlScrape({ url });
          return {
            title: result.metadata?.title || "",
            url,
            content: result.markdown.slice(0, 8000),
            truncated: result.markdown.length > 8000,
          };
        } catch (e) {
          return { error: `Scrape failed: ${(e as Error).message}` };
        }
      },
    }),
  };
}

// ── Diagram Tool (draw.io) ──────────────────────────────────────────────────

export function buildDiagramTools() {
  return {
    create_diagram: tool({
      description: "Generate a draw.io diagram. Use for flowcharts, UML, ER diagrams, architecture, etc.",
      inputSchema: z.object({
        xml: z.string().describe("Complete draw.io XML in mxGraphModel format"),
        title: z.string().optional(),
      }),
      execute: async ({ xml, title }) => {
        if (!xml.includes("mxGraphModel")) return { error: "Invalid draw.io XML" };
        try {
          const encoded = encodeURIComponent(xml);
          const compressed = deflateRawSync(Buffer.from(encoded));
          const base64 = compressed.toString("base64");
          const createObj = JSON.stringify({ type: "xml", compressed: true, data: base64 });
          const drawioUrl = `https://app.diagrams.net/?grid=0&border=10&edit=_blank#create=${encodeURIComponent(createObj)}`;
          return { xml, title: title ?? "Diagram", drawioUrl };
        } catch {
          return { xml, title: title ?? "Diagram", drawioUrl: "https://app.diagrams.net/" };
        }
      },
    }),
  };
}

// ── OpenUI Visual Report Tool ───────────────────────────────────────────────

let _cachedOpenUIPrompt: string | null = null;
function getOpenUIPrompt(): string {
  if (_cachedOpenUIPrompt) return _cachedOpenUIPrompt;
  try {
    _cachedOpenUIPrompt = readFileSync(
      join(process.cwd(), "src/lib/openui/generated/system-prompt.txt"),
      "utf-8"
    );
  } catch (err) {
    console.error("[OpenUI] Failed to read system prompt:", err);
    _cachedOpenUIPrompt = "You are a UI assistant. Generate structured data tables and charts using markdown.";
  }
  return _cachedOpenUIPrompt;
}

export function buildReportTools() {
  return {
    generate_visual_report: tool({
      description: `Generate a beautiful, interactive visual report or dashboard using OpenUI Lang. Use this tool ONLY when:
- The user explicitly asks for a chart, report, dashboard, or data visualization
- Deep research results need to be presented visually
- The user asks to "visualize", "show a chart", "create a report", or "make a dashboard"
Do NOT use this for simple text answers. Pass the data and description of what to visualize.`,
      inputSchema: z.object({
        prompt: z.string().describe("A detailed description of what to visualize. Include ALL the data inline — numbers, labels, categories, values. Describe the layout: what charts, tables, stats, sections to show."),
      }),
      execute: async ({ prompt }) => {
        try {
          const openUIPrompt = getOpenUIPrompt();
          const model = google(process.env.PIONEER_MODEL || getDefaultPioneerModel());
          const { text } = await generateText({
            model,
            system: openUIPrompt,
            prompt,
            maxOutputTokens: 4096,
          });
          return { openui_lang: text };
        } catch (err) {
          console.error("[OpenUI] Report generation failed:", err);
          return { error: "Failed to generate visual report" };
        }
      },
    }),
  };
}

// ── Deep Research Tool ──────────────────────────────────────────────────────

export function buildDeepResearchTool() {
  const researchSchema = z.object({
    summary: z.string(),
    marketSize: z.object({ tam: z.number(), sam: z.number(), som: z.number(), cagr: z.number(), explanation: z.string() }),
    competitors: z.array(z.object({ name: z.string(), strength: z.string(), weakness: z.string(), pricing: z.string() })),
    sentiment: z.object({ redditConsensus: z.string(), xTrend: z.string(), willingnessToPay: z.enum(["low", "medium", "high", "very high"]), painPointIntensity: z.number() }),
    feasibility: z.object({ technicalDifficulty: z.enum(["easy", "medium", "hard", "requires-rd"]), timeToMvp: z.string(), keyChallenges: z.array(z.string()) }),
    goAndMarket: z.object({ channels: z.array(z.string()), targetCustomer: z.string(), suggestedPricing: z.string() }),
    moatAnalysis: z.string(),
    verdict: z.enum(["proceed", "pivot", "abandon"]),
    verdictReason: z.string(),
  });

  return {
    deepResearch: tool({
      description: "Conduct deep market research on a startup idea. Returns comprehensive analysis with verdict (proceed/pivot/abandon), market sizing, competitors, and go-to-market strategy.",
      inputSchema: z.object({ idea: z.string().describe("The startup idea or business concept to research") }),
      execute: async ({ idea }) => {
        try {
          const pioneerModel = google(process.env.PIONEER_MODEL || getDefaultPioneerModel());
          const [scoutResults, librarianResults, pessimistResults] = await Promise.all([
            firecrawlSearchWithContent(`site:reddit.com "${idea}" OR "pain point" OR "alternative to"`, 15, "qdr:y"),
            firecrawlSearchWithContent(`"${idea}" market size growth report 2025 2026`, 15),
            firecrawlSearchWithContent(`competitors for "${idea}" alternatives 2026`, 15),
          ]);
          const fmt = (res: any[]) => res.map(r => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.markdown?.slice(0, 2000)}`).join("\n---\n");
          const evidence = `SCOUT: ${fmt(scoutResults)}\nLIBRARIAN: ${fmt(librarianResults)}\nPESSIMIST: ${fmt(pessimistResults)}`;
          const { object } = await generateObject({ model: pioneerModel, schema: researchSchema, prompt: `You are a senior startup analyst. Research results for "${idea}":\n${evidence}\nGenerate a comprehensive research report.` });
          const sources = [...scoutResults, ...librarianResults, ...pessimistResults].filter(s => s.url).map(s => ({ title: s.title, url: s.url }));
          return { report: { ...object, sources } };
        } catch (e) { return { error: `Research failed: ${(e as Error).message}` }; }
      },
    }),
  };
}


