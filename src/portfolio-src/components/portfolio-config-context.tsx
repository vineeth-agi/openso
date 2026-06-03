"use client";

/**
 * PortfolioConfigContext
 *
 * Provides a runtime override for siteConfig. When present in the React tree,
 * components call `usePortfolioConfig()` instead of importing siteConfig directly.
 *
 * - Static /portfolio route: no provider → components use static siteConfig
 * - Dynamic /portfolio/[username] routes: provider injects DB config
 *
 * It also supports a global store context so that layout-level components
 * (like NavigationBar) rendered outside the deep nested providers can still
 * access the active dynamic portfolio configuration.
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

import { siteConfig } from "@portfolio/site.config";

import type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";

// Cast the DB config to ConfigShape — the shapes are intentionally identical
type ConfigShape = typeof siteConfig;

interface PortfolioConfigStoreValue {
  config: ConfigShape | null;
  setConfig: (config: ConfigShape | null) => void;
  hideDefaultNavbar: boolean;
  setHideDefaultNavbar: (hide: boolean) => void;
}

const PortfolioConfigStoreContext = createContext<PortfolioConfigStoreValue | null>(null);
const PortfolioConfigContext = createContext<ConfigShape | null>(null);

interface PortfolioConfigStoreProviderProps {
  children: ReactNode;
}

export function PortfolioConfigStoreProvider({ children }: PortfolioConfigStoreProviderProps) {
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [hideDefaultNavbar, setHideDefaultNavbar] = useState(false);

  return (
    <PortfolioConfigStoreContext.Provider value={{ config, setConfig, hideDefaultNavbar, setHideDefaultNavbar }}>
      {children}
    </PortfolioConfigStoreContext.Provider>
  );
}

export function usePortfolioConfigStore() {
  return useContext(PortfolioConfigStoreContext);
}

interface PortfolioConfigProviderProps {
  config: PortfolioSiteConfig;
  children: ReactNode;
}

export function PortfolioConfigProvider({
  config,
  children,
}: PortfolioConfigProviderProps) {
  const store = useContext(PortfolioConfigStoreContext);
  const castedConfig = config as unknown as ConfigShape;

  useEffect(() => {
    if (store) {
      store.setConfig(castedConfig);
      store.setHideDefaultNavbar(true);
    }
    return () => {
      if (store) {
        store.setConfig(null);
        store.setHideDefaultNavbar(false);
      }
    };
  }, [castedConfig, store]);

  return (
    <PortfolioConfigContext.Provider value={castedConfig}>
      {children}
    </PortfolioConfigContext.Provider>
  );
}

/**
 * Returns the active portfolio config.
 * Falls back to the static siteConfig if no provider is in the tree.
 */
export function usePortfolioConfig(): ConfigShape {
  const localCtx = useContext(PortfolioConfigContext);
  if (localCtx) return localCtx;

  const store = useContext(PortfolioConfigStoreContext);
  if (store?.config) return store.config;

  return siteConfig;
}
