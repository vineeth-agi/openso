/**
 * Connections — manage user OAuth provider connections stored on InsForge Postgres.
 *
 * Table: `connected_apps`
 *   id, user_id, provider, account_email, account_name, account_avatar,
 *   github_username, access_token, refresh_token, expiry_date,
 *   scope, status, last_connected_at, created_at, updated_at
 *
 * IMPORTANT: Two client modes:
 *   - Session-based (createClient): for browser-initiated requests with cookies (connectors page, OAuth callbacks)
 *   - Admin (createAdminClient): for server-side contexts without cookies (chat route, workflow handlers, telegram webhooks)
 *
 * The `connected_apps` table uses RLS with `auth.uid() = user_id`, so session-based
 * queries only work when a valid InsForge auth session is present. Use admin variants
 * for any server-side code (API routes processing chat, background jobs, webhooks).
 *
 * Token encryption (Finding 22): `access_token` and `refresh_token` columns
 * are wrapped with AES-256-GCM at insert time and decrypted on read. Legacy
 * plaintext rows are detected by the missing `enc:v1:` prefix and returned
 * as-is for backward compatibility; they are re-encrypted on next write.
 */

import { createAdminClient } from "@/lib/insforge/admin";
import { createClient } from "@/lib/insforge/server";
import { assertEncryptedOrNull, decryptToken, encryptToken } from "@/lib/security/token-crypto";

// ── Types ──────────────────────────────────────────
export type Provider = "github" | "gmail";

export interface Connection {
  id: string;
  user_id: string;
  provider: Provider;
  account_email?: string;
  account_name?: string;
  account_avatar?: string;
  github_username?: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  status: "active" | "revoked" | "expired";
  last_connected_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Helpers ──

/** Decrypt token columns on a row read from the DB. */
function decryptConnectionRow<T extends Connection | null>(row: T): T {
  if (!row) return row;
  // Dev-only invariant (DB-HIGH-01): every column we are about to decrypt
  // should already be wrapped with `enc:v1:` before reaching this function.
  // Legacy plaintext rows still pass through (decryptToken returns them
  // as-is), but a non-null plaintext value means somebody added a new
  // write path that skipped encryptToken — surface that in dev.
  assertEncryptedOrNull(row.access_token, "connected_apps.access_token");
  assertEncryptedOrNull(row.refresh_token, "connected_apps.refresh_token");
  return {
    ...row,
    access_token: decryptToken(row.access_token ?? null),
    refresh_token: decryptToken(row.refresh_token ?? null),
  } as T;
}

// ── Session-based queries (for browser requests with cookies) ──

/** Get a single active connection by provider (session-based — browser only). */
export async function getConnection(
  userId: string,
  provider: Provider,
): Promise<Connection | null> {
  const db = await createClient();
  const { data, error } = await db.database.from("connected_apps")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw error;
  return decryptConnectionRow(data as Connection | null);
}


// ── Admin queries (for server-side: chat route, workflow handlers, webhooks) ──

/** Get a single active connection by provider (admin — no session needed). */
export async function getConnectionAdmin(
  userId: string,
  provider: Provider,
): Promise<Connection | null> {
  const db = createAdminClient();
  const { data, error } = await db.database.from("connected_apps")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error(`[connections] getConnectionAdmin error for ${provider}:`, error.message);
    return null;
  }
  return decryptConnectionRow(data as Connection | null);
}

/** Get all active connections for a user (admin — no session needed). */
export async function getAllConnectionsAdmin(userId: string): Promise<Connection[]> {
  const db = createAdminClient();
  const { data, error } = await db.database.from("connected_apps")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) {
    console.error("[connections] getAllConnectionsAdmin error:", error.message);
    return [];
  }
  return ((data ?? []) as Connection[]).map((r) => decryptConnectionRow(r)!);
}

