"use client";

/**
 * Chat Widget for `/portfolio/[username]`.
 *
 * Public-facing recruiter-chat UI rendered inside a SidePanel that slides
 * in from the right edge. The panel open/close state is managed by
 * `ChatPanelProvider` context — the NavigationBar's "Ask AI" button
 * triggers the toggle.
 *
 * The SidePanel is always in the DOM (translated off-screen when closed)
 * so chat state (messages, errors, loading) persists across open/close
 * cycles without remounting.
 *
 * Posts to `/api/portfolio-chat` with `{ username, messages }` on every
 * turn (the AI SDK transport spreads our `body: { username }` into the
 * JSON it sends — see the route's `PortfolioChatRequestSchema`).
 *
 * Error handling mirrors the route's `PortfolioChatError` codes (see
 * `.kiro/specs/portfolio-recruiter-chatbot/design.md` "Failure Matrix" and
 * "Client-Side Handling"):
 *   - 429 `rate_limited` → countdown banner derived from `retryAfter`,
 *     input disabled until the banner reaches 0.
 *   - 404 `user_not_found` → the entire widget renders nothing
 *     (likely a misconfigured route, not user-facing).
 *   - 400 `invalid_request` → "Something went wrong. Try refreshing."
 *   - 500 / 503 `internal_error` → "Chat is temporarily unavailable."
 *     with a retry button (calls `clearError`).
 *
 * Accessibility:
 *   - Panel uses `role="dialog"` with `aria-labelledby` referencing
 *     the header (handled by SidePanel).
 *   - Message list is `aria-live="polite"` so screen readers announce
 *     streamed assistant chunks without interrupting.
 *
 * The AI SDK v6 (`ai@^6`, `@ai-sdk/react@^3`) signature is used:
 *   `useChat({ transport: new DefaultChatTransport({ api, body }) })`.
 * The hook returns `{ messages, sendMessage, status, error, clearError }`
 * — there is no `input` / `handleInputChange` in v6, so we manage the
 * input value with local state.
 */

import * as React from "react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  ArrowDown,
  Check,
  Copy,
  FolderGit2,
  FileCode2,
  Info,
  MessageCircle,
  Send,
  Sparkles,
} from "lucide-react";

import { useChatPanel } from "@portfolio/components/chat-panel-context";
import { SidePanel } from "@portfolio/components/side-panel";
import { Button } from "@portfolio/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@portfolio/components/ui/tooltip";
import { cn } from "@portfolio/lib/utils";

import { Shimmer } from "@/components/ai/shimmer";
import { Markdown } from "@/components/markdown";
import type { PortfolioChatError } from "@/lib/portfolio-chat";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChatWidgetProps {
  /** Portfolio slug; sent in the JSON body of every outbound request. */
  username: string;
  /** Display name shown in the panel header. */
  candidateName: string;
}

// ── Tool metadata for on-demand GitHub tools ──────────────────────────────

const PORTFOLIO_TOOL_META: Record<
  string,
  { icon: typeof FolderGit2; label: string; activeLabel: string }
> = {
  get_repo_file_tree: {
    icon: FolderGit2,
    label: "Fetched file tree",
    activeLabel: "Fetching file tree...",
  },
  get_file_content: {
    icon: FileCode2,
    label: "Fetched file content",
    activeLabel: "Reading file...",
  },
  get_repo_details: {
    icon: Info,
    label: "Fetched repo details",
    activeLabel: "Fetching repo details...",
  },
};

