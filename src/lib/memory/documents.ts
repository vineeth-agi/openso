import { embed, embedBatch } from "./embeddings";

import { createAdminClient } from "@/lib/insforge/admin";

const CHUNK_SIZE = 1500; // characters per chunk
const CHUNK_OVERLAP = 200;

export interface MemoryDocument {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  similarity?: number;
}

/**
 * Chunk text into overlapping segments for embedding.
 */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Index a document into the knowledge RAG layer.
 * Splits content into chunks, embeds each, and stores them.
 * Deletes existing chunks for the same source+sourceId first (re-index).
 */
export async function indexDocument(
  userId: string,
  source: string,
  sourceId: string,
  title: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<number> {
  const db = createAdminClient();

  // Delete existing chunks for this document (re-index)
  await db.database.from("memory_documents")
    .delete()
    .eq("user_id", userId)
    .eq("source", source)
    .eq("source_id", sourceId);

  const chunks = chunkText(content);
  if (chunks.length === 0) return 0;

  const embeddings = await embedBatch(chunks);

  const rows = chunks.map((chunk, i) => ({
    user_id: userId,
    source,
    source_id: sourceId,
    title,
    content: chunk,
    chunk_index: i,
    embedding: embeddings[i],
    metadata: metadata ?? {},
  }));

  const { data } = await db.database.from("memory_documents")
    .insert(rows)
    .select("id");

  return data?.length ?? 0;
}

/**
 * Search knowledge documents by semantic similarity.
 */
export async function searchDocuments(
  userId: string,
  query: string,
  source?: string,
  limit: number = 3,
): Promise<MemoryDocument[]> {
  const queryEmbedding = await embed(query);

  return searchDocumentsByEmbedding(userId, queryEmbedding, source, limit);
}

/**
 * Search knowledge documents by semantic similarity using a precomputed embedding.
 */
export async function searchDocumentsByEmbedding(
  userId: string,
  queryEmbedding: number[],
  source?: string,
  limit: number = 3,
): Promise<MemoryDocument[]> {
  const db = createAdminClient();

  const { data } = await db.database.rpc("search_memory_documents", {
    query_embedding: queryEmbedding,
    search_user_id: userId,
    filter_source: source ?? null,
    match_count: limit,
  });

  if (!data || data.length === 0) return [];

  return data.map(mapDocRow);
}


/**
 * Get all indexed documents for a user (metadata only, no content).
 */
export async function listDocuments(
  userId: string,
  source?: string,
): Promise<{ source: string; sourceId: string; title: string; chunkCount: number }[]> {
  const db = createAdminClient();

  let query = db.database.from("memory_documents")
    .select("source, source_id, title, chunk_index")
    .eq("user_id", userId)
    .order("indexed_at", { ascending: false });

  if (source) {
    query = query.eq("source", source);
  }

  const { data } = await query;
  if (!data) return [];

  // Group by source+source_id to get chunk counts
  const groups = new Map<string, { source: string; sourceId: string; title: string; count: number }>();
  for (const row of data) {
    const key = `${row.source}::${row.source_id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, { source: row.source, sourceId: row.source_id, title: row.title, count: 1 });
    }
  }

  return Array.from(groups.values()).map((g) => ({
    source: g.source,
    sourceId: g.sourceId,
    title: g.title,
    chunkCount: g.count,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocRow(row: any): MemoryDocument {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    title: row.title,
    content: row.content,
    chunkIndex: row.chunk_index,
    metadata: row.metadata ?? {},
    similarity: row.similarity,
  };
}
