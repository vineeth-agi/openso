import { embed, getEmbeddingModelId } from "./embeddings";
import { computeEmotionalImportanceBoost } from "./emotional";
import { classifyFactRelationship, type ExtractedFact } from "./extractor";
import { computeInitialHalfLife } from "./forgetting";

import { createAdminClient } from "@/lib/insforge/admin";

export interface MemoryFact {
  id: string;
  userId: string;
  category: string;
  fact: string;
  source: string;
  sourceId: string | null;
  memoryType: string;
  confidence: number;
  importance: number;
  accessCount: number;
  isLatest: boolean;
  supersededBy: string | null;
  expiresAt: string | null;
  eventTime: string | null;
  validUntil: string | null;
  halfLifeDays: number;
  retrievalCount: number;
  lastRetrievedAt: string | null;
  emotionalValence: "positive" | "negative" | "neutral" | null;
  emotionalIntensity: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const DUPLICATE_THRESHOLD = 0.90;
const UPDATE_CANDIDATE_THRESHOLD = 0.70;

/**
 * Add a fact to memory with deduplication and contradiction resolution.
 * 1. Embed the new fact
 * 2. Search for similar existing facts (pgvector cosine)
 * 3. If cosine >= 0.90: duplicate → skip
 * 4. If cosine 0.70-0.90: potential update → LLM classifies relationship
 * 5. Otherwise: insert as new fact
 */
export async function addFact(
  userId: string,
  extracted: ExtractedFact,
  source: string,
  sourceId?: string,
): Promise<{ action: "inserted" | "updated" | "skipped"; factId?: string }> {
  const db = createAdminClient();
  const factEmbedding = await embed(extracted.fact);

  // Search for similar existing facts using pgvector
  const { data: similar } = await db.database.rpc("match_memory_facts", {
    query_embedding: factEmbedding,
    match_user_id: userId,
    match_threshold: UPDATE_CANDIDATE_THRESHOLD,
    match_count: 5,
  });

  if (similar && similar.length > 0) {
    const topMatch = similar[0];

    // High similarity = duplicate
    if (topMatch.similarity >= DUPLICATE_THRESHOLD) {
      return { action: "skipped" };
    }

    // Medium similarity = potential update/extend — pass eventTime for temporal awareness
    const relationship = await classifyFactRelationship(
      extracted.fact,
      topMatch.fact,
      extracted.eventTime,
    );

    if (relationship === "duplicate") {
      return { action: "skipped" };
    }

    if (relationship === "update") {
      const emotionalIntensity = extracted.emotionalIntensity ?? 0;
      const importanceBoost = computeEmotionalImportanceBoost(emotionalIntensity);
      const halfLife = computeInitialHalfLife(
        extracted.category, extracted.memoryType, extracted.importance, emotionalIntensity,
      );

      // Confidence guard: only supersede if new fact is credible relative to old.
      // - Exact match or higher: always supersede
      // - Within 0.15: allow (genuine corrections, e.g. 0.85 replacing 0.95)
      // - More than 0.15 below: block (poisoning, e.g. 0.12 replacing 0.95)
      const oldConfidence = topMatch.confidence ?? 0;
      const shouldSupersede = extracted.confidence >= oldConfidence - 0.15;

      const { data: newFact } = await db.database.from("memory_facts")
        .insert({
          user_id: userId,
          category: extracted.category,
          fact: extracted.fact,
          source,
          source_id: sourceId ?? null,
          memory_type: extracted.memoryType,
          confidence: extracted.confidence,
          importance: Math.min(1.0, extracted.importance + importanceBoost),
          embedding: factEmbedding,
          embedding_model: getEmbeddingModelId(),
          is_latest: true,
          event_time: extracted.eventTime ?? null,
          valid_until: extracted.validUntil ?? null,
          half_life_days: halfLife,
          emotional_valence: extracted.emotionalValence ?? null,
          emotional_intensity: emotionalIntensity,
        })
        .select("id")
        .single();

      if (newFact && shouldSupersede) {
        // New fact is credible enough to replace the old one
        await db.database.from("memory_facts")
          .update({
            is_latest: false,
            superseded_by: newFact.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", topMatch.id);
        return { action: "updated", factId: newFact?.id };
      }

      // Low-confidence contradiction: insert as competing fact, old fact stays active.
      // Both are is_latest=true; the SQL hybrid_score naturally ranks the
      // high-confidence original above this low-confidence challenger.
      return { action: "inserted", factId: newFact?.id };
    }

    // "temporal-coexist": both facts are true at different times — insert new, keep old
    // "extend" or "unrelated" → insert as new fact
  }

  // Insert new fact with brain-inspired fields
  const emotionalIntensity = extracted.emotionalIntensity ?? 0;
  const importanceBoost = computeEmotionalImportanceBoost(emotionalIntensity);
  const halfLife = computeInitialHalfLife(
    extracted.category, extracted.memoryType, extracted.importance, emotionalIntensity,
  );

  const { data: inserted } = await db.database.from("memory_facts")
    .insert({
      user_id: userId,
      category: extracted.category,
      fact: extracted.fact,
      source,
      source_id: sourceId ?? null,
      memory_type: extracted.memoryType,
      confidence: extracted.confidence,
      importance: Math.min(1.0, extracted.importance + importanceBoost),
      embedding: factEmbedding,
      embedding_model: getEmbeddingModelId(),
      is_latest: true,
      event_time: extracted.eventTime ?? null,
      valid_until: extracted.validUntil ?? null,
      half_life_days: halfLife,
      emotional_valence: extracted.emotionalValence ?? null,
      emotional_intensity: emotionalIntensity,
    })
    .select("id")
    .single();

  return { action: "inserted", factId: inserted?.id };
}

/**
 * Hybrid search: semantic similarity + recency + importance.
 * Returns top-k facts most relevant to the current query.
 */
export async function searchFacts(
  userId: string,
  query: string,
  limit: number = 5,
): Promise<MemoryFact[]> {
  const queryEmbedding = await embed(query);

  return searchFactsByEmbedding(userId, queryEmbedding, limit);
}

/**
 * Search facts using a precomputed query embedding.
 */
export async function searchFactsByEmbedding(
  userId: string,
  queryEmbedding: number[],
  limit: number = 5,
): Promise<MemoryFact[]> {
  const db = createAdminClient();

  const { data } = await db.database.rpc("search_memory_facts", {
    query_embedding: queryEmbedding,
    search_user_id: userId,
    match_count: limit,
  });

  if (!data || data.length === 0) return [];

  // Update access counts for retrieved facts
  const factIds = data.map((f: { id: string }) => f.id);
  await updateAccessCount(factIds);

  return data.map(mapFactRow);
}

/**
 * Get all latest facts for a user, optionally filtered by category.
 */
export async function getFactsByCategory(
  userId: string,
  category?: string,
): Promise<MemoryFact[]> {
  const db = createAdminClient();

  let query = db.database.from("memory_facts")
    .select("*")
    .eq("user_id", userId)
    .eq("is_latest", true)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false });

  if (category) {
    query = query.eq("category", category);
  }

  const { data } = await query;
  return (data ?? []).map(mapFactRow);
}

/**
 * Get all facts for a user (including superseded), for the memory brain UI.
 */
export async function getAllFacts(userId: string): Promise<MemoryFact[]> {
  const db = createAdminClient();

  const { data } = await db.database.from("memory_facts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data ?? []).map(mapFactRow);
}

/**
 * Hard-delete a fact (user-initiated from Memory Brain page).
 */
export async function deleteFact(factId: string, userId: string): Promise<boolean> {
  const db = createAdminClient();
  const { error } = await db.database.from("memory_facts")
    .delete()
    .eq("id", factId)
    .eq("user_id", userId);

  return !error;
}

/**
 * Mark expired episodic facts as no longer latest.
 */
export async function expireStaleMemories(): Promise<number> {
  const db = createAdminClient();
  const now = new Date().toISOString();

  // Expire by expires_at (episodic) OR valid_until (temporal facts that have lapsed)
  const [byExpiry, byValidUntil] = await Promise.all([
    db.database.from("memory_facts")
      .update({ is_latest: false, updated_at: now })
      .eq("is_latest", true)
      .not("expires_at", "is", null)
      .lt("expires_at", now)
      .select("id"),
    db.database.from("memory_facts")
      .update({ is_latest: false, updated_at: now })
      .eq("is_latest", true)
      .not("valid_until", "is", null)
      .lt("valid_until", now)
      .select("id"),
  ]);

  return (byExpiry.data?.length ?? 0) + (byValidUntil.data?.length ?? 0);
}

/**
 * Increment access_count + last_accessed_at for retrieved facts.
 */
async function updateAccessCount(factIds: string[]): Promise<void> {
  if (factIds.length === 0) return;
  const db = createAdminClient();

  // Try batch update first (requires batch_increment_fact_access SQL function)
  try {
    const { error } = await db.database.rpc("batch_increment_fact_access", { fact_ids: factIds });
    if (!error) return;
    // If the batch function doesn't exist yet, fall through to individual updates
    console.warn("[memory] batch_increment_fact_access not available, falling back to serial:", error.message);
  } catch {
    // Fall through
  }

  // Fallback: parallel individual updates (still better than serial)
  await Promise.allSettled(
    factIds.map((id) => db.database.rpc("increment_fact_access", { fact_id: id }))
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFactRow(row: any): MemoryFact {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    fact: row.fact,
    source: row.source,
    sourceId: row.source_id,
    memoryType: row.memory_type,
    confidence: row.confidence,
    importance: row.importance,
    accessCount: row.access_count,
    isLatest: row.is_latest,
    supersededBy: row.superseded_by,
    expiresAt: row.expiresAt,
    eventTime: row.event_time ?? null,
    validUntil: row.valid_until ?? null,
    halfLifeDays: row.half_life_days ?? 7,
    retrievalCount: row.retrieval_count ?? 0,
    lastRetrievedAt: row.last_retrieved_at ?? null,
    emotionalValence: row.emotional_valence ?? null,
    emotionalIntensity: row.emotional_intensity ?? 0,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