function getPortfolioToolMeta(name: string) {
  return (
    PORTFOLIO_TOOL_META[name] ?? {
      icon: Sparkles,
      label: name.replace(/_/g, " "),
      activeLabel: `Running ${name.replace(/_/g, " ")}...`,
    }
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * The route returns a JSON body shaped like `PortfolioChatError` on every
 * non-streaming error. The AI SDK's `HttpChatTransport` rethrows that body
 * verbatim as the message of an `Error`. We parse it back here so the UI
 * can branch on the stable `code` field rather than the human-readable
 * `error` string. If parsing fails (e.g. a network error or a stack-trace
 * leak), we return `null` and the caller falls back to a generic message.
 */
function parsePortfolioChatError(
  error: Error | undefined,
): PortfolioChatError | null {
  if (!error) return null;
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "code" in parsed &&
      "error" in parsed &&
      typeof (parsed as { code: unknown }).code === "string" &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      return parsed as PortfolioChatError;
    }
  } catch {
    // Not JSON — fall through to null.
  }
  return null;
}

/**
 * Concatenate every `text` part of a UI message into a single string.
 * Assistant messages stream in as multiple `text` parts; rendering the
 * joined value is what makes the response appear progressively as
 * `useChat` yields chunks.
 */
function getMessageText(message: UIMessage): string {
  if (!message.parts) return "";
  return message.parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: unknown }).type === "text" &&
        typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("");
}

/** Check whether a part is a tool-related part (tool-invocation or tool-*). */
function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "tool-invocation";
}