/** Get provider slugs for a user's active connections (admin — no session needed). */
export async function getConnectedSlugsAdmin(userId: string): Promise<string[]> {
  const connections = await getAllConnectionsAdmin(userId);
  return connections.map((c) => c.provider);
}

// ── Write operations (use session-based for browser, admin for server) ──

/**
 * Insert or update a connection. Uses admin client — OAuth callbacks
 * have no reliable session.
 *
 * `last_connected_at` is bumped on every successful write so background
 * ingestion jobs can detect a reconnect-during-run and self-cancel
 * (audit Finding 6.1).
 */
export async function upsertConnection(
  userId: string,
  provider: Provider,
  fields: Partial<Omit<Connection, "id" | "user_id" | "provider" | "created_at" | "updated_at">>,
): Promise<Connection> {
  const db = createAdminClient();

  // Encrypt token columns before persisting (Finding 22).
  const fieldsToInsert: Record<string, unknown> = { ...fields };
  if (Object.prototype.hasOwnProperty.call(fields, "access_token")) {
    fieldsToInsert.access_token = encryptToken(fields.access_token ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "refresh_token")) {
    fieldsToInsert.refresh_token = encryptToken(fields.refresh_token ?? null);
  }

  const nowIso = new Date().toISOString();

  const { data, error } = await db.database.from("connected_apps")
    .upsert(
      {
        user_id: userId,
        provider,
        status: "active",
        ...fieldsToInsert,
        last_connected_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "user_id,provider" },
    )
    .select()
    .single();

  if (error) {
    console.error(`[connections] upsertConnection error for ${provider}:`, error.message);
    throw error;
  }
  // Return decrypted form so callers see the plaintext access token if they
  // need it immediately (matches the previous behavior).
  return decryptConnectionRow(data as Connection)!;
}

/**
 * Update the secret-bearing columns of an existing connection.
 *
 * Used by token-refresh paths (Google OAuth refresh in `gmail.ts` and
 * `tool-router.ts`) where we already have an active row and just need to
 * rotate the access token / expiry. Unlike `upsertConnection`, this:
 *   - Does NOT bump `last_connected_at` (a refresh is not a reconnect —
 *     reconnect-during-run detection in the GitHub ingestion runner relies
 *     on `last_connected_at` only changing on a real OAuth callback).
 *   - Does NOT toggle `status`.
 *   - Matches on `(user_id, provider)` instead of the row id, so the row
 *     filter does not require the caller to pass the previously-fetched
 *     row id (less coupling, safer if multiple rows somehow exist).
 *
 * Encrypts every secret-bearing column via `encryptToken` BEFORE the DB
 * write so callers cannot accidentally persist plaintext (DB-HIGH-01).
 */
export async function refreshConnectionTokens(
  userId: string,
  provider: Provider,
  fields: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    scope?: string | null;
  },
): Promise<void> {
  const db = createAdminClient();

  // Build the patch object explicitly so we do not overwrite columns the
  // caller did not pass (e.g. refresh_token on a routine access-token-only
  // refresh — Google does not always return a fresh refresh_token).
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (Object.prototype.hasOwnProperty.call(fields, "access_token")) {
    patch.access_token = encryptToken(fields.access_token ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "refresh_token")) {
    patch.refresh_token = encryptToken(fields.refresh_token ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "expiry_date")) {
    patch.expiry_date = fields.expiry_date ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(fields, "scope")) {
    patch.scope = fields.scope ?? null;
  }

  const { error } = await db.database.from("connected_apps")
    .update(patch)
    .eq("user_id", userId)
    .eq("provider", provider);

  if (error) {
    console.error(
      `[connections] refreshConnectionTokens error for ${provider}:`,
      error.message,
    );
    throw error;
  }
}

