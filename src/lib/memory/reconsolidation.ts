/**
 * Memory Reconsolidation — retrieved memories become labile (modifiable).
 *
 * Implementation:
 * - After retrieval, facts enter a "reconsolidation window" (tracked by last_retrieved_at)
 * - During the next Dream Cycle, recently-retrieved facts are re-evaluated
 *   against new conversation context
 * - Facts can be: strengthened (confidence++), weakened (confidence--), or modified
 * - This is NOT contradiction detection (handled by addFact dedup) — this is gradual drift
 */

import { generateObject } from "ai";
import { z } from "zod";

import { google } from "@/lib/ai/google-provider";
import { createAdminClient } from "@/lib/insforge/admin";

function getModel() {
  return google();
}

const ReconsolidationSchema = z.object({
  evaluations: z.array(z.object({
    factId: z.string(),
    action: z.enum(["strengthen", "weaken", "unchanged"]),
    newConfidence: z.number().min(0).max(1).optional(),
    reason: z.string().optional(),
  })),
});

export interface ReconsolidationResult {
  strengthened: number;
  weakened: number;
  unchanged: number;
}

/**
 * Reconsolidate recently-retrieved facts against new conversation context.
 * Called during the Dream Cycle extract phase.
 *
 * Only processes facts that were:
 * 1. Retrieved in the last 24 hours (in their "labile window")
 * 2. Related to the current conversation context
 */
export async function reconsolidateRecentFacts(
  userId: string,
  newTranscript: string,
): Promise<ReconsolidationResult> {
  const db = createAdminClient();
  const result: ReconsolidationResult = { strengthened: 0, weakened: 0, unchanged: 0 };

  // Find facts retrieved in the last 24 hours (labile window)
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: labileFacts } = await db.database.from("memory_facts")
    .select("id, fact, category, confidence, importance")
    .eq("user_id", userId)
    .eq("is_latest", true)
    .gte("last_retrieved_at", windowStart)
    .order("last_retrieved_at", { ascending: false })
    .limit(10);

  if (!labileFacts || labileFacts.length === 0) return result;

  // Ask LLM: does the new conversation support or undermine these facts?
  const factsText = labileFacts
    .map((f) => `[${f.id}] (${f.category}, confidence: ${f.confidence}) "${f.fact}"`)
    .join("\n");

  const prompt = `You are a memory reconsolidation engine. The user recently recalled these facts during a conversation. Now, based on new conversation context, determine if each fact should be strengthened, weakened, or left unchanged.

Recently recalled facts:
${factsText}

New conversation context:
${newTranscript.slice(0, 4000)}

Rules:
- "strengthen": New context confirms or reinforces this fact. Increase confidence.
- "weaken": New context subtly undermines or contradicts this fact (but not a full replacement). Decrease confidence.
- "unchanged": New context is unrelated to this fact. Leave it alone.
- Most facts should be "unchanged" — only modify if there's clear evidence.
- Do NOT mark as "weaken" if it's a full contradiction (that's handled by the dedup system).
- Weakening is for SUBTLE doubt: "I used to like Python, but lately..." → weaken "User likes Python"
- IMPORTANT: If the user makes an implausible claim (e.g. "I'm Elon Musk") that contradicts a high-confidence fact, mark as "unchanged". Single unsubstantiated claims should NOT weaken established facts.`;

  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: ReconsolidationSchema,
      prompt,
      maxOutputTokens: 4096,
    });

    for (const evaluation of object.evaluations) {
      const fact = labileFacts.find((f) => f.id === evaluation.factId);
      if (!fact) continue;

      if (evaluation.action === "strengthen") {
        const newConf = Math.min(1.0, (evaluation.newConfidence ?? fact.confidence) + 0.05);
        await db.database.from("memory_facts")
          .update({ confidence: newConf, updated_at: new Date().toISOString() })
          .eq("id", fact.id);
        result.strengthened++;
      } else if (evaluation.action === "weaken") {
        // Hard floor: high-confidence facts (≥0.8) can't drop below 0.5 in one cycle
        const floor = fact.confidence >= 0.8 ? 0.5 : 0.1;
        const newConf = Math.max(floor, (evaluation.newConfidence ?? fact.confidence) - 0.1);
        await db.database.from("memory_facts")
          .update({ confidence: newConf, updated_at: new Date().toISOString() })
          .eq("id", fact.id);
        result.weakened++;
      } else {
        result.unchanged++;
      }
    }
  } catch {
    // Non-blocking: reconsolidation failure doesn't break the cycle
  }

  return result;
}
