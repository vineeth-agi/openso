/**
 * Procedural Memory — implicit behavioral pattern learning.
 *

 * It captures "how" rather than "what": skills, habits, preferences that are
 * learned through repetition rather than explicit declaration.
 *
 * Unlike declarative memory (L4 facts), procedural memory is:
 * - Learned from behavior, not stated by the user
 * - Strengthened by frequency (each observation bumps confidence)
 * - Never directly shown to the user, but influences AI behavior
 *
 * Examples:
 * - User always picks simple solutions → approach_style
 * - User prefers short answers → communication_style
 * - User uses Daytona for coding tasks → tool_preference
 * - User writes code then tests → workflow_pattern
 */

import { createAdminClient } from "@/lib/insforge/admin";

export type PatternType =
  | "tool_preference"
  | "approach_style"
  | "communication_style"
  | "workflow_pattern";

export interface ProceduralPattern {
  id: string;
  patternType: PatternType;
  patternKey: string;
  observation: string;
  frequency: number;
  confidence: number;
  lastObservedAt: string;
}

/**
 * Record an observed behavioral pattern.
 * If the pattern already exists, bump frequency and confidence.
 * Confidence grows with frequency: starts at 0.3, approaches 1.0 asymptotically.
 */
export async function observePattern(
  userId: string,
  patternType: PatternType,
  patternKey: string,
  observation: string,
): Promise<void> {
  const db = createAdminClient();

  const { data: existing } = await db.database.from("memory_procedural")
    .select("id, frequency, confidence")
    .eq("user_id", userId)
    .eq("pattern_type", patternType)
    .eq("pattern_key", patternKey)
    .single();

  if (existing) {
    const newFrequency = existing.frequency + 1;
    // Confidence formula: asymptotic approach to 1.0
    // f(n) = 1 - e^(-n/5) → 1 obs = 0.18, 3 obs = 0.45, 5 obs = 0.63, 10 obs = 0.86
    const newConfidence = Math.min(0.99, 1.0 - Math.exp(-newFrequency / 5));

    await db.database.from("memory_procedural")
      .update({
        frequency: newFrequency,
        confidence: newConfidence,
        observation, // update with latest observation text
        last_observed_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await db.database.from("memory_procedural")
      .insert({
        user_id: userId,
        pattern_type: patternType,
        pattern_key: patternKey,
        observation,
        frequency: 1,
        confidence: 0.18, // 1 - e^(-1/5) ≈ 0.18
        last_observed_at: new Date().toISOString(),
      });
  }
}

/**
 * Get all procedural patterns for a user (high-confidence ones).
 * Used during retrieval to inject behavioral context into the prompt.
 */
export async function getProceduralPatterns(
  userId: string,
  options?: { type?: PatternType; minConfidence?: number; limit?: number },
): Promise<ProceduralPattern[]> {
  const db = createAdminClient();
  const minConf = options?.minConfidence ?? 0.4;
  const limit = options?.limit ?? 15;

  let query = db.database.from("memory_procedural")
    .select("*")
    .eq("user_id", userId)
    .gte("confidence", minConf)
    .order("confidence", { ascending: false })
    .limit(limit);

  if (options?.type) {
    query = query.eq("pattern_type", options.type);
  }

  const { data } = await query;
  if (!data) return [];

  return data.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    patternType: row.pattern_type as PatternType,
    patternKey: row.pattern_key as string,
    observation: row.observation as string,
    frequency: row.frequency as number,
    confidence: row.confidence as number,
    lastObservedAt: row.last_observed_at as string,
  }));
}

/**
 * Extract procedural patterns from tool usage in a conversation.
 * Called from the chat route onFinish to track which tools the user triggers.
 */
export function inferPatternsFromToolUsage(
  toolsUsed: string[],
): { patternType: PatternType; patternKey: string; observation: string }[] {
  const patterns: { patternType: PatternType; patternKey: string; observation: string }[] = [];

  for (const tool of toolsUsed) {
    patterns.push({
      patternType: "tool_preference",
      patternKey: `uses_${tool}`,
      observation: `User triggered the ${tool} tool`,
    });
  }

  return patterns;
}
