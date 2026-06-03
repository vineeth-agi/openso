"use client";

import * as React from "react";
import { useEffect, useRef, useCallback } from "react";

import { X } from "lucide-react";

import { useMediaQuery } from "@portfolio/hooks/use-media-query";
import { cn } from "@portfolio/lib/utils";

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | HTMLDivElement | null>;
  title?: string;
  children: React.ReactNode;
}

/**
 * SidePanel — a fixed-position panel that slides in from the right edge.
 *
 * - Desktop (≥768px): 400px wide, non-modal, no focus trap, no scroll lock.
 * - Mobile (<768px): full-width slide-over, modal with focus trap and scroll lock.
 *
 * The panel is always in the DOM (translated off-screen when closed) to
 * preserve child state (e.g. chat messages) across open/close cycles.
 */
export function SidePanel({
  isOpen,
  onClose,
  triggerRef,
  title = "AI Chat",
  children,
}: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const prefersReducedMotion = useMediaQuery(
    "(prefers-reduced-motion: reduce)"
  );

  // Track previous isOpen to detect transitions
  const prevIsOpenRef = useRef(isOpen);

  // --- Focus management: move focus into panel on open, restore on close ---
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (isOpen && !wasOpen) {
      // Panel just opened — move focus to first input or focusable element
      requestAnimationFrame(() => {
        if (!panelRef.current) return;
        const focusTarget = panelRef.current.querySelector<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        focusTarget?.focus();
      });
    } else if (!isOpen && wasOpen) {
      // Panel just closed — restore focus to trigger
      requestAnimationFrame(() => {
        if (triggerRef.current) {
          // If the ref is a div wrapper, try to focus the button inside it
          if (triggerRef.current.tagName === "DIV") {
            const btn =
              triggerRef.current.querySelector<HTMLButtonElement>("button");
            if (btn) {
              btn.focus();
              return;
            }
          }
          triggerRef.current.focus();
        }
      });
    }
  }, [isOpen, triggerRef]);

  // --- Escape key handler ---
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // --- Body scroll lock on mobile ---
  useEffect(() => {
    if (isMobile && isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isMobile, isOpen]);

  // --- Focus trap on mobile ---
  const handleFocusTrap = useCallback(
    (e: KeyboardEvent) => {
      if (!isMobile || !isOpen || e.key !== "Tab") return;
      if (!panelRef.current) return;

      const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (focusableElements.length === 0) return;

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    },
    [isMobile, isOpen]
  );

  useEffect(() => {
    if (!isMobile || !isOpen) return;

    document.addEventListener("keydown", handleFocusTrap);
    return () => document.removeEventListener("keydown", handleFocusTrap);
  }, [isMobile, isOpen, handleFocusTrap]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={isMobile ? "true" : undefined}
      aria-labelledby="chat-panel-header"
      className={cn(
        "fixed top-0 right-0 z-50 flex h-dvh flex-col",
        "border-l border-black/10 bg-background shadow-xl dark:border-white/10",
        // Width: 400px desktop, full-width mobile
        "w-full md:w-[400px]",
        // Transition (only when reduced motion is not preferred)
        !prefersReducedMotion && "transition-transform duration-300",
        // Position based on open state
        isOpen ? "translate-x-0" : "translate-x-full",
        // Easing: ease-out for open, ease-in for close
        !prefersReducedMotion && (isOpen ? "ease-out" : "ease-in")
      )}
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
        <h2
          id="chat-panel-header"
          className="text-sm font-semibold text-foreground"
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className={cn(
            "flex items-center justify-center rounded-full text-black/60 transition-colors hover:text-black dark:text-white/60 dark:hover:text-white",
            // 44×44px tap target on mobile, smaller on desktop
            "min-h-[44px] min-w-[44px] md:h-8 md:w-8 md:min-h-0 md:min-w-0"
          )}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Panel Content */}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
