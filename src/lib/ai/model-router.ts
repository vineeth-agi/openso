/**
 * Model Router — Auto-mode model selection + fallback chain + retry with backoff.
 *
 * Architecture:
 *
 *   ┌──────────────┐
 *   │  User Query   │
 *   └──────┬───────┘
 *          │
 *   ┌──────▼───────┐
 *   │  Classifier   │  Zero-cost heuristic (no LLM call)
 *   │  (4 pillars)  │  → category, complexity, needs
 *   └──────┬───────┘
 *          │
 *   ┌──────▼───────┐
 *   │  Auto Router  │  category × complexity → best model
 *   │               │  Respects user override + env config
 *   └──────┬───────┘
 *          │
 *   ┌──────▼───────┐
 *   │  Fallback     │  Primary → Fallback1 → Fallback2
 *   │  Chain        │  Catches 429/500/503 → tries next model
 *   └──────┬───────┘
 *          │
 *   ┌──────▼───────┐
 *   │  Retry w/     │  Per-model: 3 retries, exponential backoff
 *   │  Backoff      │  wrapLanguageModel middleware
 *   └──────┬───────┘
 *          │
 *   ┌──────▼───────┐
 *   │  streamText   │  Vercel AI SDK
 *   └──────────────┘
 *
 * Provider: Pioneer AI (OpenAI-compatible, DeepSeek V4 Flash).
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

import { google } from "./google-provider";
import {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  getBestModelForTask,
  getFallbackChain,
  getModelSpec,
  type CostTier,
  type ModelProvider,
  type ModelSpec,
  type TaskCategory,
} from "./model-registry";
import { classifyQuery, type QueryClassification } from "./query-classifier";

// ── Types ──

/** Reasoning configuration for AI SDK */
export interface ReasoningConfig {
  /** Enable reasoning/thinking mode */
  type: "low" | "medium" | "high";
  /** Summarize reasoning output (default: true for cost savings) */
  summarize?: boolean;
}

export interface RouteResult {
  /** The wrapped language model with retry middleware */
  model: LanguageModelV3;
  /** The primary model spec chosen */
  primaryModel: ModelSpec;
  /** The full fallback chain (excluding primary) */
  fallbackChain: ModelSpec[];
  /** Classification result */
  classification: QueryClassification;
  /** Whether user explicitly chose a model (not auto) */
  isUserOverride: boolean;
  /** Recommended maxOutputTokens based on model */
  recommendedMaxTokens: number;
  /** Reasoning config if thinking mode should be enabled */
  reasoning?: ReasoningConfig;
}

export interface RouteOptions {
  /** If set, force this specific model (bypass auto-routing) */
  selectedModel?: string;
  /** Number of messages in conversation so far */
  conversationLength?: number;
  /** Whether the message has file attachments */
  hasAttachments?: boolean;
  /** System prompt length in chars */
  systemPromptLength?: number;
  /** Maximum cost tier allowed */
  maxCostTier?: CostTier;
  /** Mode: "auto" | specific model id */
  mode?: "auto" | string;
}

// ── Retry Middleware ──

function createRetryMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: "v3" as const,
    wrapGenerate: async ({ doGenerate }) => {
      return retryWithBackoff(() => doGenerate(), 3);
    },
    wrapStream: async ({ doStream }) => {
      return retryWithBackoff(() => doStream(), 3);
    },
  };
}

