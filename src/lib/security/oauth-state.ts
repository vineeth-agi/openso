/**
 * OAuth state nonce store (Finding 5).
 *
 * Replaces the previous "state = user UUID" pattern. The init endpoint
 * generates a cryptographically random nonce, persists `(state -> userId, provider, metadata)`
 * for 10 minutes, and the callback consumes-and-deletes the row to recover
 * the originating userId. An attacker who tricks a victim into authorizing
 * with a forged `state` will fail the consume step because the nonce is
 * unknown to our store.
 *
 * Storage is the `oauth_states` table on InsForge Postgres (RLS-locked,
 * project_admin bypass). See migration `20260522_oauth_states.sql`.
 */
import { randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/insforge/admin";

export type OAuthProvider = "github";

/** Generate a cryptographic nonce, persist it, and return the value. */
export async function issueOAuthState(
  userId: string,
  provider: OAuthProvider,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const db = createAdminClient();
  const { error } = await db.database.from("oauth_states").insert({
    state,
    user_id: userId,
    provider,
    metadata,
  });
  if (error) {
    throw new Error(`Failed to issue OAuth state: ${error.message}`);
  }
  return state;
}

/**
 * Atomically validate-and-consume a state nonce. Returns the originating
 * userId + metadata, or null if the state is unknown / expired / wrong
 * provider. Deletes the row in the same operation.
 */
export async function consumeOAuthState(
  state: string,
  expectedProvider: OAuthProvider,
): Promise<{ userId: string; metadata: Record<string, unknown> } | null> {
  if (!state || typeof state !== "string" || state.length < 16 || state.length > 256) {
    return null;
  }
  const db = createAdminClient();

  // Delete-and-return the row. If `delete().select()` returns no row, the
  // state was invalid / already used / expired.
  const { data, error } = await db.database.from("oauth_states")
    .delete()
    .eq("state", state)
    .select("user_id, provider, metadata, expires_at")
    .maybeSingle();

  if (error || !data) return null;

  // Provider must match.
  if (data.provider !== expectedProvider) return null;

  // Reject expired entries (they should be cleaned up periodically but a
  // race could let an old row through).
  const expiresAt = new Date(data.expires_at as string);
  if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return null;
  }

  return {
    userId: data.user_id as string,
    metadata: (data.metadata as Record<string, unknown>) ?? {},
  };
}
