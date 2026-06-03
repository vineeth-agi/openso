/**
 * Chat persistence layer — conversations + messages
 * All DB operations for storing and loading chat history.
 *
 * Pattern: Vercel AI Chatbot (open-source reference schema)
 * - conversations: one row per chat session
 * - messages: one row per turn, parts stored as JSONB (AI SDK UIMessage format)
 */
import type { UIMessage } from "ai";

import { createAdminClient } from "@/lib/insforge/admin";

// ── Retry helper for transient network errors (fetch failed, ECONNRESET, etc.) ──
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 300,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("fetch failed") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) {
        if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, i)));
        continue;
      }
      throw err; // non-retryable error — rethrow immediately
    }
  }
  throw lastError;
}

// ── Types ──

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  chatType: "mail" | "github";
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  parts: UIMessage["parts"];
  createdAt: string;
}

// ── Conversations ──

/**
 * Create a new conversation, or update title/timestamp if it already
 * belongs to the same user.
 *
 * SECURITY: this is the place where we previously had an IDOR — an
 * upsert keyed on `id` alone would let any caller seize a conversation
 * row by re-asserting it with a different `user_id`. The fix is a
 * pre-flight ownership check: if the row already exists and is owned
 * by someone else, throw immediately instead of overwriting it.
 *
 * Behaviour:
 *   - row missing  → INSERT a new row
 *   - row owned by `userId` → UPDATE title + updated_at
 *   - row owned by someone else → throw `ConversationOwnedByAnotherUser`
 */
export class ConversationOwnedByAnotherUser extends Error {
  constructor(id: string) {
    super(`conversation ${id} belongs to a different user`);
    this.name = "ConversationOwnedByAnotherUser";
  }
}

