/**
 * xAI Provider — OpenAI-compatible endpoint.
 *
 * Uses the official @ai-sdk/openai provider pointed at xAI's
 * OpenAI-compatible API (https://api.x.ai/v1) so models are full
 * LanguageModelV1 instances and work natively with streamText, generateText,
 * generateObject, and tool calling from the Vercel AI SDK ("ai").
 *
 * Authentication: xAI API key via XAI_API_KEY env var.
 *
 * Default model: grok-4.20-0309-non-reasoning (override with XAI_MODEL).
 */

import { createOpenAI } from "@ai-sdk/openai";

import { getXAIConfig } from "./xai-config";

// ── Model aliases (backward-compatible export names) ──

export const XAI_MODELS = {
  /** Grok 4.20 Non-Reasoning — Fast, cost-efficient, 128k context */
  GROK_4_20_NON_REASONING: "grok-4.20-0309-non-reasoning",
  /** Grok 4.3 — General intelligence model */
  GROK_4_3: "grok-4.3",
  /** Grok 4.20 Reasoning — Advanced logic and reasoning */
  GROK_4_20_REASONING: "grok-4.20-0309-reasoning",
} as const;

// Alias to maintain compatibility without renaming imports across the codebase
export const PIONEER_MODELS = XAI_MODELS;

export type PioneerModelId =
  | (typeof XAI_MODELS)[keyof typeof XAI_MODELS]
  | (string & {});

/** Default model id for chat/text generation (override with XAI_MODEL env var). */
export function getDefaultPioneerModel(): string {
  return getXAIConfig().defaultModel;
}

// ── Cached provider instance ──

let cachedProvider: ReturnType<typeof createOpenAI> | null = null;

function getProvider() {
  if (cachedProvider) return cachedProvider;

  const { apiKey, baseURL } = getXAIConfig();

  cachedProvider = createOpenAI({
    apiKey,
    baseURL,
  });

  return cachedProvider;
}

/**
 * Returns a Vercel AI SDK LanguageModel backed by xAI (OpenAI-compatible).
 *
 * Usage:
 * ```ts
 * import { google } from "@/lib/ai/google-provider";
 * import { generateText, streamText } from "ai";
 *
 * const result = await generateText({
 *   model: google("grok-4.20-0309-non-reasoning"),
 *   prompt: "Hello world",
 * });
 * ```
 *
 * The function is named `google` for backward compatibility — all existing
 * imports continue to work without changes.
 */
export function google(modelId?: PioneerModelId) {
  const id = modelId ?? getDefaultPioneerModel();
  // Use .chat() to hit /v1/chat/completions (not the Responses API).
  // xAI's OpenAI-compatible endpoint supports chat completions.
  return getProvider().chat(id);
}

/**
 * Legacy factory kept for backwards compatibility.
 *
 * Supports both call styles:
 *   - `const provider = createGoogleGenerativeAI(); provider(modelId)`
 *   - `const provider = createGoogleGenerativeAI(); provider.languageModel(modelId)`
 */
function createGoogleGenerativeAI() {
  const fn = ((modelId: string) => google(modelId)) as ((
    modelId: string,
  ) => ReturnType<typeof google>) & {
    languageModel: (modelId: string) => ReturnType<typeof google>;
  };
  fn.languageModel = (modelId: string) => google(modelId);
  return fn;
}

export default google;
