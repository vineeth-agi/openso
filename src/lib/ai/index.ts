/**
 * AI Module — Main Entry Point
 *
 * Chat / Text generation: Pioneer AI (OpenAI-compatible, DeepSeek V4 Flash)
 * Embeddings:             Voyage AI (see @/lib/memory/embeddings)
 */

// Vercel AI SDK primitives
export { generateText, generateObject, streamText } from "ai";

// Pioneer-backed model factory (exported as `google` for backward compat)
export {
  google,
  default as defaultProvider,
  getDefaultPioneerModel,
  PIONEER_MODELS
} from "./google-provider";
export type { PioneerModelId } from "./google-provider";

// Auto-router: classify queries → pick best model → fallback + retry
export {
  classifyAndRoute,
} from "./model-router";
export type { RouteResult, RouteOptions, ReasoningConfig } from "./model-router";

// Model registry & query classifier
export { MODEL_REGISTRY, getModelSpec, getBestModelForTask } from "./model-registry";
export type { ModelSpec, TaskCategory, CostTier, ModelProvider } from "./model-registry";
export { classifyQuery } from "./query-classifier";
export type { QueryClassification } from "./query-classifier";

// Configuration utilities
export { getPioneerConfigSummary, getPioneerConfig } from "./pioneer-config";

// Telemetry & Observability
export {
  createTelemetryConfig,
  createObjectTelemetryConfig,
  createToolTelemetryConfig,
  telemetryAttributes,
  logAIOperation,
  logAIOperationComplete,
  logAICost,
  estimateCost,
} from "./telemetry";
export type { TelemetrySettings } from "./telemetry";
