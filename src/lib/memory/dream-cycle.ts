// NEMO Dream Cycle — async background memory processing
// Runs: Observer (L1→L2) → Extractor (L1→L4) → Reflector (L2 pruning) → Narrator (L4→L3)
// Triggered by cron or when buffer exceeds threshold

import { generateObject, generateText } from "ai";
import { z } from "zod";

import { associateCoOccurringFacts } from "./associations";
import { analyzeEmotions } from "./emotional";
import { isEffectivelyForgotten, pruneEffectivelyForgottenFacts } from "./forgetting";
import { extractGraph } from "./graph-extractor";
import { addToGraph } from "./graph-store";
import { reconsolidateRecentFacts } from "./reconsolidation";
import { addFact } from "./store";

import { google } from "@/lib/ai/google-provider";
import { createAdminClient } from "@/lib/insforge/admin";

// ── Config ──
// With real-time inline extraction, the Dream Cycle is now a consolidation pass
// that runs every 12 hours (not 10 minutes). It handles: associations, emotional
// tagging, reconsolidation, graph extraction, narrative rebuild, and forgetting.
const OBSERVE_THRESHOLD_MSGS = Number(process.env.NEMO_OBSERVE_THRESHOLD_MSGS ?? "20");
const REFLECT_THRESHOLD_TOKENS = Number(process.env.NEMO_REFLECT_THRESHOLD_TOKENS ?? "15000");
const MAX_OBSERVATIONS_PER_CYCLE = Number(process.env.NEMO_MAX_OBS_PER_CYCLE ?? "8");
const MAX_FACTS_PER_CYCLE = Number(process.env.NEMO_MAX_FACTS_PER_CYCLE ?? "6");
const OBS_DECAY_FLOOR = 0.1;
const OBS_DECAY_RATE = 0.95;

function getFastModel() {
  return google();
}


// ── Types ──

interface BufferMessage {
  id: string;
  userId: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface DreamCycleResult {
  cycleType: string;
  messagesProcessed: number;
  factsCreated: number;
  factsUpdated: number;
  observationsCreated: number;
  observationsPruned: number;
  associationsCreated: number;
  reconsolidated: { strengthened: number; weakened: number };
  durationMs: number;
  error?: string;
}

// ── Public API ──

/**
 * Run the full Dream Cycle for a user.
 * Called by cron job or when buffer exceeds threshold.
 * Uses PostgreSQL advisory lock to prevent concurrent cycles for the same user.
 */
export async function runDreamCycle(userId: string): Promise<DreamCycleResult[]> {
  const db = createAdminClient();

  // Acquire advisory lock — prevents duplicate processing if cron + threshold fire simultaneously
  const { data: lockAcquired } = await db.database.rpc("acquire_dream_cycle_lock", { target_user_id: userId });
  if (!lockAcquired) {
    // Another Dream Cycle is already running for this user — skip
    return [];
  }

  try {
    const results: DreamCycleResult[] = [];

    // Step 1: Observe — compress buffer → observations
    const observeResult = await observe(userId);
    if (observeResult) results.push(observeResult);

    // Step 2: Extract — buffer → atomic facts + emotional tagging + associations
    const extractResult = await extract(userId);
    if (extractResult) results.push(extractResult);

    // Step 2.5: Reconsolidate — recently retrieved facts re-evaluated against new context
    const reconResult = await reconsolidate(userId);
    if (reconResult) results.push(reconResult);

    // Step 3: Reflect — prune stale observations if needed
    const reflectResult = await reflect(userId);
    if (reflectResult) results.push(reflectResult);

    // Step 4: Narrate — rebuild narrative sections if any facts changed
    const factsChanged =
      (extractResult && (extractResult.factsCreated > 0 || extractResult.factsUpdated > 0))
      || (reconResult && (reconResult.reconsolidated.strengthened > 0 || reconResult.reconsolidated.weakened > 0))
      || (reflectResult && reflectResult.observationsPruned > 0);
    if (factsChanged) {
      const narrateResult = await narrate(userId);
      if (narrateResult) results.push(narrateResult);
    }

    // Step 5: Mark buffer as processed
    await markBufferProcessed(userId);

    // Step 6: Prune effectively forgotten facts (enforce forgetting curve)
    try {
      const { pruned } = await pruneEffectivelyForgottenFacts(userId);
      if (pruned > 0) {
        console.log(`[dream-cycle] Pruned ${pruned} forgotten facts for user ${userId}`);
      }
    } catch (e) {
      console.warn("[dream-cycle] Forgetting pruning failed (non-blocking):", e);
    }

    // Audit log
    await auditLog(userId, "dream_cycle_complete", "memory_buffer", undefined, {
      results: results.map(r => ({ type: r.cycleType, facts: r.factsCreated, obs: r.observationsCreated })),
    });

    return results;
  } finally {
    // Always release the advisory lock
    try {
      await db.database.rpc("release_dream_cycle_lock", { target_user_id: userId });
    } catch {
      // Non-blocking: lock will auto-release at session end
    }
  }
}

/**
 * Check if a user's buffer needs processing.
 * With real-time inline extraction handling critical facts immediately,
 * the Dream Cycle only needs to run for consolidation (associations,
 * emotional tagging, narrative rebuild, forgetting).
 * Threshold raised: only trigger if buffer is large (20+ user messages)
 * or contains high-importance content that inline extraction might have missed.
 */
export async function shouldRunDreamCycle(userId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data: msgs, count } = await db.database.from("memory_buffer")
    .select("content", { count: "exact" })
    .eq("user_id", userId)
    .eq("processed", false)
    .eq("role", "user")
    .limit(50);

