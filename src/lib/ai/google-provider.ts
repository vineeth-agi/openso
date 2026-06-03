/**
 * Pioneer AI Provider — OpenAI-compatible endpoint.
 *
 * Uses the official @ai-sdk/openai provider pointed at Pioneer AI's
 * OpenAI-compatible API (https://api.pioneer.ai/v1) so models are full
 * LanguageModelV1 instances and work natively with streamText, generateText,
 * generateObject, and tool calling from the Vercel AI SDK ("ai").
 *
 * Authentication: Pioneer API key via PIONEER_API_KEY or PIONEER_API env var.
 *
 * Default model: deepseek-ai/DeepSeek-V4-Flash (override with PIONEER_MODEL).
 */

import { createOpenAI } from "@ai-sdk/openai";

import { getPioneerConfig } from "./pioneer-config";

// ── Model aliases (backward-compatible export names) ──

export const PIONEER_MODELS = {
  /** DeepSeek V4 Flash — 284B MoE, 13B active, 1M context, fast + cost-efficient */
  DEEPSEEK_V4_FLASH: "deepseek-ai/DeepSeek-V4-Flash",
  /** DeepSeek V3.1 — 163K context, general-purpose */
  DEEPSEEK_V3_1: "deepseek-ai/DeepSeek-V3.1",
} as const;



export type PioneerModelId =
  | (typeof PIONEER_MODELS)[keyof typeof PIONEER_MODELS]
  | (string & {});



/** Default model id for chat/text generation (override with PIONEER_MODEL env var). */
export function getDefaultPioneerModel(): string {
  return getPioneerConfig().defaultModel;
}



// ── Cached provider instance ──

let cachedProvider: ReturnType<typeof createOpenAI> | null = null;

function getProvider() {
  if (cachedProvider) return cachedProvider;

  const { apiKey, baseURL } = getPioneerConfig();

  cachedProvider = createOpenAI({
    apiKey,
    baseURL,
  });

  return cachedProvider;
}

/**
 * Returns a Vercel AI SDK LanguageModel backed by Pioneer AI (OpenAI-compatible).
 *
 * Usage:
 * ```ts
 * import { google } from "@/lib/ai/google-provider";
 * import { generateText, streamText } from "ai";
 *
 * const result = await generateText({
 *   model: google("deepseek-ai/DeepSeek-V4-Flash"),
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
  // Pioneer's OpenAI-compatible endpoint only supports chat completions.
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
