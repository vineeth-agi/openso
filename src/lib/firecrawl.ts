/**
 * Firecrawl — Shared helpers for web search and scraping.
 *
 * Single source of truth used by:
 *   - extra-tools.ts (web_search, scrape_url, deep research)
 *   - job-search/evaluate (JD scraping)
 *   - chat/route.ts (job search ATS scraping)
 *
 * All endpoints use Firecrawl API **v2** (v1 deprecated April 2025).
 * Docs: https://docs.firecrawl.dev
 *
 * Capabilities used:
 *   - /search     — web search with optional scrapeContent
 *   - /scrape     — single URL scrape (markdown OR JSON extraction)
 *   - /batch/scrape — parallel multi-URL scrape
 *   - /map        — discover URLs on a website
 *   - /agent      — autonomous web data gathering
 *   - Change tracking — detect page changes between scrapes
 */

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";

function getApiKey(): string | null {
  return process.env.FIRECRAWL_API_KEY || null;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface FirecrawlSearchResult {
  title: string;
  url: string;
  description: string;
  markdown: string;
}

export interface FirecrawlSearchResponse {
  web: FirecrawlSearchResult[];
  news: Array<{ title: string; url: string; snippet: string; date: string }>;
}

export interface FirecrawlScrapeResult {
  markdown: string;
  metadata: {
    title?: string;
    description?: string;
    sourceURL?: string;
    [key: string]: unknown;
  };
}

export interface FirecrawlSearchOptions {
  query: string;
  limit?: number;
  /** Sources to search: "web", "news" */
  sources?: Array<"web" | "news">;
  /** Time filter: "qdr:h", "qdr:d", "qdr:w", "qdr:m", "qdr:y" */
  tbs?: string;
  /** Category filter: "github", "research", "pdf" */
  categories?: Array<"github" | "research" | "pdf">;
  /** Timeout in ms (default 30000) */
  timeout?: number;
  /** If true, also scrape page content into markdown (costs extra credits) */
  scrapeContent?: boolean;
}

export interface FirecrawlScrapeOptions {
  url: string;
  /** Timeout in ms (default 30000) */
  timeout?: number;
  /** If set, extract structured JSON using LLM with this JSON Schema */
  jsonSchema?: Record<string, unknown>;
  /** Prompt to guide JSON extraction (optional, used with or without schema) */
  jsonPrompt?: string;
  /** ISO 3166-1 location code for region-aware scraping (e.g. "IN", "US") */
  location?: string;
  /** Include change tracking to detect page modifications */
  changeTracking?: boolean | { modes?: Array<"git-diff" | "json">; tag?: string };
}

export interface FirecrawlScrapeJsonResult<T = Record<string, unknown>> {
  json: T;
  markdown: string;
  metadata: {
    title?: string;
    description?: string;
    sourceURL?: string;
    [key: string]: unknown;
  };
  changeTracking?: {
    changeStatus: "new" | "same" | "changed" | "removed";
    previousScrapeAt: string | null;
    diff?: unknown;
  };
}

export interface FirecrawlBatchScrapeOptions {
  urls: string[];
  /** Timeout per URL in ms (default 30000) */
  timeout?: number;
  /** JSON schema for structured extraction across all URLs */
  jsonSchema?: Record<string, unknown>;
  jsonPrompt?: string;
  /** Max concurrent scrapes (default depends on plan) */
  maxConcurrency?: number;
  /** ISO 3166-1 location code */
  location?: string;
  /** Include change tracking */
  changeTracking?: boolean | { modes?: Array<"git-diff" | "json">; tag?: string };
}

export interface FirecrawlMapOptions {
  url: string;
  /** Search query to filter/rank discovered URLs */
  search?: string;
  /** Sitemap handling: "include" (default), "skip", "only" */
  sitemap?: "include" | "skip" | "only";
  /** Include subdomains */
  includeSubdomains?: boolean;
  /** Strip query params from returned URLs */
  ignoreQueryParameters?: boolean;
  /** Max URLs to return (default 5000, max 100000) */
  limit?: number;
  /** Timeout in ms */
  timeout?: number;
}

export interface FirecrawlMapResult {
  links: string[];
}

export interface FirecrawlAgentOptions {
  prompt: string;
  /** JSON schema for structured output */
  schema?: Record<string, unknown>;
  /** Optional starting URLs */
  urls?: string[];
  /** Model: "spark-1-mini" (default, cheap) or "spark-1-pro" (better) */
  model?: "spark-1-mini" | "spark-1-pro";
  /** Max credits to spend (safety cap) */
  maxCredits?: number;
}

export interface FirecrawlAgentResult<T = Record<string, unknown>> {
  data: T;
  creditsUsed: number;
  status: string;
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Search the web via Firecrawl v2 `/search` endpoint.
 *
 * When `scrapeContent` is true, each result includes its page markdown.
 * Response shape from API changes based on `scrapeOptions` presence:
 *   - Without scrapeOptions: `data.web[]`, `data.news[]`
 *   - With scrapeOptions: `data[]` (flat array with markdown)
 */
export async function firecrawlSearch(
  options: FirecrawlSearchOptions,
): Promise<FirecrawlSearchResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { web: [], news: [] };
  }

  const {
    query,
    limit = 5,
    sources = ["web"],
    tbs,
    categories,
    timeout = 30000,
    scrapeContent = false,
  } = options;

  const body: Record<string, unknown> = {
    query,
    limit: Math.min(limit, 20),
    sources,
    timeout,
  };
  if (tbs) body.tbs = tbs;
  if (categories && categories.length > 0) body.categories = categories;
  if (scrapeContent) {
    body.scrapeOptions = { formats: ["markdown"], onlyMainContent: true };
  }

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[firecrawl] Search failed (${res.status}):`, err);
      return { web: [], news: [] };
    }

    const json = await res.json();

    // When scrapeOptions is set, Firecrawl returns data as a flat array
    // instead of { web: [], news: [] }.
    if (scrapeContent && Array.isArray(json?.data)) {
      return {
        web: json.data.map((r: Record<string, unknown>) => ({
          title: (r.title as string) || "",
          url: (r.url as string) || "",
          description: (r.description as string) || "",
          markdown: (r.markdown as string) || "",
        })),
        news: [],
      };
    }

    // Standard response: data.web[], data.news[]
    const data = json?.data ?? {};
    return {
      web: (data.web || []).map((r: Record<string, unknown>) => ({
        title: (r.title as string) || "",
        url: (r.url as string) || "",
        description: (r.description as string) || "",
        markdown: (r.markdown as string) || "",
      })),
      news: (data.news || []).map((r: Record<string, unknown>) => ({
        title: (r.title as string) || "",
        url: (r.url as string) || "",
        snippet: (r.snippet as string) || "",
        date: (r.date as string) || "",
      })),
    };
  } catch (e) {
    console.error("[firecrawl] Search error:", e);
    return { web: [], news: [] };
  }
}

// ── Scrape ───────────────────────────────────────────────────────────────────

/**
 * Scrape a single URL via Firecrawl v2 `/scrape` endpoint.
 *
 * Returns the page as markdown + metadata.
 * Throws on failure so callers can handle errors explicitly.
 */
export async function firecrawlScrape(
  options: FirecrawlScrapeOptions,
): Promise<FirecrawlScrapeResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY not configured");
  }

  const { url, timeout = 30000, location, changeTracking } = options;

  const formats: unknown[] = ["markdown"];
  if (changeTracking) {
    if (typeof changeTracking === "object") {
      formats.push({ type: "changeTracking", ...changeTracking });
    } else {
      formats.push("changeTracking");
    }
  }

  const body: Record<string, unknown> = {
    url,
    formats,
    onlyMainContent: true,
    timeout,
  };
  if (location) body.location = { country: location };

  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[firecrawl] Scrape failed (${res.status}):`, errText);
    throw new Error(`Firecrawl scrape failed: ${res.status}`);
  }

  const json = await res.json();
  const data = json?.data ?? {};

  return {
    markdown: (data.markdown as string) || "",
    metadata: {
      title: data.metadata?.title,
      description: data.metadata?.description,
      sourceURL: data.metadata?.sourceURL,
      ...data.metadata,
    },
  };
}