  const msgCount = count ?? 0;
  if (msgCount >= OBSERVE_THRESHOLD_MSGS) return true;

  // Sub-threshold extraction: process even shorter sessions if they contain
  // content that benefits from consolidation (associations, graph, emotional tagging)
  if (msgCount >= 10 && msgs && msgs.length > 0) {
    const HIGH_IMPORTANCE_PATTERNS = /\b(my name is|i am|i work at|i moved to|i quit|i got fired|i got promoted|i'm getting married|i'm pregnant|i graduated|i started|i'm leaving)\b/i;
    const hasHighImportance = msgs.some((m) => HIGH_IMPORTANCE_PATTERNS.test(m.content ?? ""));
    if (hasHighImportance) return true;
  }

  return false;
}

// ── Step 1: Observer (L1 → L2) ──

async function observe(userId: string): Promise<DreamCycleResult | null> {
  const start = Date.now();
  const db = createAdminClient();

  try {
    const messages = await fetchUnprocessedBuffer(userId);
    if (messages.length === 0) return null;

    const transcript = messages
      .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
      .join("\n");

    const observations = await compressToObservations(transcript);
    if (observations.length === 0) {
      return {
        cycleType: "observe",
        messagesProcessed: messages.length,
        factsCreated: 0, factsUpdated: 0,
        observationsCreated: 0, observationsPruned: 0,
        associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 },
        durationMs: Date.now() - start,
      };
    }

    // Insert observations
    let created = 0;
    for (const obs of observations.slice(0, MAX_OBSERVATIONS_PER_CYCLE)) {
      const { error } = await db.database.from("memory_observations").insert({
        user_id: userId,
        observation_date: new Date().toISOString().split("T")[0],
        priority: obs.priority,
        content: obs.content,
        referenced_date: obs.referencedDate ?? null,
      });
      if (!error) created++;
    }

    await logDreamCycle(userId, "observe", messages.length, 0, 0, created, 0, Date.now() - start);

    return {
      cycleType: "observe",
      messagesProcessed: messages.length,
      factsCreated: 0, factsUpdated: 0,
      observationsCreated: created, observationsPruned: 0,
      associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 },
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logDreamCycle(userId, "observe", 0, 0, 0, 0, 0, Date.now() - start, error);
    return { cycleType: "observe", messagesProcessed: 0, factsCreated: 0, factsUpdated: 0, observationsCreated: 0, observationsPruned: 0, associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 }, durationMs: Date.now() - start, error };
  }
}

// ── Step 2: Extractor (L1 → L4) — now with emotional tagging + associations ──

