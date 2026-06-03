/**
 * AI Telemetry — OpenTelemetry-based observability for Vercel AI SDK
 *
 * Provides consistent tracing, metrics, and logging across all AI operations.
 * Integrates with the AI SDK's experimental telemetry system.
 *
 * Usage:
 *   import { createTelemetryConfig, telemetryAttributes } from '@/lib/ai/telemetry';
 *
 *   const result = await streamText({
 *     ...telemetryConfig,
 *     model,
 *     prompt,
 *   });
 */

import type { TelemetrySettings } from "ai";

// ── Configuration ──

/** Default telemetry settings for AI SDK operations */
export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = {
  isEnabled: true,
  recordInputs: true,
  recordOutputs: true,
  functionId: "ai-operation",
  metadata: {},
};

// ── Attribute Builders ──

/**
 * Build standard telemetry attributes for AI operations.
 * These attributes follow OpenTelemetry semantic conventions where applicable.
 */
export function telemetryAttributes(params: {
  operation: "generateText" | "streamText" | "generateObject" | "streamObject" | "embed" | "tool";
  modelId: string;
  userId?: string;
  conversationId?: string;
  extra?: Record<string, string | number | boolean | undefined>;
}): Record<string, string | number | boolean> {
  const { operation, modelId, userId, conversationId, extra } = params;

  const attrs: Record<string, string | number | boolean> = {
    "ai.operation": operation,
    "ai.model.id": modelId,
    "ai.model.provider": "pioneer",
  };

  if (userId) {
    attrs["ai.user.id"] = userId;
  }

  if (conversationId) {
    attrs["ai.conversation.id"] = conversationId;
  }

  // Add any extra attributes, filtering undefined
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        attrs[`ai.${key}`] = value;
      }
    }
  }

  return attrs;
}

// ── Config Builders ──

/**
 * Create telemetry config for streamText/generateText calls.
 * This should be spread into the AI SDK call options.
 */
export function createTelemetryConfig(params: {
  userId?: string;
  conversationId?: string;
  chatType?: string;
  operation?: "generateText" | "streamText" | "generateObject" | "streamObject";
  metadata?: Record<string, string | number | boolean>;
}): { experimental_telemetry: TelemetrySettings } {
  const { userId, conversationId, chatType, operation = "streamText", metadata = {} } = params;

  return {
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: true,
      recordOutputs: true,
      functionId: `ai-${operation}`,
      metadata: {
        userId: userId ?? "anonymous",
        conversationId: conversationId ?? "unknown",
        chatType: chatType ?? "default",
        timestamp: Date.now(),
        ...metadata,
      },
    },
  };
}

/**
 * Create telemetry config for generateObject calls.
 * Automatically disables output recording for privacy on object generation.
 */
export function createObjectTelemetryConfig(params: {
  userId?: string;
  conversationId?: string;
  schemaName?: string;
  operation?: "generateObject" | "streamObject";
  metadata?: Record<string, string | number | boolean>;
}): { experimental_telemetry: TelemetrySettings } {
  const { userId, conversationId, schemaName, operation = "generateObject", metadata = {} } = params;

  return {
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: true,
      recordOutputs: false, // Don't record full objects for privacy
      functionId: `ai-${operation}`,
      metadata: {
        userId: userId ?? "anonymous",
        conversationId: conversationId ?? "unknown",
        schemaName: schemaName ?? "unknown",
        timestamp: Date.now(),
        ...metadata,
      },
    },
  };
}

/**
 * Create telemetry config for tool calls.
 */
export function createToolTelemetryConfig(params: {
  userId?: string;
  toolName: string;
  conversationId?: string;
  metadata?: Record<string, string | number | boolean>;
}): { experimental_telemetry: TelemetrySettings } {
  const { userId, toolName, conversationId, metadata = {} } = params;

  return {
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: true,
      recordOutputs: true,
      functionId: `ai-tool-${toolName}`,
      metadata: {
        userId: userId ?? "anonymous",
        conversationId: conversationId ?? "unknown",
        toolName,
        timestamp: Date.now(),
        ...metadata,
      },
    },
  };
}

// ── Span Helpers ──

/**
 * Log AI operation start for console/debug visibility.
 * Use alongside telemetry for local debugging.
 */
export function logAIOperation(
  operation: string,
  params: {
    modelId?: string;
    userId?: string;
    conversationId?: string;
    extra?: Record<string, unknown>;
  },
): void {
  const { modelId, userId, conversationId, extra } = params;

  console.log(
    `[AI-Telemetry] ${operation} | ` +
      `model=${modelId ?? "unknown"} ` +
      `user=${userId?.slice(0, 8) ?? "anon"} ` +
      `conv=${conversationId?.slice(0, 8) ?? "new"}` +
      (extra ? ` | ${JSON.stringify(extra)}` : ""),
  );
}

/**
 * Log AI operation completion with usage stats.
 */
export function logAIOperationComplete(
  operation: string,
  params: {
    modelId?: string;
    conversationId?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    finishReason?: string;
    durationMs?: number;
  },
): void {
  const { modelId, conversationId, usage, finishReason, durationMs } = params;

  const tokens = usage
    ? `tokens=${usage.promptTokens ?? 0}/${usage.completionTokens ?? 0}/${usage.totalTokens ?? 0}`
    : "";
  const duration = durationMs ? `duration=${durationMs}ms` : "";
  const finish = finishReason ? `finish=${finishReason}` : "";

  console.log(
    `[AI-Telemetry] ${operation} complete | ` +
      `conv=${conversationId?.slice(0, 8) ?? "new"} ` +
      `${tokens} ${duration} ${finish}`.trim(),
  );
}

// ── Cost Tracking ──

/** Rough cost per 1K tokens for Pioneer AI / DeepSeek models (USD, approximate) */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "deepseek-ai/DeepSeek-V4-Flash": { input: 0.00005, output: 0.0001 },
  "deepseek-ai/DeepSeek-V3.1": { input: 0.00027, output: 0.0011 },
  // Legacy Gemini IDs kept for backward compat in telemetry lookups
  "gemini-2.5-pro": { input: 0.00125, output: 0.005 },
  "gemini-2.5-flash": { input: 0.0003, output: 0.0006 },
  "gemini-2.5-flash-lite": { input: 0.000075, output: 0.0003 },
};

/**
 * Estimate cost for an AI operation.
 * Returns cost in USD (approximate).
 */
export function estimateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const costs = MODEL_COSTS[modelId];
  if (!costs) return 0;

  const inputCost = (promptTokens / 1000) * costs.input;
  const outputCost = (completionTokens / 1000) * costs.output;
  return inputCost + outputCost;
}

/**
 * Log cost information for an AI operation.
 */
export function logAICost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  operation?: string,
): void {
  const cost = estimateCost(modelId, promptTokens, completionTokens);
  const totalTokens = promptTokens + completionTokens;

  console.log(
    `[AI-Cost] ${operation ?? "operation"} | ` +
      `model=${modelId} ` +
      `tokens=${promptTokens}/${completionTokens} ` +
      `cost=$${cost.toFixed(6)}`,
  );
}

// ── Export Types ──

export type { TelemetrySettings };
