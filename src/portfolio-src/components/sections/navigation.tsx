// @ts-nocheck
"use client";

import { useState, useEffect, useMemo } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MessageCircle } from "lucide-react";
import { useTheme } from "next-themes";

import {
  Tabs,
  TabsList,
  TabsHighlight,
  TabsHighlightItem,
  TabsTrigger,
} from "@portfolio/components/animate-ui/primitives/animate/tabs";
import { useChatPanel } from "@portfolio/components/chat-panel-context";
import MagnifierIcon from "@portfolio/components/icons/beaker";
import BookIcon from "@portfolio/components/icons/book";
import SuitcaseIcon from "@portfolio/components/icons/briefcase";
import HouseIcon from "@portfolio/components/icons/house";
import MoonIcon from "@portfolio/components/icons/moon";
import CodeEditorIcon from "@portfolio/components/icons/sparkles";
import StarSparkleIcon from "@portfolio/components/icons/star-sparkle";
import SunIcon from "@portfolio/components/icons/sun";
import { usePortfolioConfig, usePortfolioConfigStore } from "@portfolio/components/portfolio-config-context";
import { navLinks as staticNavLinks } from "@portfolio/constants";
import { useMediaQuery } from "@portfolio/hooks/use-media-query";
import { vibrate, vibrateSelection, playClickSound } from "@portfolio/lib/haptics";
import { cn } from "@portfolio/lib/utils";

interface AskAIButtonProps {
  isOpen: boolean;
  onToggle: () => void;
}

const AskAIButton = ({ isOpen, onToggle }: AskAIButtonProps) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isOpen ? "Close AI chat" : "Open AI chat"}
      aria-expanded={isOpen}
      className={cn(
        "relative flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full",
        "transition-colors duration-200",
        "md:h-9 md:min-h-0 md:min-w-0 md:px-3",
        isOpen
          ? "bg-black/10 text-black dark:bg-white/10 dark:text-white"
          : "text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
      )}
    >
      <MessageCircle className="h-[18px] w-[18px]" />
      <span className="hidden text-[11px] font-medium tracking-wide md:inline">
        Ask AI
      </span>
    </button>
  );
};

interface NavigationBarProps {
  forceRender?: boolean;
}

