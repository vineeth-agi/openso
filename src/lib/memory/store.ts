import { embed, embedBatchDirect, getEmbeddingModelId } from "./embeddings";
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
 * Safe batch embedding wrapper with chunked fallback.
 * Attempts to embed everything in a single Voyage AI API call.
 * If that fails, it falls back to smaller chunks of 5, and finally individual calls.
 */
async function embedFactsBatchSafe(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  try {
    return await embedBatchDirect(texts);
  } catch (error) {
    console.warn("[memory] embedBatchDirect failed, falling back to chunked embedding:", error);
    const CHUNK_SIZE = 5;
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
      const chunk = texts.slice(i, i + CHUNK_SIZE);
      try {
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const chunkEmbeddings = await embedBatchDirect(chunk);
        results.push(...chunkEmbeddings);
      } catch (chunkErr) {
        console.warn(`[memory] chunk embedding failed for chunk starting at ${i}, trying individually:`, chunkErr);
        for (const text of chunk) {
          const single = await embed(text);
          results.push(single);
        }
      }
    }
    return results;
  }
}

/**
 * Safely parses vector representation from Database (handles both array and string representation).
 */
function parseEmbedding(val: any): number[] {
  if (Array.isArray(val)) {
    return val;
  }
  if (typeof val === "string") {
    try {
      const cleaned = val.replace(/[\[\]]/g, "").trim();
      if (!cleaned) return [];
      return cleaned.split(",").map((num) => parseFloat(num.trim()));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Calculates cosine similarity between two vectors.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i]!;
    const b = vecB[i]!;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Add a batch of facts to memory with in-memory deduplication and contradiction resolution.
 * Extremely optimized to prevent Vercel timeouts (60s).
 */
export async function addFactsBatch(
  userId: string,
  extractedFacts: ExtractedFact[],
  source: string,
  sourceId?: string,
): Promise<{ addedCount: number; actionCounts: { inserted: number; updated: number; skipped: number } }> {
  const db = createAdminClient();

  // 1. In-memory duplicate removal within the input batch itself
  const uniqueExtractedFacts: ExtractedFact[] = [];
  const seenFacts = new Set<string>();
  for (const ef of extractedFacts) {
    const norm = ef.fact.trim().toLowerCase();
    if (!seenFacts.has(norm)) {
      seenFacts.add(norm);
      uniqueExtractedFacts.push(ef);
    }
  }

  const duplicatesInBatch = extractedFacts.length - uniqueExtractedFacts.length;

  if (uniqueExtractedFacts.length === 0) {
    return {
      addedCount: 0,
      actionCounts: { inserted: 0, updated: 0, skipped: duplicatesInBatch },
    };
  }

  // 2. Fetch all existing active facts for this user in 1 call
  let existingFacts: any[] = [];
  try {
    const { data, error } = await db.database.from("memory_facts")
      .select("id, fact, embedding, confidence")
      .eq("user_id", userId)
      .eq("is_latest", true);

    if (error) {
      console.warn("[memory] Failed to fetch existing facts for batch similarity, proceeding with empty array:", error.message);
    } else {
      existingFacts = data ?? [];
    }
  } catch (err) {
    console.warn("[memory] Failed to fetch existing facts for batch similarity, proceeding with empty array:", err);
  }

  // 3. Batch embed the new unique facts in 1 call (with chunked fallback)
  const texts = uniqueExtractedFacts.map((f) => f.fact);
  const embeddings = await embedFactsBatchSafe(texts);

  if (embeddings.length !== uniqueExtractedFacts.length) {
    throw new Error(`Embedding count mismatch: expected ${uniqueExtractedFacts.length}, got ${embeddings.length}`);
  }

  // 4. In-memory similarity matching
  const similarityMatches: {
    newFactIndex: number;
    topMatch: any;
    similarity: number;
  }[] = [];

  for (let i = 0; i < uniqueExtractedFacts.length; i++) {
    const newEmbed = embeddings[i]!;
    let topMatch: any = null;
    let topSimilarity = -1;

    for (const existing of existingFacts) {
      const existingEmbed = parseEmbedding(existing.embedding);
      if (existingEmbed.length === 0) continue;

      const sim = cosineSimilarity(newEmbed, existingEmbed);
      if (sim > topSimilarity) {
        topSimilarity = sim;
        topMatch = existing;
      }
    }

    if (topMatch && topSimilarity >= UPDATE_CANDIDATE_THRESHOLD) {
      similarityMatches.push({
        newFactIndex: i,
        topMatch,
        similarity: topSimilarity,
      });
    }
  }

  // Categorize facts
  interface ClassificationTask {
    newFactIndex: number;
    newFact: ExtractedFact;
    topMatch: any;
  }

  const classificationTasks: ClassificationTask[] = [];
  const directInsertIndexes: number[] = [];
  let skippedCount = duplicatesInBatch;

  for (let i = 0; i < uniqueExtractedFacts.length; i++) {
    const match = similarityMatches.find((m) => m.newFactIndex === i);
    if (!match) {
      directInsertIndexes.push(i);
    } else if (match.similarity >= DUPLICATE_THRESHOLD) {
      skippedCount++;
    } else {
      classificationTasks.push({
        newFactIndex: i,
        newFact: uniqueExtractedFacts[i]!,
        topMatch: match.topMatch,
      });
    }
  }

  // 5. Run LLM classifications in parallel for candidate overlaps
  const updateTasks: {
    newFactIndex: number;
    newFact: ExtractedFact;
    oldFactId: string;
    oldConfidence: number;
  }[] = [];

  if (classificationTasks.length > 0) {
    const classificationResults = await Promise.allSettled(
      classificationTasks.map(async (task) => {
        const relationship = await classifyFactRelationship(
          task.newFact.fact,
          task.topMatch.fact,
          task.newFact.eventTime,
        );
        return { task, relationship };
      })
    );

    for (let idx = 0; idx < classificationResults.length; idx++) {
      const res = classificationResults[idx]!;
      const task = classificationTasks[idx]!;
      if (res.status === "fulfilled") {
        const { relationship } = res.value;
        if (relationship === "duplicate") {
          skippedCount++;
        } else if (relationship === "update") {
          updateTasks.push({
            newFactIndex: task.newFactIndex,
            newFact: task.newFact,
            oldFactId: task.topMatch.id,
            oldConfidence: task.topMatch.confidence ?? 0,
          });
        } else {
          directInsertIndexes.push(task.newFactIndex);
        }
      } else {
        console.warn(`[memory] Relationship classification failed for: ${task.newFact.fact}. Defaulting to insert as new.`, res.reason);
        directInsertIndexes.push(task.newFactIndex);
      }
    }
  }

  // 6. Prepare list of facts to insert
  const factsToInsert: {
    index: number;
    record: any;
    updateInfo?: {
      oldFactId: string;
      shouldSupersede: boolean;
    };
  }[] = [];

  for (const idx of directInsertIndexes) {
    const extracted = uniqueExtractedFacts[idx]!;
    const factEmbedding = embeddings[idx]!;

    const emotionalIntensity = extracted.emotionalIntensity ?? 0;
    const importanceBoost = computeEmotionalImportanceBoost(emotionalIntensity);
    const halfLife = computeInitialHalfLife(
      extracted.category, extracted.memoryType, extracted.importance, emotionalIntensity,
    );

    factsToInsert.push({
      index: idx,
      record: {
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
      },
    });
  }

  for (const ut of updateTasks) {
    const extracted = ut.newFact;
    const factEmbedding = embeddings[ut.newFactIndex]!;

    const emotionalIntensity = extracted.emotionalIntensity ?? 0;
    const importanceBoost = computeEmotionalImportanceBoost(emotionalIntensity);
    const halfLife = computeInitialHalfLife(
      extracted.category, extracted.memoryType, extracted.importance, emotionalIntensity,
    );

    const shouldSupersede = extracted.confidence >= ut.oldConfidence - 0.15;

    factsToInsert.push({
      index: ut.newFactIndex,
      record: {
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
      },
      updateInfo: {
        oldFactId: ut.oldFactId,
        shouldSupersede,
      },
    });
  }

  // 7. Write to database (with robust single-insert fallback)
  let insertedRows: any[] = [];
  let insertedCount = 0;
  let updatedCount = 0;

  if (factsToInsert.length > 0) {
    const recordsToInsert = factsToInsert.map((x) => x.record);
    try {
      const { data, error } = await db.database.from("memory_facts")
        .insert(recordsToInsert)
        .select("id, fact");

      if (error) {
        throw error;
      }
      insertedRows = data ?? [];
      insertedCount = insertedRows.length;
    } catch (bulkErr) {
      console.warn("[memory] Bulk database insert failed, falling back to individual inserts:", bulkErr);
      // Fallback: Individual inserts
      for (const item of factsToInsert) {
        try {
          const { data: singleData, error: singleError } = await db.database.from("memory_facts")
            .insert(item.record)
            .select("id, fact")
            .single();

          if (singleError) throw singleError;
          if (singleData) {
            insertedRows.push(singleData);
            insertedCount++;

            if (item.updateInfo?.shouldSupersede) {
              const { error: updErr } = await db.database.from("memory_facts")
                .update({
                  is_latest: false,
                  superseded_by: singleData.id,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", item.updateInfo.oldFactId);
              
              if (!updErr) {
                updatedCount++;
              } else {
                console.error("[memory] Failed to update superseded fact in individual fallback:", updErr.message);
              }
            }
          }
        } catch (indErr) {
          console.error(`[memory] Individual insert failed for fact "${item.record.fact}":`, indErr);
        }
      }
    }

    // If bulk insert succeeded, apply updates
    if (insertedRows.length === recordsToInsert.length && bulkUpdateNeeded(factsToInsert)) {
      const updatePromises: Promise<void>[] = [];
      for (const item of factsToInsert) {
        const insertedRow = insertedRows.find((r) => r.fact === item.record.fact);
        if (insertedRow && item.updateInfo?.shouldSupersede) {
          const oldFactId = item.updateInfo.oldFactId;
          updatePromises.push(
            (async () => {
              try {
                const { error } = await db.database.from("memory_facts")
                  .update({
                    is_latest: false,
                    superseded_by: insertedRow.id,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", oldFactId);
                if (!error) {
                  updatedCount++;
                } else {
                  console.error("[memory] Failed to update superseded fact:", error.message);
                }
              } catch (err) {
                console.error("[memory] Exception updating superseded fact:", err);
              }
            })()
          );
        }
      }

      if (updatePromises.length > 0) {
        await Promise.allSettled(updatePromises);
      }
    }
  }

  return {
    addedCount: insertedCount,
    actionCounts: {
      inserted: insertedCount - updatedCount,
      updated: updatedCount,
      skipped: skippedCount,
    },
  };
}

function bulkUpdateNeeded(items: any[]): boolean {
  return items.some((item) => item.updateInfo?.shouldSupersede);
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