export async function saveConversation(
  id: string,
  userId: string,
  chatType: "mail" | "github" | "telegram",
  title?: string,
): Promise<void> {
  await withRetry(async () => {
    const db = createAdminClient();

    // Pre-flight: verify ownership when the row already exists. We
    // cannot rely on PostgREST upsert alone here — `onConflict: id`
    // with `ignoreDuplicates: false` will happily overwrite the
    // user_id column, which is the IDOR vector we are fixing.
    const { data: existing, error: selErr } = await db.database
      .from("conversations")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();
    if (selErr) {
      throw new Error(`saveConversation lookup failed: ${selErr.message}`);
    }

    if (existing && existing.user_id !== userId) {
      // Another user owns this conversation. Refuse silently rather
      // than overwriting their data.
      throw new ConversationOwnedByAnotherUser(id);
    }

    if (existing) {
      // Same owner — just refresh the title + updated_at without ever
      // touching user_id.
      const { error: updErr } = await db.database
        .from("conversations")
        .update({
          title: title ?? "New Chat",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", userId);
      if (updErr) {
        throw new Error(`saveConversation update failed: ${updErr.message}`);
      }
      return;
    }

    // Net-new row.
    const { error: insErr } = await db.database
      .from("conversations")
      .insert([
        {
          id,
          user_id: userId,
          chat_type: chatType,
          title: title ?? "New Chat",
          updated_at: new Date().toISOString(),
        }
      ]);
    if (insErr) {
      throw new Error(`saveConversation insert failed: ${insErr.message}`);
    }
  });
}

/**
 * Update conversation title (called after first AI response).
 * SECURITY: scoped to (id, user_id) so a caller without ownership
 * can't rewrite someone else's chat title.
 */
export async function updateConversationTitle(
  id: string,
  title: string,
  userId?: string,
): Promise<void> {
  await withRetry(async () => {
    const db = createAdminClient();
    let q = db.database.from("conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (userId) q = q.eq("user_id", userId);
    const { error } = await q;
    if (error) throw new Error(`updateConversationTitle failed: ${error.message}`);
  });
}

/**
 * List conversations for a user, newest first.
 */
export async function getConversations(
  userId: string,
  chatType?: "mail" | "github",
  limit = 50,
): Promise<Conversation[]> {
  const db = createAdminClient();
  let q = db.database.from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (chatType) q = q.eq("chat_type", chatType);

  const { data } = await q;
  return (data ?? []).map(mapConversation);
}

/**
 * Delete a conversation and all its messages (cascade).
 */
export async function deleteConversation(
  id: string,
  userId: string,
): Promise<void> {
  const db = createAdminClient();
  await db.database.from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
}

// ── Messages ──

/**
 * Save a batch of messages for a conversation.
 *
 * Uses upsert by id so it's safe to call multiple times (idempotent).
 *
 * SECURITY: every message in the batch must be confirmed to belong to a
 * conversation owned by `expectedUserId`. Without this guard, an
 * attacker could write to another user's conversation by submitting
 * its UUID. The check is a single round-trip — we look up the
 * conversation row once and assert ownership before writing.
 *
 * ORDERING FIX: PostgreSQL's DEFAULT now() returns the same instant for every
 * row in a single batch INSERT, so messages saved together get identical
 * created_at values and come back in undefined order on reload.
 * We pass an explicit created_at per message — either the message's own
 * createdAt (from the AI SDK) or a 1 ms-apart offset based on array index —
 * to guarantee stable chronological ordering.
 *
 * ignoreDuplicates:true means existing rows are skipped entirely, so their
 * original created_at timestamps are never overwritten on re-saves.
 */
export async function saveMessages(
  messages: Array<{
    id: string;
    conversationId: string;
    role: "user" | "assistant" | "system" | "tool";
    parts: UIMessage["parts"];
    createdAt?: Date | string;
  }>,
  expectedUserId?: string,
): Promise<void> {
  if (messages.length === 0) return;

  // SECURITY: when a userId is provided, verify every conversation_id
  // in the batch belongs to that user before writing. Calls without
  // userId are limited to trusted internal flows and audited.
  if (expectedUserId) {
    const db = createAdminClient();
    const uniqueConvIds = Array.from(
      new Set(messages.map((m) => m.conversationId)),
    );
    const { data: convs, error: convErr } = await db.database
      .from("conversations")
      .select("id, user_id")
      .in("id", uniqueConvIds);
    if (convErr) {
      throw new Error(`saveMessages ownership check failed: ${convErr.message}`);
    }
    const ownerById = new Map<string, string>(
      (convs ?? []).map((r) => [r.id as string, r.user_id as string]),
    );
    for (const cid of uniqueConvIds) {
      const owner = ownerById.get(cid);
      if (!owner || owner !== expectedUserId) {
        throw new ConversationOwnedByAnotherUser(cid);
      }
    }
  }

  const baseTime = Date.now();
  await withRetry(async () => {
    const db = createAdminClient();
    const { error } = await db.database.from("messages").upsert(
      messages.map((m, i) => ({
        id: m.id,
        conversation_id: m.conversationId,
        role: m.role,
        parts: m.parts ?? [],
        created_at: m.createdAt
          ? new Date(m.createdAt).toISOString()
          : new Date(baseTime + i).toISOString(),
      })),
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw new Error(`saveMessages failed: ${error.message}`);
  });
}

/**
 * Load all messages for a conversation in chronological order.
 *
 * SECURITY: Caller MUST pass `userId` so we can scope the query. Without this
 * scoping, any authenticated user could read any other user's chat history by
 * submitting the conversation UUID (Finding 8). The conversation row itself
 * carries `user_id`; we filter on the join.
 */
export async function getMessages(
  conversationId: string,
  userId?: string,
): Promise<StoredMessage[]> {
  const db = createAdminClient();

  // First confirm the conversation belongs to the caller. If `userId` is
  // omitted we treat the call as a server-to-server / system call (e.g.
  // the Telegram webhook resuming its own chat history) — but the call
  // sites are audited and limited.
  if (userId) {
    const { data: conv } = await db.database.from("conversations")
      .select("user_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv || conv.user_id !== userId) {
      return [];
    }
  }

  const { data } = await db.database.from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    parts: row.parts,
    createdAt: row.created_at,
  }));
}

// ── Helpers ──

/**
 * Generate a short title from the first user message.
 * Truncates to 60 chars.
 */
export function generateTitle(messages: UIMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New Chat";

  const text = firstUser.parts
    ?.filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join(" ")
    .trim();

  if (!text) return "New Chat";
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    chatType: row.chat_type as "mail" | "github",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
