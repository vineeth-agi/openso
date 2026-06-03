/**
 * GET  /api/conversations        — list user's conversations
 * POST /api/conversations        — (unused — created by chat routes)
 *
 * Query params:
 *   type=mail|github   filter by chat type
 *   limit=50           max results
 */

import { NextRequest, NextResponse } from "next/server";

import { getConversations } from "@/lib/chat-store";
import { getAuthUser } from "@/lib/insforge/server";

export async function GET(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user } = auth;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as "mail" | "github" | null;
  const limit = parseInt(searchParams.get("limit") ?? "50");

  const conversations = await getConversations(user.id, type ?? undefined, limit);
  return NextResponse.json(conversations);
}