/**
 * Soft-disconnect an app.
 *
 * Order of operations (revised — see audit doc
 * `docs/audit-2026-05-29/04-supabase-and-database.md` for the historical
 * revoke-model migration that was applied to InsForge Postgres):
 *
 *   1. Flip the row to `status='revoked'` and null the secret
 *      columns FIRST. This is the security-critical step
 *      (audit Finding 4.2) and the single source of truth for
 *      "is this app connected?". Doing it first guarantees we
 *      never wipe memory while leaving the row marked active.
 *      If the UPDATE fails, we fall back to DELETE so the UI
 *      cannot continue showing a stale "connected" state.
 *
 *   2. Provider-specific cleanup (cancel in-flight jobs, wipe
 *      memory) is best-effort and runs only after step 1
 *      succeeds. A failure here logs a warning but does not
 *      throw — the connection is already revoked.
 */
export async function disconnectApp(
  userId: string,
  provider: Provider | string,
): Promise<void> {
  const db = createAdminClient();
  const nowIso = new Date().toISOString();

  // Fetch connection first to get the access token for provider-side revocation
  let tokenToRevoke: string | null = null;
  if (provider === "github") {
    try {
      const conn = await getConnectionAdmin(userId, "github");
      if (conn?.access_token) {
        tokenToRevoke = conn.access_token;
      }
    } catch (e) {
      console.warn("[connections] Failed to fetch connection for token revocation:", e);
    }
  }

  // 1. Revoke + null secret columns. Single source of truth.
  const { error: updateErr } = await db.database.from("connected_apps")
    .update({
      status: "revoked",
      access_token: null,
      refresh_token: null,
      expiry_date: null,
      scope: null,
      revoked_at: nowIso,
      updated_at: nowIso,
    })
    .eq("user_id", userId)
    .eq("provider", provider);

  if (updateErr) {
    // Fallback: delete the row so the UI doesn't show a stale
    // "connected" state. This kicks in if the legacy NOT NULL
    // constraint on access_token is still in place (the
    // migration above hasn't been applied yet) or any other
    // constraint regression is introduced.
    console.error(
      `[connections] revoke UPDATE failed for ${provider}, falling back to DELETE:`,
      updateErr,
    );
    const { error: delErr } = await db.database.from("connected_apps")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);
    if (delErr) throw delErr;
  }

  // 2. Provider-specific cleanup — best-effort.
  if (provider === "github") {
    // Mark in-flight ingestion jobs cancelled. `runIngestion`
    // self-aborts on its next checkpoint write.
    try {
      await db.database.from("github_ingestion_jobs")
        .update({ status: "cancelled", last_activity_at: nowIso, updated_at: nowIso })
        .eq("user_id", userId)
        .in("status", [
          "queued",
          "scanning",
          "retrying",
          "rate_limited",
          "continuously_syncing",
        ]);
    } catch (e) {
      console.warn("[connections] Failed to cancel in-flight ingestion jobs:", e);
    }

    // Wipe GitHub memory tables.
    const { deleteGitHubMemory } = await import("@/lib/github-memory");
    await deleteGitHubMemory(userId).catch((e) =>
      console.warn("[connections] Failed to delete GitHub memory:", e),
    );

    // Revoke authorization on GitHub's side (delete grant)
    if (tokenToRevoke) {
      try {
        const clientId = process.env.GITHUB_CLIENT_ID;
        const clientSecret = process.env.GITHUB_CLIENT_SECRET;
        if (clientId && clientSecret) {
          const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
          const res = await fetch(`https://api.github.com/applications/${clientId}/grant`, {
            method: "DELETE",
            headers: {
              Authorization: `Basic ${credentials}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ access_token: tokenToRevoke }),
          });
          if (!res.ok) {
            console.warn(`[connections] GitHub grant deletion returned status ${res.status}:`, await res.text().catch(() => ""));
          } else {
            console.log(`[connections] Successfully deleted GitHub grant for user ${userId}`);
          }
        }
      } catch (e) {
        console.warn("[connections] Failed to delete GitHub application grant:", e);
      }
    }
  }
}
