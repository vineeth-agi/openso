import { generateText } from "ai";

import { google } from "@/lib/ai/google-provider";
import { createAdminClient } from "@/lib/insforge/admin";

function getModel() {
  return google();
}

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
}

export interface SessionSummary {
  id: string;
  chatType: string;
  sessionKey: string;
  summary: string;
  turnCount: number;
  lastSummarizedAt: string;
}

/**
 * Get the current session summary for a chat session.
 */
export async function getSessionSummary(
  userId: string,
  chatType: string,
  sessionKey: string,
): Promise<SessionSummary | null> {
  const db = createAdminClient();

  const { data } = await db.database.from("chat_session_summaries")
    .select("*")
    .eq("user_id", userId)
    .eq("chat_type", chatType)
    .eq("session_key", sessionKey)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    chatType: data.chat_type,
    sessionKey: data.session_key,
    summary: data.summary,
    turnCount: data.turn_count,
    lastSummarizedAt: data.last_summarized_at,
  };
}

/**
 * Update the session summary with new messages.
 * Always uses LLM to compress — no threshold-gated raw concatenation.
 * Called after each chat turn or when session ends.
 */
export async function updateSessionSummary(
  userId: string,
  chatType: string,
  sessionKey: string,
  messages: SessionMessage[],
): Promise<SessionSummary> {
  const db = createAdminClient();
  const existing = await getSessionSummary(userId, chatType, sessionKey);
  const turnCount = messages.length;

  // Always compress with LLM — even for small conversations
  const compressed = await compressSummary(existing?.summary ?? "", messages);

  const { data } = await db.database.from("chat_session_summaries")
    .upsert(
      {
        user_id: userId,
        chat_type: chatType,
        session_key: sessionKey,
        summary: compressed,
        turn_count: turnCount,
        last_summarized_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,chat_type,session_key" },
    )
    .select("*")
    .single();

  if (!data) return null as unknown as SessionSummary;
  return mapRow(data);
}

/**
 * Use LLM to compress the conversation into a summary.
 * If there's an existing summary, it merges old + new.
 */
async function compressSummary(
  existingSummary: string,
  messages: SessionMessage[],
): Promise<string> {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.text}`)
    .join("\n");

  const prompt = existingSummary
    ? `You are a conversation summarizer. You have an existing summary and new messages.
Merge them into a single, concise summary that captures:
- What the user asked about / wanted to accomplish
- Key decisions made
- Any important details mentioned (names, dates, preferences, etc.)
- Current state / what was resolved or left open

Existing summary:
${existingSummary}

New messages:
${transcript}

Write a concise merged summary (max 300 words):`
    : `Summarize this conversation concisely. Capture:
- What the user asked about / wanted to accomplish
- Key decisions made
- Any important details mentioned (names, dates, preferences, etc.)
- Current state / what was resolved or left open

Conversation:
${transcript}

Write a concise summary (max 300 words):`;

  try {
    const { text } = await generateText({
      model: getModel(),
      prompt,
      maxOutputTokens: 512,
    });
    return text.trim();
  } catch {
    // Fallback: basic concatenation if LLM fails
    return messages
      .filter((m) => m.role === "user")
      .map((m) => m.text)
      .slice(0, 3)
      .join("; ");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): SessionSummary {
  return {
    id: row.id,
    chatType: row.chat_type,
    sessionKey: row.session_key,
    summary: row.summary,
    turnCount: row.turn_count,
    lastSummarizedAt: row.last_summarized_at,
  };
}

