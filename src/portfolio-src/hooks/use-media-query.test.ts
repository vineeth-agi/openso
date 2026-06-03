import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useMediaQuery } from "./use-media-query";

describe("useMediaQuery", () => {
  let listeners: Array<(e: MediaQueryListEvent) => void>;
  let mockMatchMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listeners = [];
    mockMatchMedia = vi.fn((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
        listeners.push(handler);
      },
      removeEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
        listeners = listeners.filter((l) => l !== handler);
      },
      dispatchEvent: () => true,
      onchange: null,
    }));
    window.matchMedia = mockMatchMedia as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false initially (SSR-safe default)", () => {
    // Before the effect runs, the state is false
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    // After effect, it syncs with matchMedia — which returns false for this query
    expect(result.current).toBe(false);
  });

  it("returns true when the media query matches", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(true);
  });

  it("updates when the media query changes", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(true);

    // Simulate a viewport change
    act(() => {
      listeners.forEach((handler) =>
        handler({ matches: false } as MediaQueryListEvent)
      );
    });

    expect(result.current).toBe(false);
  });

  it("cleans up the event listener on unmount", () => {
    const { unmount } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(listeners.length).toBe(1);

    unmount();
    expect(listeners.length).toBe(0);
  });

  it("re-subscribes when the query string changes", () => {
    const { rerender } = renderHook(
      ({ query }) => useMediaQuery(query),
      { initialProps: { query: "(max-width: 767px)" } }
    );

    expect(mockMatchMedia).toHaveBeenCalledWith("(max-width: 767px)");

    rerender({ query: "(min-width: 1024px)" });
    expect(mockMatchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
  });
});