async function retryWithBackoff<T>(
  fn: () => PromiseLike<T>,
  maxRetries: number,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const isRetryable = isRetryableError(error);
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(
        `[ModelRouter] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms — ${
          error instanceof Error ? error.message.slice(0, 100) : String(error)
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;

  if (typeof err.statusCode === "number") {
    return [429, 500, 502, 503].includes(err.statusCode);
  }
  if (err.cause && typeof err.cause === "object") {
    return isRetryableError(err.cause);
  }
  if (typeof err.message === "string") {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("resource exhausted") ||
      msg.includes("rate limit") ||
      msg.includes("quota") ||
      msg.includes("429") ||
      msg.includes("503") ||
      msg.includes("temporarily unavailable") ||
      msg.includes("internal error")
    );
  }
  return false;
}

function isFatalError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  if (typeof err.statusCode === "number") {
    return [401, 403].includes(err.statusCode);
  }
  if (err.cause && typeof err.cause === "object") {
    return isFatalError(err.cause);
  }
  return false;
}

function shouldTriggerFallback(error: unknown): boolean {
  if (isRetryableError(error)) return true;
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  if (typeof err.statusCode === "number" && err.statusCode === 404) return true;
  if (err.cause && typeof err.cause === "object") {
    return shouldTriggerFallback(err.cause);
  }
  if (typeof err.message === "string") {
    const msg = err.message.toLowerCase();
    return msg.includes("not found") || msg.includes("no access") || msg.includes("404");
  }
  return false;
}

// ── Fallback Middleware ──

function createFallbackMiddleware(
  fallbackChain: ModelSpec[],
): LanguageModelMiddleware {
  return {
    specificationVersion: "v3" as const,

    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        return await doGenerate();
      } catch (error) {
        if (!shouldTriggerFallback(error) || fallbackChain.length === 0) throw error;
        return tryFallbacksGenerate(fallbackChain, params, error);
      }
    },

    wrapStream: async ({ doStream, params }) => {
      try {
        return await doStream();
      } catch (error) {
        if (!shouldTriggerFallback(error) || fallbackChain.length === 0) throw error;
        return tryFallbacksStream(fallbackChain, params, error);
      }
    },
  };
}

async function tryFallbacksGenerate(
  chain: ModelSpec[],
  originalParams: unknown,
  originalError: unknown,
) {
  for (const fb of chain) {
    try {
      console.log(`[ModelRouter] Falling back (generate) to ${fb.id} (${fb.provider})`);
      const fallbackModel = google(fb.id) as LanguageModelV3;
      return await fallbackModel.doGenerate(
        originalParams as Parameters<LanguageModelV3["doGenerate"]>[0],
      );
    } catch (fbError) {
      if (isFatalError(fbError)) throw fbError;
      console.warn(`[ModelRouter] Fallback ${fb.id} also failed (${(fbError as Record<string,unknown>)?.statusCode ?? "err"}), trying next...`);
      continue;
    }
  }
  throw originalError;
}

async function tryFallbacksStream(
  chain: ModelSpec[],
  originalParams: unknown,
  originalError: unknown,
) {
  for (const fb of chain) {
    try {
      console.log(`[ModelRouter] Falling back (stream) to ${fb.id} (${fb.provider})`);
      const fallbackModel = google(fb.id) as LanguageModelV3;
      return await fallbackModel.doStream(
        originalParams as Parameters<LanguageModelV3["doStream"]>[0],
      );
    } catch (fbError) {
      if (isFatalError(fbError)) throw fbError;
      console.warn(`[ModelRouter] Fallback ${fb.id} also failed (${(fbError as Record<string,unknown>)?.statusCode ?? "err"}), trying next...`);
      continue;
    }
  }
  throw originalError;
}

/**
 * Creates a wrapped language model with retry + fallback chain.
 * Routes through Pioneer AI (OpenAI-compatible) provider.
 */
function createSmartModel(
  primaryModelId: string,
  fallbackChain: ModelSpec[],
): LanguageModelV3 {
  const middlewares: LanguageModelMiddleware[] = [createRetryMiddleware()];

  if (fallbackChain.length > 0) {
    middlewares.push(createFallbackMiddleware(fallbackChain));
  }

  const providerModel = google(primaryModelId);

  return wrapLanguageModel({
    model: providerModel,
    middleware: middlewares,
  }) as unknown as LanguageModelV3;
}

// ── Public API ──

/**
 * Classify a query and automatically route to the best model.
 */
export function classifyAndRoute(
  query: string,
  options: RouteOptions = {},
): RouteResult {
  const {
    selectedModel,
    conversationLength = 0,
    hasAttachments = false,
    systemPromptLength = 0,
    maxCostTier = "premium",
    mode = "auto",
  } = options;

  // ── User explicit override ──
  if (mode !== "auto" && mode !== "") {
    const spec = getModelSpec(mode);
    if (spec) {
      return buildRouteResult(spec, classifyQuery(query, conversationLength, hasAttachments, systemPromptLength), true);
    }
  }

  if (selectedModel && selectedModel !== "auto") {
    const spec = getModelSpec(selectedModel);
    if (spec) {
      return buildRouteResult(spec, classifyQuery(query, conversationLength, hasAttachments, systemPromptLength), true);
    }
    console.warn(
      `[ModelRouter] Requested model "${selectedModel}" not in registry — using auto mode`,
    );
  }

  // ── Auto classification ──
  const classification = classifyQuery(
    query,
    conversationLength,
    hasAttachments,
    systemPromptLength,
  );

  // ── Route based on classification ──
  // With Pioneer, we primarily use DeepSeek V4 Flash for everything
  let primarySpec: ModelSpec;

  if (classification.isMultimodal && !hasAttachments) {
    primarySpec = getBestModelForTask("moderate", maxCostTier);
  } else if (classification.isMultimodal && hasAttachments) {
    // DeepSeek doesn't support multimodal — fall back to text-based handling
    primarySpec = getBestModelForTask("moderate", maxCostTier);
  } else {
    primarySpec = getBestModelForTask(classification.category, maxCostTier);
  }

  console.log(
    `[ModelRouter] Auto-route: ${classification.reason} → ${primarySpec.id} (${primarySpec.costTier})`,
  );

  return buildRouteResult(primarySpec, classification, false);
}

function buildRouteResult(
  primarySpec: ModelSpec,
  classification: QueryClassification,
  isUserOverride: boolean,
): RouteResult {
  const fallbackChain = getFallbackChain(primarySpec.id).slice(0, 3);
  const model = createSmartModel(primarySpec.id, fallbackChain);

  const reasoning = computeReasoningConfig(primarySpec, classification);

  return {
    model,
    primaryModel: primarySpec,
    fallbackChain,
    classification,
    isUserOverride,
    recommendedMaxTokens: primarySpec.maxOutputTokens,
    reasoning,
  };
}

function computeReasoningConfig(
  modelSpec: ModelSpec,
  classification: QueryClassification,
): ReasoningConfig | undefined {
  if (!modelSpec.supportsThinking) return undefined;
  if (!classification.needsThinking) return undefined;

  let type: "low" | "medium" | "high" = "medium";
  if (classification.complexity > 0.8) {
    type = "high";
  } else if (classification.complexity < 0.4) {
    type = "low";
  }

  return { type, summarize: true };
}

