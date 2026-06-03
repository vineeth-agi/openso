/**
 * Telegram Bot Connector API
 *
 * POST   /api/telegram/connect  — validate token, register per-user webhook, store
 * DELETE /api/telegram/connect  — delete webhook, clear token from DB
 * GET    /api/telegram/connect  — return current connection status
 */
import { NextRequest, NextResponse } from "next/server";

import crypto from "crypto";


import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = auth.user;

  const body = await req.json();
  const token = (body.botToken ?? "").trim();
  if (!token) return NextResponse.json({ error: "botToken is required" }, { status: 400 });

  // Validate token by calling Telegram getMe
  let getMeData: any;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    getMeData = await res.json();
  } catch (e) {
    console.error("[telegram/connect] getMe fetch error:", e);
    return NextResponse.json({ error: "Failed to reach Telegram API" }, { status: 502 });
  }

  if (!getMeData?.ok) {
    return NextResponse.json(
      { error: "Invalid bot token. Make sure you copied the full token from BotFather." },
      { status: 400 },
    );
  }

  const botUsername: string = getMeData.result.username;
  const botName: string = getMeData.result.first_name;

  // Determine app base URL for the webhook
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!baseUrl) {
    return NextResponse.json(
      { error: "Could not determine app URL — set NEXT_PUBLIC_APP_URL in your environment." },
      { status: 500 },
    );
  }

  const webhookUrl = `${baseUrl}/api/telegram/webhook/${user.id}`;
  const webhookSecret = crypto.randomBytes(32).toString("hex");

  // Register the webhook with Telegram (with secret_token for validation)
  let webhookData: any;
  try {
    const wRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ["message"],
      }),
    });
    webhookData = await wRes.json();
  } catch (e) {
    console.error("[telegram/connect] setWebhook fetch error:", e);
    return NextResponse.json({ error: "Failed to register webhook with Telegram" }, { status: 502 });
  }

  if (!webhookData?.ok) {
    console.error("[telegram/connect] setWebhook failed:", webhookData);
    return NextResponse.json(
      { error: "Telegram rejected the webhook URL", details: webhookData },
      { status: 500 },
    );
  }

  // Persist bot token (encrypted at rest) + username + webhook secret;
  // reset any stale chat link.
  const admin = createAdminClient();
  const { error: dbError } = await admin
    .database.from("profiles")
    .update({
      telegram_bot_token: encryptToken(token),
      telegram_bot_username: botUsername,
      telegram_webhook_secret: webhookSecret,
      telegram_chat_id: null,
    })
    .eq("id", user.id);

  if (dbError) {
    console.error("[telegram/connect] DB update error:", dbError);
    return NextResponse.json({ error: "Failed to save connection" }, { status: 500 });
  }

  // Register bot commands with Telegram — users see these in the command menu
  // Matches OpenClaw's setMyCommands pattern
  try {
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "start", description: "Link your account to this bot" },
          { command: "status", description: "Show connection status and linked apps" },
          { command: "help", description: "See what Jarvis can do" },
        ],
      }),
    });
  } catch (e) {
    console.warn("[telegram/connect] setMyCommands failed (non-fatal):", e);
  }

  return NextResponse.json({ ok: true, botUsername, botName, webhookUrl });
}

export async function DELETE() {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = auth.user;

  const admin = createAdminClient();

  // Fetch the stored token so we can delete the webhook from Telegram's side
  const { data: profile } = await admin
    .database.from("profiles")
    .select("telegram_bot_token")
    .eq("id", user.id)
    .single();

  const storedToken = profile?.telegram_bot_token as string | null | undefined;
  const decryptedToken = storedToken
    ? (await import("@/lib/security/token-crypto")).decryptToken(storedToken)
    : null;
  if (decryptedToken) {
    try {
      await fetch(
        `https://api.telegram.org/bot${decryptedToken}/deleteWebhook`,
        { method: "POST" },
      );
    } catch (e) {
      console.warn("[telegram/connect] deleteWebhook failed (non-fatal):", e);
    }
  }

  await admin
    .database.from("profiles")
    .update({
      telegram_bot_token: null,
      telegram_bot_username: null,
      telegram_webhook_secret: null,
      telegram_chat_id: null,
    })
    .eq("id", user.id);

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = auth.user;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .database.from("profiles")
    .select("telegram_bot_username, telegram_chat_id")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    connected: !!profile?.telegram_bot_username,
    botUsername: profile?.telegram_bot_username ?? null,
    chatLinked: !!profile?.telegram_chat_id,
  });
}
