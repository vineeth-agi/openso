/**
 * Real-Time Memory Extraction — closes the gap between message and recall.
 *
 * Problem: The Dream Cycle runs every 10 minutes (or on buffer threshold).
 * During that window, the AI doesn't "know" what was just discussed unless
 * it's in the session summary (which is lossy and unstructured).
 *
 * Solution: Extract high-importance facts INLINE in the onFinish handler.
 * - Uses the fast model (DeepSeek V4 Flash via Pioneer) for speed
 * - Only extracts facts above an importance threshold (0.7+)
 * - Skips extraction if the message is trivial (greetings, short replies)
 * - Fire-and-forget: doesn't block the response stream
 * - Dream Cycle still runs for deeper processing (associations, graph, narrative)
 *
 * This gives us Supermemory-like real-time indexing while keeping the
 * Dream Cycle for consolidation.
 */

import { generateObject } from "ai";
import { z } from "zod";

import { addFact } from "./store";

import { google } from "@/lib/ai/google-provider";

// ── Config ──
const MIN_MESSAGE_LENGTH = 40; // Skip very short messages
const IMPORTANCE_THRESHOLD = 0.6; // Only persist facts above this
const MAX_INLINE_FACTS = 3; // Cap to keep latency low

function getFastModel() {
  // DeepSeek V4 Flash is fast and cost-efficient for realtime extraction.
  return google();
}

// ── High-importance pattern detection (zero-cost regex gate) ──

const HIGH_IMPORTANCE_PATTERNS = [
  // Identity
  /\b(my name is|i am|i'm called|call me)\b/i,
  // Location
  /\b(i live in|i moved to|i'm from|i'm based in|i relocated)\b/i,
  // Professional
  /\b(i work at|i work as|i'm a|my job|i got hired|i got fired|i quit|i'm starting at|i joined|my role is|i got promoted)\b/i,
  // Education
  /\b(i graduated|i'm studying|i go to|my degree|i'm enrolled)\b/i,
  // Relationships
  /\b(my (wife|husband|partner|girlfriend|boyfriend|mom|dad|brother|sister|son|daughter|child|kid|friend|boss|manager|colleague))\b/i,
  // Preferences (strong)
  /\b(i (love|hate|prefer|always|never|can't stand|really like|despise))\b/i,
  // Goals
  /\b(i want to|i'm planning to|my goal is|i'm trying to|i need to|i'm going to)\b/i,
  // Life events
  /\b(i'm getting married|i'm pregnant|i had a baby|i'm retiring|i'm moving|i bought|i sold)\b/i,
  // Technical identity
  /\b(my stack is|i use|i prefer|my favorite (language|framework|tool|editor))\b/i,
  // Corrections / updates
  /\b(actually|correction|i meant|no,? i|wait,? i)\b/i,
];

/**
 * Fast regex check: does this message likely contain extractable facts?
 * This is the zero-cost gate that prevents unnecessary LLM calls.
 */
export function shouldExtractInline(userMessage: string): boolean {
  if (userMessage.length < MIN_MESSAGE_LENGTH) return false;
  return HIGH_IMPORTANCE_PATTERNS.some((pattern) => pattern.test(userMessage));
}

// ── Inline extraction schema (minimal, fast) ──

const InlineFactSchema = z.object({
  facts: z.array(z.object({
    category: z.enum(["personal", "professional", "technical", "preference", "behavioral", "goal", "outcome"]),
    fact: z.string().describe("1 concise sentence, self-contained"),
    confidence: z.number().min(0).max(1),
    importance: z.number().min(0).max(1),
    memoryType: z.enum(["fact", "preference", "episode"]),
    eventTime: z.string().optional().describe("ISO date if referring to a specific past event"),
  })),
});

/**
 * Extract high-importance facts from the latest user message in real-time.
 * Called inline in onFinish — must be fast (uses flash model, small prompt).
 *
 * Only extracts facts with importance >= IMPORTANCE_THRESHOLD.
 * The Dream Cycle will later do full extraction (with emotional tagging,
 * associations, graph, etc.) — this just ensures critical facts are
 * immediately searchable.
 */
export async function extractAndStoreInline(
  userId: string,
  userMessage: string,
  assistantResponse?: string,
): Promise<{ extracted: number; stored: number }> {
  // Build a minimal prompt — only the latest exchange, not full history
  const transcript = assistantResponse
    ? `User: ${userMessage}\nAI: ${assistantResponse}`
    : `User: ${userMessage}`;

  const today = new Date().toISOString().split("T")[0];

  try {
    const { object } = await generateObject({
      model: getFastModel(),
      schema: InlineFactSchema,
      prompt: `You are a fast fact extractor. Extract ONLY high-importance facts (importance >= 0.7) from this message exchange.

Rules:
- Only extract facts that are CRITICAL for the AI to remember immediately.
- Identity facts (name, location, job) = importance 0.9+
- Strong preferences = importance 0.7+
- Goals and life events = importance 0.8+
- Skip small talk, questions, technical discussions without personal info.
- Each fact: 1 concise sentence, self-contained.
- If the AI pushed back or expressed doubt, assign low confidence (≤0.3).
- If sarcastic or joking, skip entirely.
- Today is ${today}. Resolve relative dates.
- Max ${MAX_INLINE_FACTS} facts. Quality over quantity.

Exchange:
${transcript.slice(0, 3000)}`,
      maxOutputTokens: 512,
    });

    const highImportanceFacts = object.facts
      .filter((f) => f.importance >= IMPORTANCE_THRESHOLD)
      .slice(0, MAX_INLINE_FACTS);

    if (highImportanceFacts.length === 0) {
      return { extracted: object.facts.length, stored: 0 };
    }

    // Store facts immediately (addFact handles deduplication + contradiction)
    let stored = 0;
    for (const fact of highImportanceFacts) {
      try {
        const result = await addFact(userId, {
          fact: fact.fact,
          category: fact.category,
          memoryType: fact.memoryType,
          confidence: fact.confidence,
          importance: fact.importance,
          eventTime: fact.eventTime,
          // Emotional tagging deferred to Dream Cycle (keeps inline fast)
          emotionalValence: undefined,
          emotionalIntensity: undefined,
        }, "realtime-inline");

        if (result.action === "inserted" || result.action === "updated") {
          stored++;
        }
      } catch {
        // Individual fact failure — non-blocking
      }
    }

    return { extracted: object.facts.length, stored };
  } catch (e) {
    // Total failure — non-blocking, Dream Cycle will catch it later
    console.warn("[realtime-extractor] Inline extraction failed (non-blocking):", e);
    return { extracted: 0, stored: 0 };
  }
}
