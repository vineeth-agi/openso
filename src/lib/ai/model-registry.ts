/**
 * Model Registry — Single source of truth for all available Pioneer AI models.
 *
 * Primary model: DeepSeek V4 Flash (284B MoE, 13B active, 1M context).
 * Fallback: DeepSeek V3.1 (163K context).
 *
 * Provider: Pioneer AI (OpenAI-compatible endpoint at api.pioneer.ai/v1).
 */

// ── Task Categories ──
export type TaskCategory =
  | "simple"        // Greetings, small talk, quick Q&A
  | "moderate"      // Summarization, email drafts, translation
  | "complex"       // Multi-step reasoning, code generation, analysis
  | "creative"      // Long-form writing, brainstorming, storytelling
  | "code"          // Code generation, debugging, code review
  | "research"      // Deep research, multi-source synthesis
  | "structured"    // JSON generation, structured extraction, data parsing
  | "multimodal";   // Image/audio/video understanding

// ── Cost Tier ──
export type CostTier = "free" | "low" | "medium" | "high" | "premium";

// ── Model Provider ──
export type ModelProvider = "pioneer";

// ── Model Definition ──
export interface ModelSpec {
  /** Provider name */
  provider: ModelProvider;
  /** Model ID — passed directly to the provider */
  id: string;
  /** Human-friendly display name */
  name: string;
  /** Model family */
  family: "deepseek-v4" | "deepseek-v3";
  /** Is this a GA (stable) model? */
  stable: boolean;
  /** Maximum input context window (tokens) */
  maxInputTokens: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Supports tool calling / function calling */
  supportsTools: boolean;
  /** Supports structured output (JSON mode) */
  supportsStructuredOutput: boolean;
  /** Supports thinking/reasoning mode */
  supportsThinking: boolean;
  /** Supports image input */
  supportsImageInput: boolean;
  /** Supports audio input */
  supportsAudioInput: boolean;
  /** Supports video input */
  supportsVideoInput: boolean;
  /** Can generate images */
  supportsImageOutput: boolean;
  /** Cost tier (relative) */
  costTier: CostTier;
  /** Default rate limit (RPM) */
  defaultRPM: number;
  /** Tokens per minute limit */
  defaultTPM: number;
  /** Relative latency (1 = fastest, 5 = slowest) */
  latencyScore: number;
  /** Relative quality (1 = lowest, 5 = highest) */
  qualityScore: number;
  /** Task suitability scores (0-1, higher = better fit) */
  taskScores: Record<TaskCategory, number>;
}

// ── Pioneer AI models ──
export const MODEL_REGISTRY: Record<string, ModelSpec> = {

  // ═══════════════════════════════════════════════════════════
  //  DeepSeek V4 Flash — Primary model (Pioneer AI)
  //  284B MoE, 13B active params, 1M context window
  // ═══════════════════════════════════════════════════════════

  "deepseek-ai/DeepSeek-V4-Flash": {
    provider: "pioneer",
    id: "deepseek-ai/DeepSeek-V4-Flash",
    name: "DeepSeek V4 Flash",
    family: "deepseek-v4",
    stable: true,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsThinking: true,
    supportsImageInput: false,
    supportsAudioInput: false,
    supportsVideoInput: false,
    supportsImageOutput: false,
    costTier: "low",
    defaultRPM: 300,
    defaultTPM: 1_000_000,
    latencyScore: 2,
    qualityScore: 4,
    taskScores: {
      simple: 0.9,
      moderate: 0.95,
      complex: 0.85,
      creative: 0.8,
      code: 0.95,
      research: 0.8,
      structured: 0.9,
      multimodal: 0.1,
    },
  },

  // ═══════════════════════════════════════════════════════════
  //  DeepSeek V3.1 — Fallback model (Pioneer AI)
  //  163K context window, general-purpose
  // ═══════════════════════════════════════════════════════════

  "deepseek-ai/DeepSeek-V3.1": {
    provider: "pioneer",
    id: "deepseek-ai/DeepSeek-V3.1",
    name: "DeepSeek V3.1",
    family: "deepseek-v3",
    stable: true,
    maxInputTokens: 163_000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsThinking: false,
    supportsImageInput: false,
    supportsAudioInput: false,
    supportsVideoInput: false,
    supportsImageOutput: false,
    costTier: "low",
    defaultRPM: 200,
    defaultTPM: 500_000,
    latencyScore: 3,
    qualityScore: 3,
    taskScores: {
      simple: 0.8,
      moderate: 0.85,
      complex: 0.7,
      creative: 0.7,
      code: 0.8,
      research: 0.65,
      structured: 0.8,
      multimodal: 0.0,
    },
  },
} as const satisfies Record<string, ModelSpec>;

// ── Convenience lookups ──

/** All model IDs in the registry */
export const ALL_MODEL_IDS = Object.keys(MODEL_REGISTRY);

/** Default primary model */
export const DEFAULT_MODEL_ID = "deepseek-ai/DeepSeek-V4-Flash";

/** Get a model spec by ID, returns undefined if not found */
export function getModelSpec(modelId: string): ModelSpec | undefined {
  return MODEL_REGISTRY[modelId];
}

/** Get the best model for a given task category, respecting an optional cost ceiling */
export function getBestModelForTask(
  task: TaskCategory,
  maxCostTier: CostTier = "premium",
): ModelSpec {
  const costOrder: CostTier[] = ["free", "low", "medium", "high", "premium"];
  const maxIdx = costOrder.indexOf(maxCostTier);

  const candidates = Object.values(MODEL_REGISTRY).filter((m) => {
    const costIdx = costOrder.indexOf(m.costTier);
    return costIdx <= maxIdx && m.supportsTools;
  });

  candidates.sort((a, b) => {
    const scoreA = a.taskScores[task];
    const scoreB = b.taskScores[task];
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.latencyScore - b.latencyScore;
  });

  return candidates[0] ?? MODEL_REGISTRY[DEFAULT_MODEL_ID];
}

/**
 * Get the ordered fallback chain for a given model.
 * Always returns the other available models as fallbacks.
 */
export function getFallbackChain(primaryModelId: string): ModelSpec[] {
  const primary = MODEL_REGISTRY[primaryModelId];
  if (!primary) return [MODEL_REGISTRY[DEFAULT_MODEL_ID]].filter(Boolean);

  return Object.values(MODEL_REGISTRY)
    .filter((m) => m.id !== primaryModelId && m.supportsTools)
    .sort((a, b) => {
      const costOrder: CostTier[] = ["free", "low", "medium", "high", "premium"];
      const costDiff = costOrder.indexOf(a.costTier) - costOrder.indexOf(b.costTier);
      if (costDiff !== 0) return costDiff;
      return b.qualityScore - a.qualityScore;
    });
}