async function extract(userId: string): Promise<DreamCycleResult | null> {
  const start = Date.now();

  try {
    const messages = await fetchUnprocessedBuffer(userId);
    if (messages.length === 0) return null;

    const transcript = messages
      .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
      .join("\n");

    // Run fact extraction + graph extraction in parallel
    const [facts, graphData] = await Promise.all([
      extractFactsFromTranscript(transcript),
      extractGraph(transcript, "Dream cycle extraction").catch(() => ({ entities: [], relationships: [] })),
    ]);

    // Emotional analysis: tag each fact with valence + intensity (batch LLM call)
    const factTexts = facts.slice(0, MAX_FACTS_PER_CYCLE).map((f) => f.fact);
    const emotions = await analyzeEmotions(factTexts).catch(() => factTexts.map(() => ({ valence: "neutral" as const, intensity: 0 })));

    let created = 0;
    let updated = 0;
    const insertedFactIds: string[] = [];
    const factCategories = new Map<string, string>();

    // Save atomic facts with emotional metadata
    const factsToProcess = facts.slice(0, MAX_FACTS_PER_CYCLE);
    for (let i = 0; i < factsToProcess.length; i++) {
      const fact = factsToProcess[i];
      const emotion = emotions[i] ?? { valence: "neutral" as const, intensity: 0 };
      try {
        const result = await addFact(userId, {
          fact: fact.fact,
          category: fact.category,
          memoryType: fact.memoryType,
          confidence: fact.confidence,
          importance: fact.importance,
          eventTime: fact.eventTime,
          emotionalValence: emotion.valence,
          emotionalIntensity: emotion.intensity,
        }, "dream-cycle");
        if (result.action === "inserted" && result.factId) {
          created++;
          insertedFactIds.push(result.factId);
          factCategories.set(result.factId, fact.category);
        } else if (result.action === "updated" && result.factId) {
          updated++;
          insertedFactIds.push(result.factId);
          factCategories.set(result.factId, fact.category);
        }
      } catch {
        // skip individual fact failures
      }
    }

    // Create associations between co-occurring facts (contextual links)
    let associationsCreated = 0;
    if (insertedFactIds.length >= 2) {
      associationsCreated = await associateCoOccurringFacts(userId, insertedFactIds, factCategories).catch(() => 0);
    }

    // Save graph entities + relationships
    if (graphData.entities.length > 0 || graphData.relationships.length > 0) {
      await addToGraph(userId, graphData).catch((e: unknown) => {
        console.warn("[dream-cycle] Graph extraction failed (non-blocking):", e);
      });
    }

    await logDreamCycle(userId, "extract", messages.length, created, updated, 0, 0, Date.now() - start);

    return {
      cycleType: "extract",
      messagesProcessed: messages.length,
      factsCreated: created, factsUpdated: updated,
      observationsCreated: 0, observationsPruned: 0,
      associationsCreated,
      reconsolidated: { strengthened: 0, weakened: 0 },
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logDreamCycle(userId, "extract", 0, 0, 0, 0, 0, Date.now() - start, error);
    return { cycleType: "extract", messagesProcessed: 0, factsCreated: 0, factsUpdated: 0, observationsCreated: 0, observationsPruned: 0, associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 }, durationMs: Date.now() - start, error };
  }
}

// ── Step 2.5: Reconsolidate (brain-inspired: retrieved memories become labile) ──

async function reconsolidate(userId: string): Promise<DreamCycleResult | null> {
  const start = Date.now();
  try {
    const messages = await fetchUnprocessedBuffer(userId);
    if (messages.length === 0) return null;

    const transcript = messages
      .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
      .join("\n");

    const result = await reconsolidateRecentFacts(userId, transcript);

    await logDreamCycle(userId, "reconsolidate", 0, 0, 0, 0, 0, Date.now() - start);

    return {
      cycleType: "reconsolidate",
      messagesProcessed: 0,
      factsCreated: 0, factsUpdated: result.strengthened + result.weakened,
      observationsCreated: 0, observationsPruned: 0,
      associationsCreated: 0,
      reconsolidated: { strengthened: result.strengthened, weakened: result.weakened },
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logDreamCycle(userId, "reconsolidate", 0, 0, 0, 0, 0, Date.now() - start, error);
    return { cycleType: "reconsolidate", messagesProcessed: 0, factsCreated: 0, factsUpdated: 0, observationsCreated: 0, observationsPruned: 0, associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 }, durationMs: Date.now() - start, error };
  }
}

// ── Step 3: Reflector (L2 pruning) ──

