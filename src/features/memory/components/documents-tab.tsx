"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

import {
  Brain,
  Trash2,
  RefreshCw,
  Loader2,
  Search,
  Circle,
  Activity,
  Network,
  FileText,
  Zap,
  Heart,
  Clock,
  TrendingUp,
  Eye,
  ChevronRight,
  Sparkles,
  BookOpen,
  Users,
  GitBranch,
} from "lucide-react";

import { CATEGORY_COLORS, ENTITY_TYPE_COLORS, SOURCE_LABELS } from '../constants';
import { MemoryFact, UserProfile, GraphEntity, GraphRelationship, MemoryDocument, DreamCycleLog, AgentActivityItem } from '../types';

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";



export function DocumentsTab({ documents }: { documents: MemoryDocument[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, MemoryDocument[]>();
    for (const doc of documents) {
      const key = `${doc.source}:${doc.sourceId}`;
      const existing = map.get(key) ?? [];
      existing.push(doc);
      map.set(key, existing);
    }
    return Array.from(map.entries()).map(([key, chunks]) => ({
      key,
      source: chunks[0].source,
      sourceId: chunks[0].sourceId,
      title: chunks[0].title,
      chunks: chunks.length,
      totalChars: chunks.reduce((s, c) => s + c.content.length, 0),
    }));
  }, [documents]);

  const SOURCE_ICONS: Record<string, string> = {
    github_repo: "🗂️",
    email_thread: "📧",
    resume: "📄",
    problem_editorial: "📝",
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {grouped.length} indexed documents ({documents.length} total chunks)
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {grouped.map((doc) => (
          <div key={doc.key} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-2.5">
              <span className="text-lg">{SOURCE_ICONS[doc.source] ?? "📄"}</span>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium text-foreground truncate">{doc.title}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {doc.source.replace(/_/g, " ")} • {doc.chunks} chunks • {(doc.totalChars / 1000).toFixed(1)}k chars
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {grouped.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="size-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No documents indexed yet</p>
          <p className="text-xs text-muted-foreground mt-1">Connect GitHub or sync emails to index knowledge</p>
        </div>
      )}
    </div>
  );
}
