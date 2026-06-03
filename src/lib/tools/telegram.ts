/**
 * Telegram helpers — per-user bot token model.
 *
 * Each user stores their own bot token (from @BotFather) in profiles.telegram_bot_token.
 * All sends use the raw Telegram Bot API via fetch — no grammy singleton needed.
 *
 * Telegram Bot API docs: https://core.telegram.org/bots/api
 */
import { createAdminClient } from "@/lib/insforge/admin";

/**
 * Send a Telegram message using a specific bot token.
 * Tries the given parse_mode first; if Telegram rejects it (bad entities),
 * retries as plain text — so the user always gets the message.
 */
async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  parseMode: "HTML" | "MarkdownV2" = "HTML",
): Promise<void> {
  const safeText = formatForTelegram(text);

  const tgPost = async (body: object) => {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<{ ok: boolean; description?: string }>;
  };

  // Attempt 1: with the requested parse mode
  const r1 = await tgPost({ chat_id: chatId, text: safeText, parse_mode: parseMode });
  if (r1.ok) return;

  console.warn("[telegram] Send failed with", parseMode, ":", r1.description, "— retrying as plain text");

  // Attempt 2: strip formatting and send as plain text
  const plain = safeText
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  const r2 = await tgPost({ chat_id: chatId, text: plain });
  if (!r2.ok) {
    throw new Error(`Telegram sendMessage failed (both attempts): ${r2.description}`);
  }
}

/**
 * Look up a user's bot token + chat_id from their profile, then send a message.
 * Used by notification/proactive systems that know the userId but not the token.
 */
export async function sendTelegramMessageToUser(
  userId: string,
  text: string,
  parseMode: "HTML" | "MarkdownV2" = "HTML",
): Promise<void> {
  const db = createAdminClient();
  const { data: profile } = await db.database.from("profiles")
    .select("telegram_bot_token, telegram_chat_id")
    .eq("id", userId)
    .single();

  if (!profile?.telegram_bot_token) throw new Error("User has no Telegram bot configured");
  if (!profile?.telegram_chat_id) throw new Error("User's Telegram account is not linked (send /start to your bot)");

  await sendTelegramMessage(profile.telegram_bot_token, profile.telegram_chat_id, text, parseMode);
}

/**
 * Escape special characters for Telegram MarkdownV2.
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Format a Jarvis message for Telegram — truncates at 4000 chars (API limit is 4096).
 */
function formatForTelegram(text: string): string {
  if (text.length > 4000) {
    return text.slice(0, 3990) + "\n\n...";
  }
  return text;
}

// ── Telegram-safe tool re-exports ──
// Previously in telegram-tools.ts — re-exports of canonical admin functions
export { getConnectedSlugsAdmin } from "@/lib/connections";
export { fetchNativeAppTools as fetchNativeAppToolsAdmin } from "./tool-router";