async function reflect(userId: string): Promise<DreamCycleResult | null> {
  const start = Date.now();
  const db = createAdminClient();

  try {
    // Check if observation log exceeds token threshold
    const { data: observations } = await db.database.from("memory_observations")
      .select("id, content, priority, decay_score")
      .eq("user_id", userId)
      .order("observation_date", { ascending: false })
      .limit(100);

    // Ebbinghaus pruning: always run — expire facts whose memory strength decayed below threshold
    const { data: facts } = await db.database.from("memory_facts")
      .select("id, half_life_days, retrieval_count, last_retrieved_at, emotional_intensity, is_latest, created_at")
      .eq("user_id", userId)
      .eq("is_latest", true)
      .limit(200);

    let factsExpired = 0;
    for (const fact of facts ?? []) {
      const forgotten = isEffectivelyForgotten({
        halfLifeDays: fact.half_life_days,
        lastRetrievedAt: fact.last_retrieved_at,
        createdAt: fact.created_at,
        retrievalCount: fact.retrieval_count,
        emotionalIntensity: fact.emotional_intensity ?? 0,
      });

      if (forgotten) {
        await db.database.from("memory_facts")
          .update({ is_latest: false, expires_at: new Date().toISOString() })
          .eq("id", fact.id);
        factsExpired++;
      }
    }

    // Observation pruning: only run when observation log exceeds token threshold
    if (!observations || observations.length === 0) {
      await logDreamCycle(userId, "reflect", 0, 0, 0, 0, factsExpired, Date.now() - start);
      return {
        cycleType: "reflect", messagesProcessed: 0,
        factsCreated: 0, factsUpdated: 0,
        observationsCreated: 0, observationsPruned: factsExpired,
        associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 },
        durationMs: Date.now() - start,
      };
    }

    const totalChars = observations.reduce((sum, o) => sum + (o.content?.length ?? 0), 0);
    const estimatedTokens = Math.ceil(totalChars / 4);

    let pruned = 0;
    if (estimatedTokens >= REFLECT_THRESHOLD_TOKENS) {
      // Apply exponential decay to all observations
      for (const obs of observations) {
        const newDecay = Math.max(OBS_DECAY_FLOOR, (obs.decay_score ?? 1.0) * OBS_DECAY_RATE);
        if (newDecay <= OBS_DECAY_FLOOR + 0.01) {
          // Prune very low-decay info-level observations
          if (obs.priority === "info") {
            await db.database.from("memory_observations").delete().eq("id", obs.id);
            pruned++;
            continue;
          }
        }
        await db.database.from("memory_observations")
          .update({ decay_score: newDecay, last_accessed_at: new Date().toISOString() })
          .eq("id", obs.id);
      }
    }

    await logDreamCycle(userId, "reflect", 0, 0, 0, 0, pruned + factsExpired, Date.now() - start);

    return {
      cycleType: "reflect",
      messagesProcessed: 0,
      factsCreated: 0, factsUpdated: 0,
      observationsCreated: 0, observationsPruned: pruned + factsExpired,
      associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 },
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logDreamCycle(userId, "reflect", 0, 0, 0, 0, 0, Date.now() - start, error);
    return { cycleType: "reflect", messagesProcessed: 0, factsCreated: 0, factsUpdated: 0, observationsCreated: 0, observationsPruned: 0, associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 }, durationMs: Date.now() - start, error };
  }
}

// ── Step 4: Narrator (L4 → L3) ──

export async function narrate(userId: string): Promise<DreamCycleResult | null> {
  const start = Date.now();

  try {
    const sections = ["identity", "work", "preferences", "relationships", "projects", "goals"] as const;
    let rebuilt = 0;

    for (const section of sections) {
      try {
        await rebuildNarrativeSection(userId, section);
        rebuilt++;
      } catch {
        // skip individual section failures
      }
    }

    await logDreamCycle(userId, "narrate", 0, 0, 0, 0, 0, Date.now() - start);

    return {
      cycleType: "narrate",
      messagesProcessed: 0,
      factsCreated: 0, factsUpdated: 0,
      observationsCreated: rebuilt, observationsPruned: 0,
      associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 },
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logDreamCycle(userId, "narrate", 0, 0, 0, 0, 0, Date.now() - start, error);
    return { cycleType: "narrate", messagesProcessed: 0, factsCreated: 0, factsUpdated: 0, observationsCreated: 0, observationsPruned: 0, associationsCreated: 0, reconsolidated: { strengthened: 0, weakened: 0 }, durationMs: Date.now() - start, error };
  }
}

// ── Helpers ──

async function fetchUnprocessedBuffer(userId: string): Promise<BufferMessage[]> {
  const db = createAdminClient();
  const { data } = await db.database.from("memory_buffer")
    .select("*")
    .eq("user_id", userId)
    .eq("processed", false)
    .order("created_at", { ascending: true })
    .limit(50);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    userId: row.user_id as string,
    threadId: row.thread_id as string,
    role: row.role as "user" | "assistant",
    content: row.content as string,
    createdAt: row.created_at as string,
  }));
}

