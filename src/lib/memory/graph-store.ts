import { embed } from "./embeddings";
import type { ExtractedEntity, ExtractedRelationship, GraphExtraction } from "./graph-extractor";

import { createAdminClient } from "@/lib/insforge/admin";

export interface MemoryEntity {
  id: string;
  userId: string;
  name: string;
  entityType: string;
  description: string | null;
  attributes: Record<string, unknown>;
  mentionCount: number;
  lastMentionedAt: string;
  createdAt: string;
}

export interface MemoryRelationship {
  id: string;
  sourceEntityId: string;
  sourceName: string;
  sourceType: string;
  targetEntityId: string;
  targetName: string;
  targetType: string;
  relationshipType: string;
  strength: number;
}

const MAX_GRAPH_ENTITIES_PER_WRITE = Number(
  process.env.MEMORY_GRAPH_MAX_ENTITIES_PER_WRITE ?? "8",
);
const MAX_GRAPH_RELATIONSHIPS_PER_WRITE = Number(
  process.env.MEMORY_GRAPH_MAX_RELATIONSHIPS_PER_WRITE ?? "16",
);

function normalizeEntityKey(name: string, entityType: string): string {
  return `${name.trim().toLowerCase()}|${entityType.trim().toLowerCase()}`;
}

function normalizeRelationshipKey(rel: ExtractedRelationship): string {
  return [
    rel.sourceEntity.trim().toLowerCase(),
    rel.sourceType.trim().toLowerCase(),
    rel.relationshipType.trim().toLowerCase(),
    rel.targetEntity.trim().toLowerCase(),
    rel.targetType.trim().toLowerCase(),
  ].join("|");
}

function isEmbeddingQuotaError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? "");
  const status = (error as { status?: number; statusCode?: number })?.statusCode
    ?? (error as { status?: number; statusCode?: number })?.status;

  if (status === 429) {
    return true;
  }

  return /RESOURCE_EXHAUSTED|Quota exceeded|online_prediction_requests_per_base_model/i.test(message);
}

/**
 * Upsert entities and relationships into the graph tables.
 * Handles dedup: if an entity exists (same user+name+type), bump mention_count.
 * If a relationship exists, bump strength.
 *
 * Inspired by mem0's `_add_to_graph()` — processes entity/relationship pairs
 * from the graph extractor and stores them on InsForge Postgres.
 */
