"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

interface ViewsContextType {
  getViews: (slug: string) => number | null;
  incrementViews: (slug: string) => Promise<void>;
  prefetchViews: (slugs: string[]) => void;
}

const ViewsContext = createContext<ViewsContextType | null>(null);

const CACHE_KEY = "views-cache-all";
const CACHE_DURATION = 5 * 60 * 1000;
const BATCH_DELAY = 50;

const SERVER_SNAPSHOT: Record<string, number> = {};

const cacheStore = {
  views: {} as Record<string, number>,
  listeners: new Set<() => void>(),

  subscribe(listener: () => void) {
    cacheStore.listeners.add(listener);
    return () => cacheStore.listeners.delete(listener);
  },

  getSnapshot() {
    return cacheStore.views;
  },

  getServerSnapshot() {
    return SERVER_SNAPSHOT;
  },

  init() {
    if (typeof window === "undefined") return;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < CACHE_DURATION) {
          cacheStore.views = data.views;
          cacheStore.notify();
        } else {
          localStorage.removeItem(CACHE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  },

  save(views: Record<string, number>) {
    cacheStore.views = views;
    cacheStore.notify();
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ views, timestamp: Date.now() })
      );
    } catch {}
  },

  notify() {
    cacheStore.listeners.forEach((l) => l());
  },
};

// Initialize client-side cache
if (typeof window !== "undefined") {
  cacheStore.init();
}

export function ViewsProvider({ children }: { children: React.ReactNode }) {
  // Subscribe to store updates to trigger re-renders
  useSyncExternalStore(
    cacheStore.subscribe,
    cacheStore.getSnapshot,
    cacheStore.getServerSnapshot
  );

  const pendingSlugsRef = useRef<Set<string>>(new Set());
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fetchingRef = useRef<Set<string>>(new Set());

  const fetchBatch = useCallback(async (slugs: string[]) => {
    if (slugs.length === 0 || typeof window === "undefined") return;
    slugs.forEach((slug) => fetchingRef.current.add(slug));

    try {
      const res = await fetch(`/api/views/batch?slugs=${slugs.join(",")}`);
      if (res.ok) {
        const data = await res.json();
        const updated = { ...cacheStore.getSnapshot(), ...data.views };
        cacheStore.save(updated);
      }
    } catch (error) {
      console.error("Error fetching views:", error);
    } finally {
      slugs.forEach((slug) => fetchingRef.current.delete(slug));
    }
  }, []);

  const scheduleBatchFetch = useCallback(() => {
    if (batchTimeoutRef.current) clearTimeout(batchTimeoutRef.current);
    batchTimeoutRef.current = setTimeout(() => {
      const slugsToFetch = Array.from(pendingSlugsRef.current);
      pendingSlugsRef.current.clear();
      if (slugsToFetch.length > 0) fetchBatch(slugsToFetch);
    }, BATCH_DELAY);
  }, [fetchBatch]);

  const prefetchViews = useCallback(
    (slugs: string[]) => {
      const current = cacheStore.getSnapshot();
      const slugsToFetch = slugs.filter(
        (slug) => !(slug in current) && !fetchingRef.current.has(slug)
      );
      if (slugsToFetch.length > 0) {
        slugsToFetch.forEach((slug) => pendingSlugsRef.current.add(slug));
        scheduleBatchFetch();
      }
    },
    [scheduleBatchFetch]
  );

  const getViews = useCallback(
    (slug: string) => {
      const current = cacheStore.getSnapshot();
      if (
        !(slug in current) &&
        !pendingSlugsRef.current.has(slug) &&
        !fetchingRef.current.has(slug)
      ) {
        pendingSlugsRef.current.add(slug);
        scheduleBatchFetch();
      }
      return current[slug] ?? null;
    },
    [scheduleBatchFetch]
  );

  const incrementViews = useCallback(
    async (slug: string) => {
      const sessionKey = `viewed-${slug}`;
      if (sessionStorage.getItem(sessionKey)) {
        if (
          !pendingSlugsRef.current.has(slug) &&
          !fetchingRef.current.has(slug)
        ) {
          if (!(slug in cacheStore.getSnapshot())) {
            pendingSlugsRef.current.add(slug);
            scheduleBatchFetch();
          }
        }
        return;
      }

      // Not viewed yet - we will POST it.
      // Remove from pending GET queue so we don't GET it in parallel.
      pendingSlugsRef.current.delete(slug);
      fetchingRef.current.add(slug);

      try {
        const res = await fetch("/api/views", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });

        if (res.ok) {
          const data = await res.json();
          const updated = { ...cacheStore.getSnapshot(), [slug]: data.views };
          cacheStore.save(updated);
          sessionStorage.setItem(sessionKey, "true");
        }
      } catch (error) {
        console.error("Error incrementing views:", error);
      } finally {
        fetchingRef.current.delete(slug);
      }
    },
    [scheduleBatchFetch]
  );

  useEffect(() => {
    return () => {
      if (batchTimeoutRef.current) clearTimeout(batchTimeoutRef.current);
    };
  }, []);

  return (
    <ViewsContext.Provider value={{ getViews, incrementViews, prefetchViews }}>
      {children}
    </ViewsContext.Provider>
  );
}

export function useViews() {
  const context = useContext(ViewsContext);
  if (!context) {
    throw new Error("useViews must be used within a ViewsProvider");
  }
  return context;
}
