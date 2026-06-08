/**
 * Ebbinghaus-style Forgetting Curve — decay logic.
 *
 * Formula: strength = e^(-elapsed_days / halfLifeDays) * retrieval_boost
 * retrieval_boost = 1 + 0.1 * ln(retrieval_count + 1)
 *
 * NAMING NOTE: `halfLifeDays` is a misnomer. The formula is `e^(-t/τ)`,
 * a time-constant decay (not a true half-life). At `t = halfLifeDays`,
 * strength ≈ 0.368 (1/e), not 0.5. Behaviour is locked by the calibration
 * tests in `__tests__/forgetting.test.ts` — changing the formula migrates
 * every existing fact's decay, so we keep the misleading name and pin
 * the actual numbers in tests.
 */

import { createAdminClient } from "@/lib/insforge/admin";

export interface MemoryStrengthInput {
  halfLifeDays: number;
  lastRetrievedAt: string | null;
  createdAt: string;
  retrievalCount: number;
  emotionalIntensity: number;
}

/**
 * Compute effective memory strength (0.0 to ~1.3).
 * This mirrors the Ebbinghaus curve: rapid initial drop, then plateau.
 * Retrieval resets the curve (spaced repetition).
 * Emotional memories decay slower (amygdala boost).
 */
function computeMemoryStrength(input: MemoryStrengthInput): number {
  const baseTime = input.lastRetrievedAt
    ? new Date(input.lastRetrievedAt).getTime()
    : new Date(input.createdAt).getTime();

  const elapsedMs = Date.now() - baseTime;
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

  // Use stored halfLifeDays directly — emotional boost is already baked in
  // by computeInitialHalfLife at insertion time (avoids double-multiplier)
  const effectiveHalfLife = Math.max(0.1, input.halfLifeDays);

  // Core Ebbinghaus: strength = e^(-t / half_life)
  const baseStrength = Math.exp(-elapsedDays / effectiveHalfLife);

  // Spaced repetition boost: each retrieval strengthens the trace
  // ln(count+1) gives diminishing returns: 0→0, 1→0.69, 5→1.79, 10→2.4
  const retrievalBoost = 1.0 + 0.1 * Math.log(input.retrievalCount + 1);

  return Math.min(1.3, baseStrength * retrievalBoost);
}

/**
 * Determine the appropriate half-life for a new fact based on its properties.
 * - Identity facts (name, location): very long half-life (like critical observations)
 * - Episodic memories: short half-life unless emotional
 * - Preferences: medium, strengthened by repetition
 */
export function computeInitialHalfLife(
  category: string,
  memoryType: string,
  importance: number,
  emotionalIntensity: number,
): number {
  // Base half-life by category (in days)
  const categoryHalfLife: Record<string, number> = {
    personal: 90,       // identity persists
    professional: 60,   // career info persists
    technical: 30,      // skills can become outdated
    preference: 45,     // strengthened by repetition
    behavioral: 21,     // patterns need reinforcement
    goal: 30,           // goals can shift
    outcome: 14,        // outcomes are time-bound
  };

  let baseHalfLife = categoryHalfLife[category] ?? 30;

  // Memory type modifier
  if (memoryType === "episode") {
    baseHalfLife *= 0.5; // episodes decay faster
  } else if (memoryType === "preference") {
    baseHalfLife *= 1.2; // preferences persist
  }

  // Importance boost: high-importance facts get 2x half-life
  baseHalfLife *= (0.5 + importance);

  // Emotional boost: emotional memories get up to 3x half-life
  baseHalfLife *= (1.0 + emotionalIntensity * 2.0);

  // Cap between 1 day and 365 days
  return Math.max(1, Math.min(365, baseHalfLife));
}

/**
 * Check if a fact has effectively been "forgotten" (strength below threshold).
 */
export function isEffectivelyForgotten(
  input: MemoryStrengthInput,
  threshold: number = 0.05,
): boolean {
  return computeMemoryStrength(input) < threshold;
}


// ── Forgetting Enforcement ──

/**
 * Prune effectively forgotten facts.
 *
 * Calls the SQL function `prune_forgotten_facts` which does the Ebbinghaus
 * math entirely in Postgres — single UPDATE, no per-fact round-trip. This
 * replaces an earlier Node-side loop that loaded every active fact into
 * memory and shipped a giant IN clause back; that doesn't scale past a
 * few thousand facts/user.
 *
 * The SQL implementation mirrors the same conditions as `computeMemoryStrength`
 * + `isEffectivelyForgotten`:
 *   - protects category = 'personal' (identity facts)
 *   - skips importance > 0.8 (high-value facts)
 *   - applies 7-day grace period after retrieval
 *   - prunes when strength < threshold
 *
 * If the SQL function is unavailable (older deployments), falls back to the
 * legacy Node-side implementation so deploys don't break.
 */
export async function pruneEffectivelyForgottenFacts(
  userId: string,
  threshold: number = 0.1,
): Promise<{ pruned: number }> {
  const db = createAdminClient();

  // Fast path: in-DB pruning via SQL function
  const { data: rpcCount, error: rpcError } = await db.database.rpc(
    "prune_forgotten_facts",
    { target_user_id: userId, prune_threshold: threshold },
  );

  if (!rpcError && typeof rpcCount === "number") {
    return { pruned: rpcCount };
  }

  // Fallback path: only used if the migration hasn't run yet.
  // Logged so we notice and apply the migration.
  if (rpcError) {
    console.warn(
      "[forgetting] prune_forgotten_facts RPC unavailable, falling back to client-side prune:",
      rpcError.message,
    );
  }

  return legacyPruneFallback(userId, threshold);
}

/**
 * Legacy client-side prune. Kept only as a safety net for environments
 * that haven't applied the in-DB migration yet. Do not call directly.
 */
async function legacyPruneFallback(
  userId: string,
  threshold: number,
): Promise<{ pruned: number }> {
  const db = createAdminClient();

  const { data: facts } = await db.database.from("memory_facts")
    .select("id, category, half_life_days, retrieval_count, last_retrieved_at, created_at, emotional_intensity, importance")
    .eq("user_id", userId)
    .eq("is_latest", true);

  if (!facts || facts.length === 0) return { pruned: 0 };

  const PROTECTED_CATEGORIES = ["personal"];
  const GRACE_PERIOD_DAYS = 7;
  const now = Date.now();

  const toPrune: string[] = [];

  for (const fact of facts) {
    if (PROTECTED_CATEGORIES.includes(fact.category)) continue;

    if (fact.last_retrieved_at) {
      const daysSinceRetrieval = (now - new Date(fact.last_retrieved_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceRetrieval < GRACE_PERIOD_DAYS) continue;
    }

    if (fact.importance > 0.8) continue;

    const strength = computeMemoryStrength({
      halfLifeDays: fact.half_life_days ?? 30,
      lastRetrievedAt: fact.last_retrieved_at,
      createdAt: fact.created_at,
      retrievalCount: fact.retrieval_count ?? 0,
      emotionalIntensity: fact.emotional_intensity ?? 0,
    });

    if (strength < threshold) {
      toPrune.push(fact.id);
    }
  }

  if (toPrune.length === 0) return { pruned: 0 };

  const { error } = await db.database.from("memory_facts")
    .update({ is_latest: false, updated_at: new Date().toISOString() })
    .in("id", toPrune);

  if (error) {
    console.error("[forgetting] Fallback prune failed:", error.message);
    return { pruned: 0 };
  }

  return { pruned: toPrune.length };
}