export async function addToGraph(
  userId: string,
  extraction: GraphExtraction,
  conversationId?: string,
  sourceFactId?: string,
): Promise<{ entitiesAdded: number; relationshipsAdded: number }> {
  if (extraction.entities.length === 0 && extraction.relationships.length === 0) {
    return { entitiesAdded: 0, relationshipsAdded: 0 };
  }

  const uniqueEntities = Array.from(
    new Map(
      extraction.entities.map((entity) => [
        normalizeEntityKey(entity.name, entity.entityType),
        entity,
      ]),
    ).values(),
  ).slice(0, MAX_GRAPH_ENTITIES_PER_WRITE);

  const uniqueRelationships = Array.from(
    new Map(
      extraction.relationships.map((relationship) => [
        normalizeRelationshipKey(relationship),
        relationship,
      ]),
    ).values(),
  ).slice(0, MAX_GRAPH_RELATIONSHIPS_PER_WRITE);

  const db = createAdminClient();
  let entitiesAdded = 0;
  let relationshipsAdded = 0;
  let embeddingQuotaExceeded = false;
  let loggedEmbeddingQuotaWarning = false;

  const markEmbeddingQuotaExceeded = () => {
    embeddingQuotaExceeded = true;
    if (!loggedEmbeddingQuotaWarning) {
      console.warn(
        "[graph-store] Embedding quota exceeded; skipping additional graph entity embeddings for this write.",
      );
      loggedEmbeddingQuotaWarning = true;
    }
  };

  // Step 1: Upsert all entities
  const entityIdMap: Record<string, string> = {}; // "name|type" → entity UUID

  for (const entity of uniqueEntities) {
    if (embeddingQuotaExceeded) {
      break;
    }

    try {
      const entityId = await upsertEntity(db, userId, entity);
      if (entityId) {
        entityIdMap[normalizeEntityKey(entity.name, entity.entityType)] = entityId;
        entitiesAdded++;
      }
    } catch (error) {
      if (isEmbeddingQuotaError(error)) {
        markEmbeddingQuotaExceeded();
        break;
      }

      console.warn("[graph-store] Failed to upsert entity:", entity.name, error);
    }
  }

  // Step 2: Ensure relationship source/target entities exist before inserting edges
  for (const rel of uniqueRelationships) {
    const sourceKey = normalizeEntityKey(rel.sourceEntity, rel.sourceType);
    const targetKey = normalizeEntityKey(rel.targetEntity, rel.targetType);

    // Create entities if they were only mentioned in relationships, not in entities array
    if (!entityIdMap[sourceKey] && !embeddingQuotaExceeded) {
      try {
        const entityId = await upsertEntity(db, userId, {
          name: rel.sourceEntity,
          entityType: rel.sourceType as ExtractedEntity["entityType"],
        });
        if (entityId) entityIdMap[sourceKey] = entityId;
      } catch (error) {
        if (isEmbeddingQuotaError(error)) {
          markEmbeddingQuotaExceeded();
        } else {
          console.warn("[graph-store] Failed to upsert source entity:", rel.sourceEntity, error);
        }
      }
    }

    if (!entityIdMap[targetKey] && !embeddingQuotaExceeded) {
      try {
        const entityId = await upsertEntity(db, userId, {
          name: rel.targetEntity,
          entityType: rel.targetType as ExtractedEntity["entityType"],
        });
        if (entityId) entityIdMap[targetKey] = entityId;
      } catch (error) {
        if (isEmbeddingQuotaError(error)) {
          markEmbeddingQuotaExceeded();
        } else {
          console.warn("[graph-store] Failed to upsert target entity:", rel.targetEntity, error);
        }
      }
    }

    const sourceEntityId = entityIdMap[sourceKey];
    const targetEntityId = entityIdMap[targetKey];

    if (sourceEntityId && targetEntityId && sourceEntityId !== targetEntityId) {
      const added = await upsertRelationship(
        db,
        userId,
        sourceEntityId,
        targetEntityId,
        rel.relationshipType,
        conversationId,
        sourceFactId,
      );
      if (added) relationshipsAdded++;
    }
  }

  return { entitiesAdded, relationshipsAdded };
}

/**
 * Upsert a single entity. If exists, bump mention_count. If new, insert with embedding.
 */
async function upsertEntity(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  entity: ExtractedEntity,
): Promise<string | null> {
  try {
    // Try to find existing entity
    const { data: existing } = await db.database.from("memory_entities")
      .select("id, mention_count")
      .eq("user_id", userId)
      .eq("name", entity.name)
      .eq("entity_type", entity.entityType)
      .single();

    if (existing) {
      // Bump mention count + update description if provided
      const updates: Record<string, unknown> = {
        mention_count: existing.mention_count + 1,
        last_mentioned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (entity.description) {
        updates.description = entity.description;
      }
      if (entity.attributes && Object.keys(entity.attributes).length > 0) {
        updates.attributes = entity.attributes;
      }

      await db.database.from("memory_entities")
        .update(updates)
        .eq("id", existing.id);

      return existing.id;
    }

    // New entity — embed and insert
    const entityEmbedding = await embed(`${entity.entityType}: ${entity.name}${entity.description ? ` - ${entity.description}` : ""}`);

    const { data: inserted } = await db.database.from("memory_entities")
      .insert({
        user_id: userId,
        name: entity.name,
        entity_type: entity.entityType,
        description: entity.description ?? null,
        attributes: entity.attributes ?? {},
        embedding: entityEmbedding,
      })
      .select("id")
      .single();

    return inserted?.id ?? null;
  } catch (error) {
    // Handle unique constraint violation (race condition)
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("duplicate") || errMsg.includes("unique")) {
      const { data: existing } = await db.database.from("memory_entities")
        .select("id")
        .eq("user_id", userId)
        .eq("name", entity.name)
        .eq("entity_type", entity.entityType)
        .single();
      return existing?.id ?? null;
    }

    throw error;
  }
}

/**
 * Upsert a relationship edge. If exists (same source+target+type), bump strength.
 */
