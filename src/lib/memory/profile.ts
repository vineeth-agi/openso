import { generateText } from "ai";

import { getFactsByCategory } from "./store";

import { google } from "@/lib/ai/google-provider";
import { createAdminClient } from "@/lib/insforge/admin";

function getModel() {
  // DeepSeek V4 Flash is fast + cheap for profile summaries.
  return google();
}

export interface UserMemoryProfile {
  id: string;
  userId: string;
  staticFacts: string[];
  dynamicFacts: string[];
  summary: string;
  lastComputedAt: string;
  version: number;
}

// Categories that form the "static" profile (rarely change)
const STATIC_CATEGORIES = [
  "personal",
  "professional",
  "technical",
  "goal",
];

// Categories that form the "dynamic" profile (change frequently)
const DYNAMIC_CATEGORIES = [
  "preference",
  "behavioral",
  "outcome",
];

/**
 * Get the cached user memory profile.
 * Returns null if no profile has been computed yet.
 */
export async function getProfile(
  userId: string,
): Promise<UserMemoryProfile | null> {
  const db = createAdminClient();

  const { data } = await db.database.from("user_memory_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!data) return null;
  return mapRow(data);
}

/**
 * Build or rebuild the user memory profile from current facts.
 * Separates facts into static (stable) and dynamic (recent),
 * then generates an AI summary paragraph.
 */
export async function buildProfile(
  userId: string,
): Promise<UserMemoryProfile> {
  // Gather facts by category
  const [staticFacts, dynamicFacts] = await Promise.all([
    gatherFacts(userId, STATIC_CATEGORIES),
    gatherFacts(userId, DYNAMIC_CATEGORIES),
  ]);

  // Generate AI summary from all facts
  const summary = await generateProfileSummary(staticFacts, dynamicFacts);

  const db = createAdminClient();

  const { data } = await db.database.from("user_memory_profiles")
    .upsert(
      {
        user_id: userId,
        static_facts: staticFacts,
        dynamic_facts: dynamicFacts,
        summary,
        last_computed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();

  // Increment version
  if (data) {
    await db.database.from("user_memory_profiles")
      .update({ version: (data.version ?? 0) + 1 })
      .eq("user_id", userId);
  }

  return mapRow(data!);
}

/**
 * Refresh profile only if it's stale (older than given hours).
 */
export async function refreshProfileIfStale(
  userId: string,
  maxAgeHours: number = 24,
): Promise<UserMemoryProfile> {
  const existing = await getProfile(userId);

  if (existing) {
    const age =
      Date.now() - new Date(existing.lastComputedAt).getTime();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    if (age < maxAgeMs) {
      return existing;
    }
  }

  return buildProfile(userId);
}

/**
 * Gather fact strings from specified categories.
 * Runs all category lookups in parallel — previously this was sequential.
 */
async function gatherFacts(
  userId: string,
  categories: string[],
): Promise<string[]> {
  const factGroups = await Promise.all(
    categories.map((category) => getFactsByCategory(userId, category)),
  );
  return factGroups.flatMap((facts) => facts.map((f) => f.fact));
}

/**
 * Generate a 1-paragraph AI summary of the user from their facts.
 */
async function generateProfileSummary(
  staticFacts: string[],
  dynamicFacts: string[],
): Promise<string> {
  if (staticFacts.length === 0 && dynamicFacts.length === 0) {
    return "No profile data available yet.";
  }

  const prompt = `You are a profile summarizer for a personal AI assistant. Given the following facts about a user, write a single concise paragraph (max 150 words) that describes who they are, what they're working on, and their key preferences. This summary will be injected into AI system prompts to personalize responses.

Stable facts about the user:
${staticFacts.length > 0 ? staticFacts.map((f) => `- ${f}`).join("\n") : "- None yet"}

Recent/dynamic facts:
${dynamicFacts.length > 0 ? dynamicFacts.map((f) => `- ${f}`).join("\n") : "- None yet"}

Write the summary in third person (e.g., "The user is..."):`;

  try {
    const { text } = await generateText({
      model: getModel(),
      prompt,
      maxOutputTokens: 256,
    });
    return text.trim();
  } catch {
    return "Profile summary generation failed. Facts are available but unprocessed.";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): UserMemoryProfile {
  return {
    id: row.id,
    userId: row.user_id,
    staticFacts: row.static_facts ?? [],
    dynamicFacts: row.dynamic_facts ?? [],
    summary: row.summary ?? "",
    lastComputedAt: row.last_computed_at,
    version: row.version ?? 1,
  };
}

