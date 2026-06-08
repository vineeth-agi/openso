import { tool } from "ai";
import { z } from "zod";

import { auditLog } from "./dream-cycle";
import type { ExtractedFact } from "./extractor";
import { getProfile } from "./profile";
import { addFact , searchFacts, deleteFact } from "./store";



// ── Safety Guardrails ──
// Block facts that could be dangerous if stored as "memory" (medical/legal/identity claims)
const UNSAFE_FACT_PATTERNS = [
  /\b(take|prescrib|dos(?:age|e)|inject|overdos|suicid|self.?harm)\b/i,
  /\b(kill|murder|bomb|weapon|explos|terror)\b/i,
  /\b(social security|ssn|credit card|bank account|routing number|passport)\b/i,
  /\b(password|api.?key|secret.?key|private.?key|token)\b/i,
];

// Block prompt injection attempts in fact content
const INJECTION_PATTERNS = [
  /ignore (previous|all|prior|above) instructions/i,
  /you are now/i,
  /new instructions:/i,
  /system prompt:/i,
  /\bDAN\b/,
  /<\/?(?:system|assistant|user)>/i,
];

function isUnsafeFact(fact: string): { blocked: boolean; reason?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(fact)) {
      return { blocked: true, reason: "Content appears to contain prompt injection." };
    }
  }
  for (const pattern of UNSAFE_FACT_PATTERNS) {
    if (pattern.test(fact)) {
      return { blocked: true, reason: "Content contains sensitive information (medical/legal/credential). Not stored for safety." };
    }
  }
  if (fact.length > 500) {
    return { blocked: true, reason: "Fact too long. Keep it to 1-2 sentences." };
  }
  return { blocked: false };
}

/**
 * Build memory tools that the AI can call during chat to manage user memory.
 */
export function buildMemoryTools(userId: string, userTimezone?: string) {
  return {
    rememberFact: tool({
      description:
        "Save an important fact about the user to long-term memory. Use this when the user shares something worth remembering — preferences, plans, goals, or personal details.",
      inputSchema: z.object({
        fact: z.string().describe("The fact to remember about the user"),
        category: z
          .enum([
            "personal",
            "professional",
            "technical",
            "preference",
            "behavioral",
            "goal",
            "outcome",
          ])
          .describe("Category of the fact"),
        importance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("How important is this fact (0-1, default 0.7)"),
      }),
      execute: async ({ fact, category, importance }) => {
        // Safety guardrail: block dangerous/injection content
        const safety = isUnsafeFact(fact);
        if (safety.blocked) {
          await auditLog(userId, "remember_blocked", "memory_facts", undefined, { fact, reason: safety.reason });
          return { status: "blocked", message: safety.reason ?? "Fact blocked by safety filter." };
        }

        try {
          const extracted: ExtractedFact = {
            fact,
            category,
            memoryType: "fact",
            confidence: 0.95,
            importance: importance ?? 0.7,
          };
          const result = await addFact(userId, extracted, "chat");

          await auditLog(userId, "remember_fact", "memory_facts", result.factId, { fact, category, action: result.action });

          return {
            status: result.action,
            message:
              result.action === "inserted"
                ? `Remembered: "${fact}"`
                : result.action === "updated"
                  ? `Updated existing memory with: "${fact}"`
                  : `Already known: "${fact}"`,
          };
        } catch (e) {
          console.error("[memory] rememberFact failed:", e);
          return { status: "error", message: `Failed to save: ${e instanceof Error ? e.message : "Unknown error"}` };
        }
      },
    }),

    recallMemory: tool({
      description:
        "Search user's memory for relevant facts. Use this when you need to recall something about the user that isn't in the current conversation context.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("What to search for in the user's memory"),
        limit: z
          .number()
          .optional()
          .describe("Max results to return (default 5)"),
      }),
      execute: async ({ query, limit }) => {
        const facts = await searchFacts(userId, query, limit ?? 5);
        if (facts.length === 0) {
          return { found: false, message: "No relevant memories found." };
        }
        return {
          found: true,
          facts: facts.map((f) => ({
            fact: f.fact,
            category: f.category,
            source: f.source,
            confidence: f.confidence,
            createdAt: f.createdAt,
          })),
        };
      },
    }),

    getUserProfile: tool({
      description:
        "Get the user's full memory profile — who they are, what they're working on, their skills and preferences.",
      inputSchema: z.object({
        _: z.string().optional().describe("Dummy parameter - not used")
      }),
      execute: async () => {
        const profile = await getProfile(userId);
        if (!profile) {
          return { hasProfile: false, message: "No profile built yet." };
        }
        return {
          hasProfile: true,
          summary: profile.summary,
          staticFacts: profile.staticFacts,
          dynamicFacts: profile.dynamicFacts,
          version: profile.version,
        };
      },
    }),

    forgetFact: tool({
      description:
        "Delete a specific fact from user's memory. Use when the user asks you to forget something or when information is incorrect.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Search term to find the fact to delete"),
      }),
      execute: async ({ query }) => {
        // Find the fact first
        const facts = await searchFacts(userId, query, 1);
        if (facts.length === 0) {
          return { deleted: false, message: "No matching memory found." };
        }
        const fact = facts[0];
        await deleteFact(fact.id, userId);

        await auditLog(userId, "forget_fact", "memory_facts", fact.id, { fact: fact.fact, category: fact.category });

        return {
          deleted: true,
          message: `Forgot: "${fact.fact}"`,
        };
      },
    }),


  };
}