async function markBufferProcessed(userId: string): Promise<void> {
  const db = createAdminClient();
  await db.database.from("memory_buffer")
    .update({ processed: true })
    .eq("user_id", userId)
    .eq("processed", false);
}

// ── LLM-powered compression ──

const ObservationSchema = z.object({
  observations: z.array(z.object({
    priority: z.enum(["critical", "important", "info"]),
    content: z.string().describe("Concise observation, 1-2 sentences, self-contained"),
    referencedDate: z.string().optional().describe("ISO date if the event happened on a different day"),
  })),
});

async function compressToObservations(transcript: string): Promise<z.infer<typeof ObservationSchema>["observations"]> {
  const prompt = `You are an observation compressor for a personal AI memory system. Analyze this conversation and extract timestamped observations.

Rules:
- 🔴 critical: Identity-defining info (name, location, job, family). Never decays.
- 🟡 important: Preferences, goals, projects, skills. Decays slowly.
- 🟢 info: Context, mood, minor details. Decays normally.
- Each observation must be 1-2 self-contained sentences.
- Include referencedDate (ISO) only if the event happened on a different day than today.
- Extract only what is explicitly stated or strongly implied.
- If nothing meaningful, return empty array.

Conversation:
${transcript.slice(0, 8000)}`;

  try {
    const { object } = await generateObject({
      model: getFastModel(),
      schema: ObservationSchema,
      prompt,
      maxOutputTokens: 2048,
    });
    return object.observations;
  } catch {
    return [];
  }
}

const BatchFactSchema = z.object({
  facts: z.array(z.object({
    category: z.enum(["personal", "professional", "technical", "preference", "behavioral", "goal", "outcome"]),
    fact: z.string().describe("1 sentence, self-contained fact"),
    confidence: z.number().min(0).max(1),
    importance: z.number().min(0).max(1),
    memoryType: z.enum(["fact", "preference", "episode"]),
    eventTime: z.string().optional().describe("ISO datetime if the fact refers to a specific past event (e.g. 'worked at Google in 2023')"),
  })),
});

async function extractFactsFromTranscript(transcript: string): Promise<z.infer<typeof BatchFactSchema>["facts"]> {
  const today = new Date().toISOString().split("T")[0];
  const prompt = `You are a fact extraction engine. Extract high-value facts about the user from this conversation.

Rules:
- Extract ONLY meaningful, reusable facts — preferences, skills, relationships, goals.
- Each fact: 1 concise, self-contained sentence.
- Assign confidence (0.0-1.0) and importance (0.0-1.0).
  - If the AI assistant in the conversation expressed doubt or pushed back on a claim, assign very low confidence (≤0.2).
  - If a claim contradicts multiple established facts in the same conversation, assign low confidence (≤0.3).
  - If a claim seems implausible or like a joke (e.g. "I'm Elon Musk"), assign very low confidence (≤0.15).
- Categories: personal, professional, technical, preference, behavioral, goal, outcome.
- memoryType: fact (stable), preference (strengthens with repetition), episode (time-bound).
- If a fact refers to a specific past time period (e.g. "worked at X in 2022"), set eventTime to an ISO date string.
- If nothing meaningful, return empty array.

SARCASM & IRONY DETECTION:
- Watch for exaggerated enthusiasm, ALL CAPS emphasis, or obvious irony (e.g. "Oh GREAT, another CSS bug at 3am, my FAVORITE thing").
- If a statement is clearly sarcastic, do NOT extract it as a genuine preference or fact.
- If uncertain whether sarcastic, assign confidence ≤0.3.

HYPOTHETICAL & CONDITIONAL:
- Statements like "If I were to...", "Maybe someday...", "I'm thinking about..." are NOT confirmed facts.
- Either skip them or extract with confidence ≤0.3 and category "goal".

TEMPORAL REFERENCE RESOLUTION:
- Today is ${today}. Resolve relative references:
  - "last week" → approximate ISO date (7 days ago)
  - "yesterday" → ${new Date(Date.now() - 86400000).toISOString().split("T")[0]}
  - "last month" → approximate ISO date
- Set eventTime for any fact with a temporal reference.

Conversation:
${transcript.slice(0, 8000)}`;

  try {
    const { object } = await generateObject({
      model: getFastModel(),
      schema: BatchFactSchema,
      prompt,
      maxOutputTokens: 2048,
    });
    return object.facts;
  } catch {
    return [];
  }
}

