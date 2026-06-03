import { generateObject } from "ai";
import { z } from "zod";

import { google } from "@/lib/ai/google-provider";

function getModel() {
  return google();
}

const FactSchema = z.object({
  facts: z.array(z.object({
    category: z.enum(["personal", "professional", "technical", "preference", "behavioral", "goal", "outcome"]),
    fact: z.string(),
    confidence: z.number().min(0).max(1),
    importance: z.number().min(0).max(1),
    memoryType: z.enum(["fact", "preference", "episode"]),
    eventTime: z.string().optional(),
    validUntil: z.string().optional(),
  })),
});

export interface ExtractedFact {
  category:
    | "personal"
    | "professional"
    | "technical"
    | "preference"
    | "behavioral"
    | "goal"
    | "outcome";
  fact: string;
  confidence: number;
  importance: number;
  memoryType: "fact" | "preference" | "episode";
  eventTime?: string;
  validUntil?: string;
  emotionalValence?: "positive" | "negative" | "neutral";
  emotionalIntensity?: number;
}

/**
 * Extracts high-value facts from text using AI structured output.
 * Selective capture: extracts only meaningful facts, NOT raw content.
 */
export async function extractFacts(
  text: string,
  source: string,
  context?: string | { hint?: string },
): Promise<ExtractedFact[]> {
  const contextStr =
    typeof context === "string"
      ? context
      : context?.hint ?? "";

  const systemPrompt = `You are a memory extraction engine. Your job is to extract high-value facts about a user from the provided text.

Rules:
1. Extract ONLY meaningful, reusable facts — preferences, skills, relationships, goals, outcomes.
2. Do NOT extract raw content, timestamps, or noise.
3. Each fact should be a concise, self-contained statement (1 sentence).
4. Assign confidence (0.0-1.0): how certain you are this fact is true.
   - If the AI assistant in the conversation expressed doubt or pushed back on a claim, assign very low confidence (≤0.2).
   - If a claim contradicts multiple established facts in the same conversation, assign low confidence (≤0.3).
   - If a claim seems implausible or like a joke (e.g. "I'm Elon Musk"), assign very low confidence (≤0.15).
5. Assign importance (0.0-1.0): how useful this fact is for future AI interactions.
6. Categorize each fact:
   - personal: name, location, education, personal details
   - professional: job, company, work experience, career
   - technical: programming languages, frameworks, tools, skills
   - preference: likes, dislikes, communication style, work style
   - behavioral: patterns, habits, tendencies observed
   - goal: stated objectives, aspirations, plans
   - outcome: completed tasks, achieved results, decisions made
7. Classify memoryType:
   - fact: stable information (persists until contradicted)
   - preference: user preference (strengthens with repetition)
   - episode: time-bound event (may expire)
8. If a fact refers to a specific past time period, set eventTime to an ISO date (e.g. "2023-01-01").
9. If a fact has a known expiry (e.g. "valid until end of project"), set validUntil to an ISO date.

Source of this text: ${source}
${contextStr ? `Additional context: ${contextStr}` : ""}

If no meaningful facts can be extracted, return an empty array.`;

  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: FactSchema,
      prompt: `${systemPrompt}\n\nText to analyze:\n${text}`,
    });
    return object.facts.map((f) => ({
      ...f,
      eventTime: f.eventTime ?? undefined,
      validUntil: f.validUntil ?? undefined,
    }));
  } catch {
    return [];
  }
}

const RelationshipSchema = z.object({
  relationship: z.enum(["update", "extend", "duplicate", "unrelated", "temporal-coexist"]),
  reason: z.string().optional(),
});

/**
 * Given a new fact and an existing fact, determine the relationship.
 * Temporally aware: facts about different time periods can coexist.
 * Returns:
 *   'update'           — new fact replaces/contradicts existing (same time context)
 *   'extend'           — new fact adds detail without replacing
 *   'duplicate'        — essentially the same
 *   'unrelated'        — different topics
 *   'temporal-coexist' — both facts are true but at different times (e.g. "lived in NYC in 2022" vs "lives in SF now")
 */
export async function classifyFactRelationship(
  newFact: string,
  existingFact: string,
  newEventTime?: string,
): Promise<"update" | "extend" | "duplicate" | "unrelated" | "temporal-coexist"> {
  const temporalHint = newEventTime
    ? `\nNote: The new fact has an explicit event time of ${newEventTime}. If the existing fact describes a different time period, classify as 'temporal-coexist'.`
    : "";

  const prompt = `Compare these two facts about a user and classify their relationship.

Existing fact: "${existingFact}"
New fact: "${newFact}"${temporalHint}

Rules:
- "update": The new fact directly contradicts or replaces the existing fact at the SAME time context (e.g., "lives in NYC" → "moved to SF")
- "extend": The new fact adds detail to the existing without replacing (e.g., "works at Google" + "leads the Search team")
- "duplicate": Essentially the same information (e.g., "likes Python" ≈ "prefers Python")
- "temporal-coexist": Both facts are true but at DIFFERENT time periods (e.g., "worked at Google in 2022" vs "now works at Meta"). KEEP BOTH.
- "unrelated": Different topics entirely`;

  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: RelationshipSchema,
      prompt,
    });
    return object.relationship;
  } catch {
    return "unrelated";
  }
}