async function upsertRelationship(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  sourceEntityId: string,
  targetEntityId: string,
  relationshipType: string,
  conversationId?: string,
  sourceFactId?: string,
): Promise<boolean> {
  try {
    // Check if relationship already exists
    const { data: existing } = await db.database.from("memory_relationships")
      .select("id, strength")
      .eq("user_id", userId)
      .eq("source_entity_id", sourceEntityId)
      .eq("target_entity_id", targetEntityId)
      .eq("relationship_type", relationshipType)
      .single();

    if (existing) {
      // Strengthen existing relationship (cap at 1.0)
      await db.database.from("memory_relationships")
        .update({
          strength: Math.min(1.0, existing.strength + 0.1),
          updated_at: new Date().toISOString(),
          conversation_id: conversationId ?? undefined,
        })
        .eq("id", existing.id);
      return true;
    }

    // Insert new relationship
    await db.database.from("memory_relationships")
      .insert({
        user_id: userId,
        source_entity_id: sourceEntityId,
        target_entity_id: targetEntityId,
        relationship_type: relationshipType,
        strength: 0.5,
        source_fact_id: sourceFactId ?? null,
        conversation_id: conversationId ?? null,
      });

    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("duplicate") || errMsg.includes("unique")) {
      return true; // Already exists
    }
    console.warn("[graph-store] Failed to upsert relationship:", error);
    return false;
  }
}


/**
 * Search entities using a precomputed query embedding.
 */
export async function searchEntitiesByEmbedding(
  userId: string,
  queryEmbedding: number[],
  limit: number = 10,
): Promise<MemoryEntity[]> {
  const db = createAdminClient();

  const { data } = await db.database.rpc("search_memory_entities", {
    query_embedding: queryEmbedding,
    search_user_id: userId,
    match_count: limit,
  });

  if (!data || data.length === 0) return [];

  return data.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: any): MemoryEntity => ({
      id: row.id,
      userId: userId,
      name: row.name,
      entityType: row.entity_type,
      description: row.description,
      attributes: row.attributes ?? {},
      mentionCount: row.mention_count,
      lastMentionedAt: row.last_mentioned_at ?? row.created_at,
      createdAt: row.created_at,
    }),
  );
}

/**
 * Get relationships for a set of entity IDs — builds the local graph context.
 */
export async function getRelationships(
  userId: string,
  entityIds: string[],
): Promise<MemoryRelationship[]> {
  if (entityIds.length === 0) return [];

  const db = createAdminClient();

  const { data } = await db.database.rpc("get_entity_relationships", {
    entity_ids: entityIds,
    search_user_id: userId,
  });

  if (!data || data.length === 0) return [];

  return data.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: any): MemoryRelationship => ({
      id: row.id,
      sourceEntityId: row.source_entity_id,
      sourceName: row.source_name,
      sourceType: row.source_type,
      targetEntityId: row.target_entity_id,
      targetName: row.target_name,
      targetType: row.target_type,
      relationshipType: row.relationship_type,
      strength: row.strength,
    }),
  );
}

/**
 * Get all entities for a user (for the Memory Brain visualization).
 */
export async function getAllEntities(userId: string): Promise<MemoryEntity[]> {
  const db = createAdminClient();

  const { data } = await db.database.from("memory_entities")
    .select("*")
    .eq("user_id", userId)
    .order("mention_count", { ascending: false });

  return (data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: any): MemoryEntity => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      entityType: row.entity_type,
      description: row.description,
      attributes: row.attributes ?? {},
      mentionCount: row.mention_count,
      lastMentionedAt: row.last_mentioned_at,
      createdAt: row.created_at,
    }),
  );
}

/**
 * Get all relationships for a user (for the Memory Brain visualization).
 */
export async function getAllRelationships(userId: string): Promise<MemoryRelationship[]> {
  const db = createAdminClient();

  const { data } = await db.database.from("memory_relationships")
    .select(`
      id,
      source_entity_id,
      target_entity_id,
      relationship_type,
      strength,
      source_entity:memory_entities!memory_relationships_source_entity_id_fkey(name, entity_type),
      target_entity:memory_entities!memory_relationships_target_entity_id_fkey(name, entity_type)
    `)
    .eq("user_id", userId)
    .order("strength", { ascending: false });

  return (data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: any): MemoryRelationship => ({
      id: row.id,
      sourceEntityId: row.source_entity_id,
      sourceName: row.source_entity?.name ?? "Unknown",
      sourceType: row.source_entity?.entity_type ?? "concept",
      targetEntityId: row.target_entity_id,
      targetName: row.target_entity?.name ?? "Unknown",
      targetType: row.target_entity?.entity_type ?? "concept",
      relationshipType: row.relationship_type,
      strength: row.strength,
    }),
  );
}
