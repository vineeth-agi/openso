/**
 * Amygdala Emotional Boost — emotional memories are encoded more strongly.
 *
 * In the human brain, the amygdala modulates memory encoding:
 * - Emotional events trigger norepinephrine + cortisol release
 * - This strengthens hippocampal encoding (LTP boost)
 * - Emotional memories have longer half-lives and resist decay
 * - Both positive and negative emotions enhance encoding (not just fear)
 *
 * Implementation:
 * - Detect emotional content via LLM structured extraction
 * - Assign valence (positive/negative/neutral) and intensity (0-1)
 * - Emotional facts get boosted importance + extended half_life
 */

import { generateObject } from "ai";
import { z } from "zod";

import { google } from "@/lib/ai/google-provider";

function getModel() {
  return google();
}

export type EmotionalValence = "positive" | "negative" | "neutral";

export interface EmotionalTag {
  valence: EmotionalValence;
  intensity: number; // 0.0 to 1.0
}

const EmotionalAnalysisSchema = z.object({
  emotions: z.array(z.object({
    factIndex: z.number().describe("0-based index of the fact in the input array"),
    valence: z.enum(["positive", "negative", "neutral"]),
    intensity: z.number().min(0).max(1).describe("Emotional strength: 0=none, 0.5=moderate, 1.0=very strong"),
  })),
});

/**
 * Analyze emotional content of extracted facts.
 * Returns one EmotionalTag per input fact.
 * This is efficient: batches all facts in one LLM call.
 */
export async function analyzeEmotions(
  facts: string[],
): Promise<EmotionalTag[]> {
  if (facts.length === 0) return [];

  const prompt = `Analyze the emotional content of these facts about a user.
For each fact, determine:
- valence: positive (joy, excitement, pride, love), negative (frustration, anxiety, sadness, anger), or neutral
- intensity: 0.0 (no emotion) to 1.0 (very strong emotion)

Rules:
- Facts about achievements, good news, love → positive
- Facts about problems, losses, frustrations → negative
- Factual/technical info with no emotion → neutral, intensity 0.0
- "Getting married" → positive, 0.9
- "Got fired" → negative, 0.85
- "Uses TypeScript" → neutral, 0.0
- "Struggling with deadline" → negative, 0.5
- "Loves hiking" → positive, 0.4 (preference, mild positive)

Facts:
${facts.map((f, i) => `[${i}] ${f}`).join("\n")}`;

  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: EmotionalAnalysisSchema,
      prompt,
      maxOutputTokens: 4096,
    });

    // Map results back to ordered array, default to neutral
    const results: EmotionalTag[] = facts.map(() => ({
      valence: "neutral" as EmotionalValence,
      intensity: 0.0,
    }));

    for (const entry of object.emotions) {
      if (entry.factIndex >= 0 && entry.factIndex < facts.length) {
        results[entry.factIndex] = {
          valence: entry.valence,
          intensity: entry.intensity,
        };
      }
    }

    return results;
  } catch {
    // On failure, return all neutral (non-blocking)
    return facts.map(() => ({ valence: "neutral" as EmotionalValence, intensity: 0.0 }));
  }
}

/**
 * Compute importance boost from emotional intensity.
 * In the brain: amygdala activation during encoding → stronger trace.
 * High emotional intensity → up to +0.3 importance bonus.
 */
export function computeEmotionalImportanceBoost(intensity: number): number {
  // Linear: 0 intensity → 0 boost, 1.0 intensity → 0.3 boost
  return intensity * 0.3;
}

