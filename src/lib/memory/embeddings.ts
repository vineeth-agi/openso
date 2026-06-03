// Embeddings — Voyage AI only (1024-dim vectors)

const VOYAGE_EMBED_MODEL = process.env.VOYAGE_EMBED_MODEL ?? "voyage-4-large";
const EMBEDDING_DIMENSIONS = 1024;

function getVoyageApiKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) {
    throw new Error("VOYAGE_API_KEY is required for memory embeddings");
  }
  return key;
}

/**
 * Returns the current embedding model identifier for version tracking.
 */
export function getEmbeddingModelId(): string {
  return VOYAGE_EMBED_MODEL;
}

export interface VoyageEmbedOptions {
  model?: string;
  outputDimension?: number;
}

/**
 * Low-level Voyage AI embedding call. Exported so other modules can share the same fetch logic.
 */
export async function voyageEmbedRaw(
  texts: string[],
  inputType: "document" | "query",
  options?: VoyageEmbedOptions,
): Promise<number[][]> {
  const model = options?.model ?? VOYAGE_EMBED_MODEL;

  const body: Record<string, unknown> = {
    input: texts,
    model,
    input_type: inputType,
  };
  if (options?.outputDimension) {
    body.output_dimension = options.outputDimension;
  }

  const apiKey = getVoyageApiKey();
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

const EMBEDDING_RETRY_ATTEMPTS = Number(process.env.MEMORY_EMBED_RETRY_ATTEMPTS ?? "3");
const EMBEDDING_RETRY_BASE_MS = Number(process.env.MEMORY_EMBED_RETRY_BASE_MS ?? "250");
const EMBEDDING_CACHE_TTL_MS = Number(process.env.MEMORY_EMBED_CACHE_TTL_MS ?? "300000");
const EMBEDDING_CACHE_MAX_ENTRIES = Number(process.env.MEMORY_EMBED_CACHE_MAX_ENTRIES ?? "1000");

type EmbeddingCacheEntry = {
  vector: number[];
  expiresAt: number;
};

const embeddingCache = new Map<string, EmbeddingCacheEntry>();
const inflightEmbeds = new Map<string, Promise<number[]>>();

/**
 * Fast DJB2 hash — avoids storing full document text as Map keys.
 */
function hashText(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function cacheKey(text: string): string {
  return `${VOYAGE_EMBED_MODEL}|${EMBEDDING_DIMENSIONS}|${hashText(text)}|${text.length}`;
}

function getCachedVector(key: string): number[] | null {
  const cached = embeddingCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    embeddingCache.delete(key);
    return null;
  }

  return [...cached.vector];
}

function setCachedVector(key: string, vector: number[]): void {
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldestKey = embeddingCache.keys().next().value;
    if (oldestKey) {
      embeddingCache.delete(oldestKey);
    }
  }

  embeddingCache.set(key, {
    vector: [...vector],
    expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS,
  });
}

function statusFromError(error: unknown): number | undefined {
  const maybe = error as {
    status?: number;
    statusCode?: number;
    code?: number;
    message?: string;
  };

  if (typeof maybe.statusCode === "number") return maybe.statusCode;
  if (typeof maybe.status === "number") return maybe.status;
  if (typeof maybe.code === "number" && maybe.code >= 100) return maybe.code;

  const message = String(maybe.message ?? error ?? "");
  const match = message.match(/"code"\s*:\s*(\d{3})/);
  if (match) return Number(match[1]);
  return undefined;
}

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPROTO",
]);

function isRetryableEmbeddingError(error: unknown): boolean {
  const status = statusFromError(error);
  if (status && [408, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const err = error as { message?: string; code?: string; cause?: { code?: string } };

  if (err.code && RETRYABLE_NETWORK_CODES.has(err.code)) return true;
  if (err.cause?.code && RETRYABLE_NETWORK_CODES.has(err.cause.code)) return true;

  const message = String(err?.message ?? error ?? "");
  return /RESOURCE_EXHAUSTED|rate limit|quota exceeded|temporar|timeout|fetch failed|socket disconnected/i.test(message);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const RATE_LIMIT_RPM = Number(process.env.EMBEDDING_RATE_LIMIT_RPM ?? "60");
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitQueue: number[] = [];

async function acquireRateLimit(): Promise<void> {
  const now = Date.now();
  while (rateLimitQueue.length > 0 && rateLimitQueue[0]! < now - RATE_LIMIT_WINDOW_MS) {
    rateLimitQueue.shift();
  }
  if (rateLimitQueue.length >= RATE_LIMIT_RPM) {
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - rateLimitQueue[0]!) + 50;
    await sleep(waitMs);
  }
  rateLimitQueue.push(Date.now());
}

async function requestEmbeddingWithRetry(text: string): Promise<number[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= EMBEDDING_RETRY_ATTEMPTS; attempt++) {
    try {
      await acquireRateLimit();
      const vectors = await voyageEmbedRaw([text], "document");
      const vector = vectors[0] ?? [];
      if (vector.length === 0) throw new Error("Voyage: empty vector returned");
      return vector;
    } catch (e) {
      lastError = e;
      if (!isRetryableEmbeddingError(e)) {
        break;
      }
      const backoffMs = EMBEDDING_RETRY_BASE_MS * Math.pow(2, attempt);
      await sleep(backoffMs);
    }
  }

  throw new Error(`Embedding failed after ${EMBEDDING_RETRY_ATTEMPTS + 1} attempts: ${lastError}`);
}

/**
 * Main embedding function with caching and deduplication.
 */
export async function embed(text: string): Promise<number[]> {
  const key = cacheKey(text);

  const cached = getCachedVector(key);
  if (cached) {
    return cached;
  }

  const inflight = inflightEmbeds.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = requestEmbeddingWithRetry(text)
    .then((vector) => {
      setCachedVector(key, vector);
      inflightEmbeds.delete(key);
      return vector;
    })
    .catch((err) => {
      inflightEmbeds.delete(key);
      throw err;
    });

  inflightEmbeds.set(key, promise);
  return promise;
}

/**
 * Batch embed multiple texts.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map((t) => embed(t)));
}

/**
 * Embed multiple texts in a single Voyage AI API call (true batching).
 *
 * Unlike `embedBatch` which fires N parallel individual API calls,
 * this sends all texts in one HTTP request. Counts as a single RPM
 * slot. Includes retry logic for transient failures.
 */
export async function embedBatchDirect(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  let lastError: unknown;
  for (let attempt = 0; attempt <= EMBEDDING_RETRY_ATTEMPTS; attempt++) {
    try {
      await acquireRateLimit();
      return await voyageEmbedRaw(texts, "document");
    } catch (e) {
      lastError = e;
      if (!isRetryableEmbeddingError(e)) break;
      const backoffMs = EMBEDDING_RETRY_BASE_MS * Math.pow(2, attempt);
      await sleep(backoffMs);
    }
  }
  throw new Error(
    `embedBatchDirect failed after ${EMBEDDING_RETRY_ATTEMPTS + 1} attempts: ${lastError}`,
  );
}