// ── Scrape with JSON extraction ─────────────────────────────────────────────

/**
 * Scrape a URL and extract structured data using Firecrawl's LLM JSON mode.
 *
 * This replaces the pattern: scrape → markdown → AI extraction.
 * Firecrawl runs the LLM extraction server-side, saving a generation call.
 */
async function firecrawlScrapeJson<T = Record<string, unknown>>(
  options: FirecrawlScrapeOptions & { jsonSchema: Record<string, unknown> },
): Promise<FirecrawlScrapeJsonResult<T>> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");

  const { url, timeout = 30000, jsonSchema, jsonPrompt, location, changeTracking } = options;

  const formats: unknown[] = [
    "markdown",
    { type: "json", schema: jsonSchema, ...(jsonPrompt ? { prompt: jsonPrompt } : {}) },
  ];
  if (changeTracking) {
    if (typeof changeTracking === "object") {
      formats.push({ type: "changeTracking", ...changeTracking });
    } else {
      formats.push("changeTracking");
    }
  }

  const body: Record<string, unknown> = {
    url,
    formats,
    onlyMainContent: true,
    timeout,
  };
  if (location) body.location = { country: location };

  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[firecrawl] JSON scrape failed (${res.status}):`, errText);
    throw new Error(`Firecrawl JSON scrape failed: ${res.status}`);
  }

  const json = await res.json();
  const data = json?.data ?? {};

  return {
    json: (data.json ?? {}) as T,
    markdown: (data.markdown as string) || "",
    metadata: {
      title: data.metadata?.title,
      description: data.metadata?.description,
      sourceURL: data.metadata?.sourceURL,
      ...data.metadata,
    },
    changeTracking: data.changeTracking ?? undefined,
  };
}

// ── Batch Scrape ────────────────────────────────────────────────────────────

/**
 * Scrape multiple URLs in parallel via Firecrawl v2 `/batch/scrape`.
 *
 * Returns results for all URLs. Supports JSON extraction mode.
 * Polls for completion (async job).
 */
async function firecrawlBatchScrape<T = Record<string, unknown>>(
  options: FirecrawlBatchScrapeOptions,
): Promise<Array<FirecrawlScrapeJsonResult<T> | FirecrawlScrapeResult>> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");

  const { urls, timeout = 30000, jsonSchema, jsonPrompt, maxConcurrency, location, changeTracking } = options;

  const formats: unknown[] = ["markdown"];
  if (jsonSchema) {
    formats.push({ type: "json", schema: jsonSchema, ...(jsonPrompt ? { prompt: jsonPrompt } : {}) });
  }
  if (changeTracking) {
    if (typeof changeTracking === "object") {
      formats.push({ type: "changeTracking", ...changeTracking });
    } else {
      formats.push("changeTracking");
    }
  }

  const body: Record<string, unknown> = {
    urls,
    formats,
    onlyMainContent: true,
    timeout,
  };
  if (maxConcurrency) body.maxConcurrency = maxConcurrency;
  if (location) body.location = { country: location };

  // Start batch job
  const startRes = await fetch(`${FIRECRAWL_BASE}/batch/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!startRes.ok) {
    const errText = await startRes.text().catch(() => "");
    console.error(`[firecrawl] Batch scrape start failed (${startRes.status}):`, errText);
    throw new Error(`Firecrawl batch scrape failed: ${startRes.status}`);
  }

  const startJson = await startRes.json();
  const jobId = startJson?.id;
  if (!jobId) throw new Error("Firecrawl batch scrape: no job ID returned");

  // Poll for completion (max 2 min)
  const maxWait = 120_000;
  const pollInterval = 2_000;
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const pollRes = await fetch(`${FIRECRAWL_BASE}/batch/scrape/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) continue;
    const pollJson = await pollRes.json();

    if (pollJson.status === "completed") {
      const results = (pollJson.data ?? []) as Record<string, unknown>[];
      return results.map((d) => ({
        json: (d.json ?? {}) as T,
        markdown: (d.markdown as string) || "",
        metadata: {
          title: (d.metadata as Record<string, unknown>)?.title as string | undefined,
          description: (d.metadata as Record<string, unknown>)?.description as string | undefined,
          sourceURL: (d.metadata as Record<string, unknown>)?.sourceURL as string | undefined,
          ...(d.metadata as Record<string, unknown> ?? {}),
        },
        changeTracking: d.changeTracking as FirecrawlScrapeJsonResult["changeTracking"],
      }));
    }
    if (pollJson.status === "failed") {
      throw new Error(`Firecrawl batch scrape failed: ${pollJson.error ?? "unknown"}`);
    }
  }

  throw new Error("Firecrawl batch scrape timed out");
}

// ── Map ─────────────────────────────────────────────────────────────────────

/**
 * Discover all URLs on a website via Firecrawl v2 `/map`.
 *
 * Useful for finding job listing URLs on company career pages.
 * Supports search query to filter/rank results by relevance.
 */
async function firecrawlMap(options: FirecrawlMapOptions): Promise<FirecrawlMapResult> {
  const apiKey = getApiKey();
  if (!apiKey) return { links: [] };

  const { url, search, sitemap, includeSubdomains, ignoreQueryParameters, limit, timeout } = options;

  const body: Record<string, unknown> = { url };
  if (search) body.search = search;
  if (sitemap) body.sitemap = sitemap;
  if (includeSubdomains !== undefined) body.includeSubdomains = includeSubdomains;
  if (ignoreQueryParameters !== undefined) body.ignoreQueryParameters = ignoreQueryParameters;
  if (limit) body.limit = Math.min(limit, 100000);
  if (timeout) body.timeout = timeout;

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/map`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[firecrawl] Map failed (${res.status}):`, err);
      return { links: [] };
    }

    const json = await res.json();
    return { links: (json?.links ?? json?.data ?? []) as string[] };
  } catch (e) {
    console.error("[firecrawl] Map error:", e);
    return { links: [] };
  }
}

// ── Agent ───────────────────────────────────────────────────────────────────

/**
 * Autonomous web data gathering via Firecrawl v2 `/agent`.
 *
 * Give it a prompt + optional schema, the agent navigates the web
 * autonomously and returns structured data.
 *
 * Best for complex multi-page discovery like "Find all React developer
 * openings at Spotify" where you don't know the exact URLs.
 */
async function firecrawlAgent<T = Record<string, unknown>>(
  options: FirecrawlAgentOptions,
): Promise<FirecrawlAgentResult<T>> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");

  const { prompt, schema, urls, model = "spark-1-mini", maxCredits = 100 } = options;

  const body: Record<string, unknown> = {
    prompt,
    model,
    maxCredits,
  };
  if (schema) body.schema = schema;
  if (urls && urls.length > 0) body.urls = urls;

  // Start agent job
  const startRes = await fetch(`${FIRECRAWL_BASE}/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!startRes.ok) {
    const errText = await startRes.text().catch(() => "");
    console.error(`[firecrawl] Agent start failed (${startRes.status}):`, errText);
    throw new Error(`Firecrawl agent failed: ${startRes.status}`);
  }

  const startJson = await startRes.json();
  const jobId = startJson?.id;
  if (!jobId) throw new Error("Firecrawl agent: no job ID returned");

  // Poll for completion (agents can take longer — max 3 min)
  const maxWait = 180_000;
  const pollInterval = 3_000;
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const pollRes = await fetch(`${FIRECRAWL_BASE}/agent/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) continue;
    const pollJson = await pollRes.json();

    if (pollJson.status === "completed" || pollJson.status === "done") {
      return {
        data: (pollJson.data ?? {}) as T,
        creditsUsed: pollJson.creditsUsed ?? 0,
        status: pollJson.status,
      };
    }
    if (pollJson.status === "failed") {
      throw new Error(`Firecrawl agent failed: ${pollJson.error ?? "unknown"}`);
    }
  }

  throw new Error("Firecrawl agent timed out");
}

// ── Convenience: "search and get content" ────────────────────────────────────

/**
 * Search + scrape in one call (sets scrapeContent: true).
 * Returns results with their full markdown content included.
 */
export async function firecrawlSearchWithContent(
  query: string,
  limit = 5,
  tbs?: string,
): Promise<FirecrawlSearchResult[]> {
  const { web } = await firecrawlSearch({
    query,
    limit,
    tbs,
    scrapeContent: true,
  });
  return web;
}

/**
 * Returns true if the Firecrawl API key is configured.
 */
export function isFirecrawlConfigured(): boolean {
  return !!getApiKey();
}
