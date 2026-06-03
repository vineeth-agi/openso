/**
 * GET    /api/conversations/[id]  — get conversation + all messages
 * DELETE /api/conversations/[id]  — delete conversation
 *
 * Both endpoints scope by user_id (Finding 8 — without scoping, any
 * authenticated user could read any other user's chat history by submitting
 * the conversation UUID).
 */


import { NextResponse } from "next/server";

import { getMessages, deleteConversation } from "@/lib/chat-store";
import { getAuthUser } from "@/lib/insforge/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { user } = auth;

  const { id } = await params;
  // Pass user.id so chat-store can verify ownership before returning messages.
  const messages = await getMessages(id, user.id);
  return NextResponse.json(messages);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthUser();
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { user } = auth;

  const { id } = await params;
  await deleteConversation(id, user.id);
  return NextResponse.json({ success: true });
}