// ── Narrative section rebuild ──

const SECTION_PROMPTS: Record<string, string> = {
  identity: "who the user is — name, location, background, education, personal details",
  work: "the user's job, company, role, career history, professional skills",
  preferences: "what the user likes/dislikes, communication style, work preferences, tools they prefer",
  relationships: "people mentioned, their relationships to the user, important connections",
  projects: "projects the user is working on, has completed, or plans to start",
  goals: "stated objectives, aspirations, plans, things they want to achieve",
};

async function rebuildNarrativeSection(userId: string, section: string): Promise<void> {
  const db = createAdminClient();

  // Get existing narrative for context
  const { data: existing } = await db.database.from("memory_narrative")
    .select("content")
    .eq("user_id", userId)
    .eq("section", section)
    .single();

  // Get relevant facts for this section
  const categoryMap: Record<string, string[]> = {
    identity: ["personal"],
    work: ["professional", "technical"],
    preferences: ["preference", "behavioral"],
    relationships: ["personal"],
    projects: ["professional", "technical", "outcome"],
    goals: ["goal"],
  };

  const categories = categoryMap[section] ?? ["personal"];
  const facts: string[] = [];

  for (const cat of categories) {
    const { data } = await db.database.from("memory_facts")
      .select("fact")
      .eq("user_id", userId)
      .eq("category", cat)
      .eq("is_latest", true)
      .order("importance", { ascending: false })
      .limit(10);

    if (data) {
      for (const row of data) {
        facts.push(row.fact as string);
      }
    }
  }

  if (facts.length === 0 && !existing) return;

  const description = SECTION_PROMPTS[section] ?? section;
  const existingContent = existing?.content ?? "";

  const prompt = `You are a user profile narrator. Update the "${section}" section of the user's biography.

Section describes: ${description}

Existing content (may be empty):
${existingContent || "(none)"}

Recent facts about the user:
${facts.length > 0 ? facts.map((f) => `- ${f}`).join("\n") : "- No new facts"}

Write a concise paragraph (max 100 words) in third person. Merge existing content with new facts. If nothing changed, return the existing content unchanged.`;

  try {
    const { text } = await generateText({
      model: getFastModel(),
      prompt,
      maxOutputTokens: 256,
    });

    await db.database.from("memory_narrative")
      .upsert({
        user_id: userId,
        section,
        content: text.trim(),
        last_updated: new Date().toISOString(),
      }, { onConflict: "user_id,section" });
  } catch {
    // skip failed section
  }
}

// ── Dream Cycle logging ──

async function logDreamCycle(
  userId: string,
  cycleType: string,
  messagesProcessed: number,
  factsCreated: number,
  factsUpdated: number,
  observationsCreated: number,
  observationsPruned: number,
  durationMs: number,
  error?: string,
): Promise<void> {
  const db = createAdminClient();
  await db.database.from("memory_dream_log").insert({
    user_id: userId,
    cycle_type: cycleType,
    messages_processed: messagesProcessed,
    facts_created: factsCreated,
    facts_updated: factsUpdated,
    observations_created: observationsCreated,
    observations_pruned: observationsPruned,
    duration_ms: durationMs,
    error: error ?? null,
  });
}

// ── Buffer write (called from chat route onFinish) ──

export async function writeToBuffer(
  userId: string,
  threadId: string,
  messages: { role: "user" | "assistant"; text: string }[],
): Promise<void> {
  const db = createAdminClient();
  const rows = messages
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({
      user_id: userId,
      thread_id: threadId,
      role: m.role,
      content: m.text,
    }));

  if (rows.length === 0) return;

  // Batch insert
  const { error } = await db.database.from("memory_buffer").insert(rows);
  if (error) {
    console.warn("[dream-cycle] Failed to write buffer:", error.message);
    return;
  }

  // Auto-trigger disabled: with real-time inline extraction handling critical
  // facts immediately, the Dream Cycle is now a 12-hour consolidation pass.
  // It runs via cron only — no eager triggering from buffer writes.
}

// ── Audit Logging (append-only) ──

export async function auditLog(
  userId: string,
  action: string,
  tableName: string,
  recordId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = createAdminClient();
    await db.database.from("memory_audit_log").insert({
      user_id: userId,
      action,
      table_name: tableName,
      record_id: recordId ?? null,
      details: details ?? {},
    });
  } catch {
    // Non-blocking: audit failure should never break the main flow
  }
}
