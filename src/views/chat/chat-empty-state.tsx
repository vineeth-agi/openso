"use client";

import {
  Bug,
  Code,
  FolderGit2,
  Globe,
  Search,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  {
    label: "Find easy issues",
    prompt: "Find Python good first issues to contribute to",
    icon: Bug,
  },
  {
    label: "Beginner bugs",
    prompt: "Search for TypeScript beginner-friendly bugs",
    icon: Code,
  },
  {
    label: "Rust unassigned",
    prompt: "Find unassigned Rust issues",
    icon: Search,
  },
  {
    label: "Go docs issues",
    prompt: "Search for Go documentation issues to help with",
    icon: FolderGit2,
  },
];

function EmptyState({ onSend }: { onSend: (prompt: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 pb-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-b from-primary/20 to-primary/5 ring-1 ring-primary/10">
        <Sparkles className="h-5 w-5 text-primary" />
      </div>

      <h2 className="mt-4 text-lg font-semibold tracking-tight">
        How can I help you today?
      </h2>
      <p className="mt-1.5 max-w-sm text-center text-[13px] leading-relaxed text-muted-foreground">
        Find open-source issues to contribute to across TypeScript, Python, Rust, Go, and more.
      </p>

      <div className="mt-6 grid w-full max-w-lg grid-cols-2 gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onSend(s.prompt)}
            className={cn(
              "group flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/50 px-3.5 py-2.5 text-left",
              "transition-all duration-200",
              "hover:border-primary/25 hover:bg-accent/60 hover:shadow-sm"
            )}
          >
            <s.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary" />
            <span className="text-xs font-medium text-foreground/80 group-hover:text-foreground">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scroll to Bottom Button

export { EmptyState };