function NavigationBar({ forceRender }: NavigationBarProps) {
  const store = usePortfolioConfigStore();

  if (store?.hideDefaultNavbar && !forceRender) {
    return null;
  }

  const siteConfig = usePortfolioConfig();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState(pathname);
  const { theme, setTheme } = useTheme();
  const { isOpen, toggle, triggerRef } = useChatPanel();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Derive the base path from the current URL so nav links always point correctly.
  // /portfolio/vineeth/projects → base = "/portfolio/vineeth"
  // /portfolio/projects         → base = "/portfolio"
  const basePath = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean); // e.g. ["portfolio", "vineeth", "projects"]
    const knownPages = new Set(["projects", "experience", "hackathons", "blogs", "research"]);
    // If 3+ segments and last is a known page, base is first two segments
    if (segments.length >= 3 && knownPages.has(segments[segments.length - 1])) {
      return "/" + segments.slice(0, segments.length - 1).join("/");
    }
    // If 2 segments and second is NOT a known page, it's the username root
    if (segments.length === 2 && !knownPages.has(segments[1])) {
      return "/" + segments.join("/");
    }
    // Default: /portfolio
    return "/portfolio";
  }, [pathname]);

  // Build nav from config names but rewrite paths to use the correct base
  const filteredNavLinks = useMemo(() => {
    const rawNav = siteConfig.nav?.length ? siteConfig.nav : staticNavLinks;
    const navLinks = rawNav.map((link) => {
      const lastSeg = link.path.split("/").filter(Boolean).pop() ?? "";
      const knownPages = new Set(["projects", "experience", "hackathons", "blogs", "research"]);
      const path = knownPages.has(lastSeg) ? `${basePath}/${lastSeg}` : basePath;
      return { ...link, path };
    });

    // Map routes to their content arrays — hide nav items with no content
    const contentMap: Record<string, unknown[]> = {};
    for (const link of navLinks) {
      const seg = link.path.split("/").filter(Boolean).pop() ?? "";
      if (seg === "hackathons") contentMap[link.path] = siteConfig.hackathons ?? [];
      else if (seg === "projects") contentMap[link.path] = siteConfig.projects ?? [];
      else if (seg === "experience") contentMap[link.path] = siteConfig.experiences ?? [];
      else if (seg === "research") contentMap[link.path] = siteConfig.research ?? [];
      // Blogs: show on static /portfolio (shared content), hide on dynamic /portfolio/[username]
      else if (seg === "blogs") contentMap[link.path] = basePath === "/portfolio" ? [true] : [];
    }

    return navLinks.filter((link) => {
      const content = contentMap[link.path];
      // If no mapping exists (e.g. "/" for About), always show
      if (!content) return true;
      return content.length > 0;
    });
  }, [siteConfig, basePath]);

  // Build icon map dynamically from nav paths (last segment determines icon)
  const iconMap = useMemo(() => {
    const map: Record<string, typeof HouseIcon> = {};
    for (const link of filteredNavLinks) {
      const seg = link.path.split("/").filter(Boolean).pop() ?? "";
      if (seg === "portfolio" || link.name === "About") map[link.path] = HouseIcon;
      else if (seg === "projects") map[link.path] = CodeEditorIcon;
      else if (seg === "experience") map[link.path] = SuitcaseIcon;
      else if (seg === "blogs") map[link.path] = BookIcon;
      else if (seg === "hackathons") map[link.path] = StarSparkleIcon;
      else if (seg === "research") map[link.path] = MagnifierIcon;
      else map[link.path] = HouseIcon;
    }
    return map;
  }, [filteredNavLinks]);

  useEffect(() => {
    setActiveTab(pathname);
  }, [pathname]);

  const handleNavigation = (val) => {
    vibrateSelection();
    setActiveTab(val);
  };

  const toggleMode = () => {
    vibrate();
    playClickSound();
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <nav
      className="fixed bottom-6 left-0 right-0 z-50 flex justify-center md:bottom-auto md:top-6"
      style={{
        transform: isDesktop 
          ? (isOpen ? "translateX(-200px)" : "none")
          : (isOpen ? "translateY(150px)" : "none"),
        opacity: !isDesktop && isOpen ? 0 : 1,
        pointerEvents: !isDesktop && isOpen ? "none" : "auto",
        display: !isDesktop && isOpen ? "none" : "flex",
        transition: "transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div className="flex items-center rounded-full border border-black/8 bg-black/5 px-1 py-1 backdrop-blur-xl dark:border-white/8 dark:bg-white/5 md:px-2">
        <Tabs value={activeTab} onValueChange={handleNavigation}>
          <TabsHighlight
            className="absolute z-0 inset-0 rounded-full bg-black/8 dark:bg-white/8"
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <TabsList className="flex items-center gap-2 md:gap-0">
              {filteredNavLinks.map((link) => {
                const Icon = iconMap[link.path];

                return (
                  <TabsHighlightItem key={link.path} value={link.path}>
                    <TabsTrigger
                      value={link.path}
                      asChild
                    >
                      <Link
                        href={link.path}
                        className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-full px-3.5 py-1.5 text-black/40 transition-colors duration-200 data-[state=active]:text-black dark:text-white/40 dark:data-[state=active]:text-white md:min-h-0 md:min-w-0 md:flex-row md:gap-2 md:px-5 md:py-2"
                      >
                        {Icon && <Icon className="h-[18px] w-[18px] md:h-[18px] md:w-[18px]" strokeWidth={1.5} />}
                        <span className="text-[9px] font-medium tracking-wide md:text-[11px]">
                          {link.name}
                        </span>
                      </Link>
                    </TabsTrigger>
                  </TabsHighlightItem>
                );
              })}
            </TabsList>
          </TabsHighlight>
        </Tabs>

        <div className="mx-2 h-8 w-px bg-black/10 dark:bg-white/10 md:mx-1" />

        <div ref={triggerRef}>
          <AskAIButton isOpen={isOpen} onToggle={toggle} />
        </div>

        <button
          onClick={toggleMode}
          className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-black/40 transition-colors duration-200 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70 md:h-9 md:w-9 md:min-h-0 md:min-w-0"
        >
          <SunIcon className="h-[18px] w-[18px] rotate-0 scale-100 transition-all duration-500 ease-in-out dark:-rotate-90 dark:scale-0 md:h-[22px] md:w-[22px]" />
          <MoonIcon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all duration-500 ease-in-out dark:rotate-0 dark:scale-100 md:h-[22px] md:w-[22px]" />
          <span className="sr-only">Toggle theme</span>
        </button>
      </div>
    </nav>
  );
}

export default NavigationBar;