/** Extract active/completed tool state from a tool part. */
function getToolState(part: Record<string, unknown>): {
  toolName: string;
  state: string;
} {
  const invocation = part.toolInvocation as Record<string, unknown> | undefined;
  return {
    toolName:
      (part.toolName as string) ||
      (invocation?.toolName as string) ||
      String(part.type).replace(/^tool-/, ""),
    state:
      (part.state as string) ||
      (invocation?.state as string) ||
      "",
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export function ChatWidget({ username, candidateName }: ChatWidgetProps) {
  const { isOpen, close, triggerRef } = useChatPanel();
  const [inputValue, setInputValue] = useState("");
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Stable transport — only rebuild when `username` changes (it shouldn't
  // during a session, but the dependency keeps the hook honest).
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/portfolio-chat",
        body: { username },
      }),
    [username],
  );

  const { messages, sendMessage, status, error, clearError } = useChat({
    transport,
  });

  const isLoading = status === "streaming" || status === "submitted";
  const chatError = parsePortfolioChatError(error);

  // ── Rate-limit countdown ─────────────────────────────────────────────
  useEffect(() => {
    if (chatError?.code === "rate_limited") {
      const seconds = Number.isFinite(chatError.retryAfter)
        ? Math.max(0, Math.floor(chatError.retryAfter ?? 0))
        : 60;
      setRetryCountdown(seconds > 0 ? seconds : 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error?.message]);

  useEffect(() => {
    if (retryCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setRetryCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryCountdown]);

  // Once the countdown hits zero, drop the rate-limit error so the user
  // can resubmit.
  useEffect(() => {
    if (retryCountdown === 0 && chatError?.code === "rate_limited") {
      clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCountdown]);

  // ── Auto-scroll on new messages and when panel opens ─────────────────
  const lastMessageLength = messages[messages.length - 1]
    ? getMessageText(messages[messages.length - 1] as UIMessage).length
    : 0;

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    // Only auto-scroll if user is near the bottom (within 100px)
    const isNearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, lastMessageLength]);

  // Auto-scroll to most recent message when panel opens
  const prevIsOpenRef = useRef(isOpen);
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (isOpen && !wasOpen) {
      // Panel just opened — scroll to bottom
      requestAnimationFrame(() => {
        const el = messageListRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    }
  }, [isOpen]);

  // ── Scroll-to-bottom button visibility ───────────────────────────────
  const handleScroll = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollButton(distanceFromBottom > 100);
  }, []);

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const scrollToBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // ── Derive shimmer label from tool parts in latest assistant message ──
  const lastMessage = messages[messages.length - 1];
  const shimmerLabel = useMemo(() => {
    if (!isLoading) return null;

    if (!lastMessage || lastMessage.role === "user") {
      return "Thinking...";
    }

    const parts = (lastMessage.parts ?? []) as Array<Record<string, unknown>>;
    const toolParts = parts
      .filter((p) => isToolPart(p as { type: string }))
      .map((p) => getToolState(p));

    const activeParts = toolParts.filter(
      (t) =>
        t.state === "input-streaming" ||
        t.state === "input-available" ||
        t.state === "call",
    );

    const text = getMessageText(lastMessage as UIMessage);
    const allDone =
      toolParts.length > 0 &&
      activeParts.length === 0 &&
      toolParts.every(
        (t) =>
          t.state === "output-available" ||
          t.state === "output-error" ||
          t.state === "result",
      );

    if (activeParts.length > 0) {
      const last = activeParts[activeParts.length - 1];
      return getPortfolioToolMeta(last.toolName).activeLabel;
    }

    if (allDone && !text) {
      const lastTool = toolParts[toolParts.length - 1];
      return getPortfolioToolMeta(lastTool.toolName).activeLabel;
    }

    if (!text && toolParts.length === 0) {
      return "Thinking...";
    }

    return null;
  }, [isLoading, lastMessage]);

  // ── 404 → hide widget entirely (Failure Matrix #3, #4) ───────────────
  if (chatError?.code === "user_not_found") {
    return null;
  }

  const isRateLimited = retryCountdown > 0;
  const inputDisabled = isLoading || isRateLimited;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || inputDisabled) return;
    setInputValue("");
    // Reset textarea height after sending
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    sendMessage({ text });
  };

  /** Auto-resize the textarea as user types */
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  };

  /** Allow Enter to submit, Shift+Enter for new line */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleRetry = () => {
    clearError();
  };

  // ── Render: SidePanel wraps all chat content ─────────────────────────
  return (
    <SidePanel
      isOpen={isOpen}
      onClose={close}
      triggerRef={triggerRef}
      title={`Chat with ${candidateName}`}
    >
      {/* Message list */}
      <div
        ref={messageListRef}
        aria-live="polite"
        aria-busy={isLoading}
        className="relative flex-1 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <WidgetEmptyState />
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {/* Shimmer status line for loading / tool activity */}
            {shimmerLabel && (
              <li className="flex items-start gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-border">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </span>
                <div className="flex items-center pt-1">
                  <Shimmer as="span" className="text-sm text-muted-foreground">
                    {shimmerLabel}
                  </Shimmer>
                </div>
              </li>
            )}
          </ol>
        )}

        {/* Scroll-to-bottom button */}
        {showScrollButton && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
            className={cn(
              "sticky bottom-2 left-1/2 -translate-x-1/2 z-10",
              "flex h-8 w-8 items-center justify-center rounded-full",
              "border border-border bg-background shadow-md",
              "transition-opacity hover:bg-muted",
            )}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Error banner (rate-limit countdown / generic / unavailable) */}
      <ErrorBanner
        chatError={chatError}
        retryCountdown={retryCountdown}
        onRetry={handleRetry}
      />

      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex items-end gap-2 border-t border-black/8 px-3 py-3",
          "dark:border-white/8",
        )}
      >
        <label htmlFor="portfolio-chat-input" className="sr-only">
          Ask {candidateName} a question
        </label>
        <textarea
          ref={textareaRef}
          id="portfolio-chat-input"
          value={inputValue}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          disabled={inputDisabled}
          placeholder={
            isRateLimited
              ? `Slow down — try again in ${retryCountdown}s`
              : "Ask about my experience..."
          }
          autoComplete="off"
          rows={1}
          className={cn(
            "flex-1 resize-none overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "max-h-[120px]",
          )}
        />
        <Button
          type="submit"
          size="icon"
          variant="neutral"
          aria-label="Send message"
          disabled={inputDisabled || inputValue.trim().length === 0}
          className="h-9 w-9 shrink-0 rounded-full"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    </SidePanel>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function WidgetEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 dark:bg-white/8"
        aria-hidden="true"
      >
        <MessageCircle className="h-5 w-5" />
      </span>
      <p className="font-cera text-sm font-medium">
        Ask me about my experience
      </p>
      <p className="max-w-[16rem] text-xs text-muted-foreground">
        Skills, projects, work history — I&apos;ll answer in first person.
      </p>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const text = getMessageText(message);
  const isUser = message.role === "user";

  // Extract tool parts from the message for the tool status chips
  const parts = (message.parts ?? []) as Array<Record<string, unknown>>;
  const toolParts = parts
    .filter((p) => isToolPart(p as { type: string }))
    .map((p) => getToolState(p));

  // Completed tools that produced output (show as compact chips)
  const completedTools = toolParts.filter(
    (t) =>
      t.state === "output-available" ||
      t.state === "output-error" ||
      t.state === "result",
  );

  if (!text && !isUser && completedTools.length === 0) return null;

  if (isUser) {
    return (
      <li className="flex justify-end">
        <div
          className={cn(
            "max-w-[85%] wrap-break-word rounded-2xl px-3 py-2 text-sm leading-relaxed",
            "whitespace-pre-wrap bg-black text-white dark:bg-white dark:text-black",
          )}
        >
          {text}
        </div>
      </li>
    );
  }

  // Assistant message — show avatar + tool chips + markdown content + copy
  return (
    <li className="group/message flex items-start gap-2.5">
      {/* Avatar */}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-border">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Tool status chips */}
        {completedTools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {completedTools.map((t, i) => {
              const meta = getPortfolioToolMeta(t.toolName);
              const Icon = meta.icon;
              const isError = t.state === "output-error";
              return (
                <span
                  key={`${t.toolName}-${i}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs",
                    isError
                      ? "border border-destructive/30 bg-destructive/5 text-destructive"
                      : "border border-border bg-muted/50 text-muted-foreground",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {isError ? `${meta.label} failed` : meta.label}
                </span>
              );
            })}
          </div>
        )}

        {/* Markdown content */}
        {text && (
          <div className="max-w-full wrap-break-word">
            <AssistantMarkdown text={text} />
          </div>
        )}

        {/* Copy button — visible on hover */}
        {text && <CopyButton content={text} />}
      </div>
    </li>
  );
}

/**
 * Copy-to-clipboard button that appears on hover over the message group.
 */
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  if (!content.trim()) return null;

  return (
    <div className="flex items-center opacity-0 transition-opacity group-hover/message:opacity-100">
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(content);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {copied ? "Copied!" : "Copy message"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

/**
 * Wrapper around `<Markdown>` that adds a small layer of resilience: if
 * markdown rendering throws (e.g. a future incompatible AST), we fall back
 * to a `whitespace-pre-wrap` plain-text render rather than letting an error
 * boundary blank the whole bubble.
 */
function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none wrap-break-word text-[13px] leading-relaxed **:font-sans! [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_p]:text-[13px] [&_li]:text-[13px]">
      <Markdown content={text} />
    </div>
  );
}

function ErrorBanner({
  chatError,
  retryCountdown,
  onRetry,
}: {
  chatError: PortfolioChatError | null;
  retryCountdown: number;
  onRetry: () => void;
}) {
  // Rate-limit countdown is the highest priority — it owns the input
  // disabled state regardless of which error code surfaced.
  if (retryCountdown > 0) {
    return (
      <div
        role="status"
        className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300"
      >
        Slow down — you can send another message in {retryCountdown}s.
      </div>
    );
  }

  if (!chatError) return null;

  if (chatError.code === "invalid_request") {
    return (
      <div
        role="alert"
        className="border-t border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-700 dark:text-red-300"
      >
        Something went wrong. Try refreshing.
      </div>
    );
  }

  if (
    chatError.code === "internal_error" ||
    chatError.code === "profile_not_configured"
  ) {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-center justify-between gap-3 border-t border-red-500/20 bg-red-500/10 px-4 py-2 text-xs",
          "text-red-700 dark:text-red-300",
        )}
      >
        <span>Chat is temporarily unavailable.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-7 px-2 text-xs"
        >
          Retry
        </Button>
      </div>
    );
  }

  return null;
}
