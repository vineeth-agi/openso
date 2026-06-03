import { useEffect, useRef, useCallback } from "react";

/**
 * Hook to handle virtual keyboard appearance on mobile devices.
 * Uses the visualViewport API to detect when the keyboard opens and
 * scrolls the focused input into the visible area within 300ms.
 */
export function useVirtualKeyboard(inputContainerRef: React.RefObject<HTMLElement | null>) {
  const isKeyboardVisibleRef = useRef(false);

  const handleViewportResize = useCallback(() => {
    const viewport = window.visualViewport;
    if (!viewport || !inputContainerRef.current) return;

    // The keyboard is likely open when the visual viewport height is significantly
    // less than the window inner height (at least 150px difference)
    const keyboardOpen = window.innerHeight - viewport.height > 150;

    if (keyboardOpen && !isKeyboardVisibleRef.current) {
      isKeyboardVisibleRef.current = true;

      // Scroll the input container into view within 300ms
      requestAnimationFrame(() => {
        inputContainerRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      });
    } else if (!keyboardOpen && isKeyboardVisibleRef.current) {
      isKeyboardVisibleRef.current = false;
    }
  }, [inputContainerRef]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    viewport.addEventListener("resize", handleViewportResize);
    viewport.addEventListener("scroll", handleViewportResize);

    return () => {
      viewport.removeEventListener("resize", handleViewportResize);
      viewport.removeEventListener("scroll", handleViewportResize);
    };
  }, [handleViewportResize]);
}
