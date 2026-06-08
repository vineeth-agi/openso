/**
 * Associative Memory Chains — Pattern Completion.
 *
 * Implementation:
 * - Facts are linked via memory_associations (typed, weighted edges)
 * - When facts are retrieved, spread_activation RPC fetches linked facts
 * - Dream Cycle creates associations between co-occurring facts
 */

import { createAdminClient } from "@/lib/insforge/admin";

export type AssociationType =
  | "causal"       // A caused B
  | "temporal"     // A and B happened close in time
  | "spatial"      // A and B share a location context
  | "contextual"   // A and B were mentioned together
  | "extends"      // B extends/details A
  | "contradictory"; // A and B conflict

export interface MemoryAssociation {
  id: string;
  sourceFactId: string;
  targetFactId: string;
  associationType: AssociationType;
  strength: number;
}

export interface ActivatedFact {
  id: string;
  fact: string;
  category: string;
  importance: number;
  associationType: string;
  linkStrength: number;
  hop: number;
}

/**
 * Spread activation from retrieved facts to their neighbors.
 * Calls the spread_activation RPC which does multi-hop graph traversal.
 * Hop 2 results have their strength decayed by 0.5 (handled in SQL).
 * Returns associated facts sorted by link strength.
 */
export async function spreadActivation(
  userId: string,
  seedFactIds: string[],
  options?: { minStrength?: number; maxResults?: number; maxHops?: number },
): Promise<ActivatedFact[]> {
  if (seedFactIds.length === 0) return [];

  const db = createAdminClient();
  const { data, error } = await db.database.rpc("spread_activation", {
    fact_ids: seedFactIds,
    spread_user_id: userId,
    max_hops: options?.maxHops ?? 2,
    min_strength: options?.minStrength ?? 0.3,
    max_results: options?.maxResults ?? 10,
  });

  if (error || !data) return [];

  return data.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    fact: row.fact as string,
    category: row.category as string,
    importance: row.importance as number,
    associationType: row.association_type as string,
    linkStrength: row.link_strength as number,
    hop: row.hop as number,
  }));
}

/**
 * Create an association between two facts.
 * If the association already exists, strengthen it.
 */
async function createAssociation(
  userId: string,
  sourceFactId: string,
  targetFactId: string,
  associationType: AssociationType,
  initialStrength: number = 0.5,
): Promise<MemoryAssociation | null> {
  if (sourceFactId === targetFactId) return null;

  const db = createAdminClient();

  // Try to find existing
  const { data: existing } = await db.database.from("memory_associations")
    .select("id, strength")
    .eq("user_id", userId)
    .eq("source_fact_id", sourceFactId)
    .eq("target_fact_id", targetFactId)
    .eq("association_type", associationType)
    .single();

  if (existing) {
    // Strengthen existing (cap at 1.0)
    const newStrength = Math.min(1.0, existing.strength + 0.1);
    await db.database.from("memory_associations")
      .update({ strength: newStrength })
      .eq("id", existing.id);
    return { id: existing.id, sourceFactId, targetFactId, associationType, strength: newStrength };
  } else {
    // Insert new association
    const strength = Math.min(1.0, initialStrength);
    const { data: row } = await db.database.from("memory_associations")
      .insert({
        user_id: userId,
        source_fact_id: sourceFactId,
        target_fact_id: targetFactId,
        association_type: associationType,
        strength,
      })
      .select("id")
      .single();
    return row ? { id: row.id, sourceFactId, targetFactId, associationType, strength } : null;
  }
}

/**
 * Create associations between a batch of co-occurring facts.
 * Facts extracted from the same conversation buffer are contextually linked.
 * Facts in the same category get stronger links.
 */
export async function associateCoOccurringFacts(
  userId: string,
  factIds: string[],
  factCategories: Map<string, string>,
): Promise<number> {
  if (factIds.length < 2) return 0;
  let created = 0;

  // Link each pair (limited to avoid O(n²) explosion for large batches)
  const maxPairs = Math.min(factIds.length, 8);
  for (let i = 0; i < maxPairs; i++) {
    for (let j = i + 1; j < maxPairs; j++) {
      const catA = factCategories.get(factIds[i]);
      const catB = factCategories.get(factIds[j]);
      // Same-category pairs get stronger contextual links
      const strength = catA === catB ? 0.6 : 0.4;

      try {
        await createAssociation(
          userId,
          factIds[i],
          factIds[j],
          "contextual",
          strength,
        );
        created++;
      } catch {
        // skip constraint violations
      }
    }
  }

  return created;
}
