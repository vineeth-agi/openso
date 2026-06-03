"use client";

/**
 * ChatPanelContext
 *
 * Manages the open/close state of the chat side panel and exposes it
 * to both the NavigationBar (trigger) and ChatWidget (panel).
 *
 * Usage:
 *   <ChatPanelProvider>
 *     <NavigationBar />
 *     <ChatWidget />
 *   </ChatPanelProvider>
 *
 *   // In any descendant:
 *   const { isOpen, toggle, close, open } = useChatPanel();
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

interface ChatPanelContextValue {
  /** Whether the side panel is currently open */
  isOpen: boolean;
  /** Toggle panel state (open↔closed) */
  toggle: () => void;
  /** Explicitly close the panel */
  close: () => void;
  /** Explicitly open the panel */
  open: () => void;
  /** Ref to the trigger element (Ask AI button wrapper) for focus restoration */
  triggerRef: RefObject<HTMLButtonElement | HTMLDivElement | null>;
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

interface ChatPanelProviderProps {
  children: ReactNode;
}

export function ChatPanelProvider({ children }: ChatPanelProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | HTMLDivElement | null>(null);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => setIsOpen(true), []);

  const value = useMemo(
    () => ({ isOpen, toggle, close, open, triggerRef }),
    [isOpen, toggle, close, open]
  );

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
}

/**
 * Returns the chat panel state and actions.
 * Must be used within a ChatPanelProvider.
 */
export function useChatPanel(): ChatPanelContextValue {
  const ctx = useContext(ChatPanelContext);
  if (!ctx) {
    throw new Error(
      "useChatPanel must be used within a ChatPanelProvider. " +
        "Wrap your component tree with <ChatPanelProvider> to provide chat panel state."
    );
  }
  return ctx;
}
