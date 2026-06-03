"use client";

/**
 * ChatAwareContent
 *
 * A wrapper that shifts the portfolio content left when the chat panel is open
 * on desktop screens (≥768px). On mobile the chat panel is full-screen modal
 * so no content shift is needed.
 *
 * Uses a smooth CSS transition so the layout animates instead of jumping.
 */

import { type ReactNode } from "react";

import { useChatPanel } from "@portfolio/components/chat-panel-context";
import { useMediaQuery } from "@portfolio/hooks/use-media-query";
import { cn } from "@portfolio/lib/utils";

interface ChatAwareContentProps {
  children: ReactNode;
  className?: string;
}

export function ChatAwareContent({ children, className }: ChatAwareContentProps) {
  const { isOpen } = useChatPanel();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Only apply the margin shift on desktop when chat panel is open
  const shouldShift = isOpen && isDesktop;

  return (
    <div
      className={cn(className)}
      style={{
        marginRight: shouldShift ? "400px" : "0px",
        transition: "margin-right 300ms ease",
      }}
    >
      {children}
    </div>
  );
}
