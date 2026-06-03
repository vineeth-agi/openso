"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";


import { Loader2 } from "lucide-react";

// bundle-dynamic-imports: lazy-load the heavy ChatPage component (2100+ lines)
const ChatPage = dynamic(() => import("@/views/chat/chat-page").then((m) => ({ default: m.ChatPage })), {
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

export default function ChatConversationPage() {
  const params = useParams<{ id: string }>();
  return <ChatPage key={params.id} conversationId={params.id} />;
}
