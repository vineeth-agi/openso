"use client";

import { useState, useEffect } from "react";

import { formatDistanceToNow } from "date-fns";
import {
  History,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ConversationItem {
  id: string;
  title: string;
  chatType: string;
  updatedAt: string;
}

function ChatHistorySidebar({
  open,
  onClose,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  activeId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
}) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fetch conversations when sidebar opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/conversations?type=mail&limit=50")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setConversations(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        onDelete(id);
      }
    } catch { /* ignore */ }
    setDeletingId(null);
  };

  if (!open) return null;

  return (
    <div className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-r border-border/50 bg-sidebar/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Chat History</span>
        </div>
        <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New chat"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    onNewChat();
                    onClose();
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">New chat</TooltipContent>
            </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close sidebar"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2">
          {loading ? (
            <div className="flex flex-col gap-2 px-2 py-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/30" />
              <p className="mt-2 text-xs text-muted-foreground">No conversations yet</p>
              <p className="text-xs text-muted-foreground/60">Start chatting to see history here</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelect(conv.id);
                  onClose();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(conv.id);
                    onClose();
                  }
                }}
                className={cn(
                  "group flex w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
                  conv.id === activeId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/60"
                )}
              >
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-snug">
                    {conv.title || "New Chat"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(conv.updatedAt), { addSuffix: true })}
                  </p>
                </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Delete conversation"
                        onClick={(e) => handleDelete(e, conv.id)}
                        disabled={deletingId === conv.id}
                        className={cn(
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-all",
                          "opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive",
                          deletingId === conv.id && "opacity-100 animate-pulse"
                        )}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">Delete</TooltipContent>
                  </Tooltip>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export { ChatHistorySidebar };
export type { ConversationItem };
