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



export function FactsTab({
  facts,
  onDelete,
}: {
  facts: MemoryFact[];
  onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filtered = useMemo(() => {
    return facts.filter((f) => {
      if (!f.isLatest) return false;
      if (categoryFilter !== "all" && f.category !== categoryFilter) return false;
      if (search && !f.fact.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [facts, categoryFilter, search]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search memories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-40" size="sm">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.keys(CATEGORY_COLORS).map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} facts</span>
      </div>

      {/* Fact Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.slice(0, 30).map((fact) => (
          <div key={fact.id} className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-border/80 hover:shadow-sm">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <Badge variant="outline" className={cn("text-xs px-1.5 py-0", CATEGORY_COLORS[fact.category])}>
                {fact.category}
              </Badge>
              <button
                onClick={() => onDelete(fact.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {/* Fact text */}
            <p className="mt-2 text-xs leading-relaxed text-foreground line-clamp-3">{fact.fact}</p>

            {/* Metadata */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {SOURCE_LABELS[fact.source] ?? fact.source}
              </span>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs text-muted-foreground">
                {(fact.confidence * 100).toFixed(0)}% conf
              </span>
              {fact.emotionalValence && fact.emotionalValence !== "neutral" && (
                <>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs">
                    {fact.emotionalValence === "positive" ? "😊" : "😔"}
                    {((fact.emotionalIntensity ?? 0) * 100).toFixed(0)}%
                  </span>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{timeAgo(fact.createdAt)}</span>
              <div className="flex items-center gap-2">
                {fact.accessCount > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Eye className="size-2.5" />{fact.accessCount}
                  </span>
                )}
                {fact.halfLifeDays && (
                  <span className="flex items-center gap-0.5">
                    <Clock className="size-2.5" />{fact.halfLifeDays}d
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Brain className="size-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No memories match your search</p>
        </div>
      )}
    </div>
  );
}
