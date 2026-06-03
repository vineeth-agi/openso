"use client";

import { useState, useEffect } from "react";

/**
 * SSR-safe hook that listens to a CSS media query and returns whether it matches.
 *
 * Defaults to `false` during SSR (when `window` is undefined) and synchronizes
 * with the actual viewport state after hydration.
 *
 * @param query - A valid CSS media query string, e.g. "(max-width: 767px)"
 * @returns `true` if the viewport currently matches the query, `false` otherwise
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
