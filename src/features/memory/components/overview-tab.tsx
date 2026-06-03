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



export function OverviewTab({
  facts,
  profile,
  entities,
  dreamLogs,
  pendingBuffer,
}: {
  facts: MemoryFact[];
  profile: UserProfile | null;
  entities: GraphEntity[];
  dreamLogs: DreamCycleLog[];
  pendingBuffer: number;
}) {
  const latestFacts = facts.filter((f) => f.isLatest);
  const categories = new Set(latestFacts.map((f) => f.category));
  const sources = new Set(latestFacts.map((f) => f.source));
  const emotionalFacts = latestFacts.filter((f) => f.emotionalValence && f.emotionalValence !== "neutral");
  const avgConfidence = latestFacts.length > 0
    ? (latestFacts.reduce((s, f) => s + f.confidence, 0) / latestFacts.length * 100).toFixed(0)
    : "0";

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {[
          { label: "Active Facts", value: latestFacts.length, icon: Brain },
          { label: "Categories", value: categories.size, icon: Activity },
          { label: "Sources", value: sources.size, icon: GitBranch },
          { label: "Entities", value: entities.length, icon: Users },
          { label: "Avg Confidence", value: `${avgConfidence}%`, icon: TrendingUp },
          { label: "Pending Buffer", value: pendingBuffer, icon: Clock },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.icon className="size-3.5" />
              <span className="text-xs font-medium uppercase tracking-wider">{stat.label}</span>
            </div>
            <p className="mt-1.5 text-xl font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Profile Summary */}
      {profile?.summary && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">AI Profile Summary</h3>
            {profile.lastComputedAt && (
              <span className="text-xs text-muted-foreground ml-auto">
                Updated {timeAgo(profile.lastComputedAt)}
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{profile.summary}</p>
        </div>
      )}

      {/* Two-column: Recent Facts + Emotional Highlights */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent Facts */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <Clock className="size-4 text-muted-foreground" />
            Recent Memories
          </h3>
          <div className="space-y-2">
            {latestFacts.slice(0, 6).map((fact) => (
              <div key={fact.id} className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 shrink-0 mt-0.5", CATEGORY_COLORS[fact.category])}>
                  {fact.category}
                </Badge>
                <p className="text-xs text-foreground line-clamp-2 flex-1">{fact.fact}</p>
                <span className="text-xs text-muted-foreground shrink-0">{timeAgo(fact.createdAt)}</span>
              </div>
            ))}
            {latestFacts.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No memories yet. Start chatting to build your memory.</p>
            )}
          </div>
        </div>

        {/* Emotional Highlights */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <Heart className="size-4 text-pink-500" />
            Emotional Memories
          </h3>
          <div className="space-y-2">
            {emotionalFacts.slice(0, 6).map((fact) => (
              <div key={fact.id} className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                <span className="text-sm shrink-0 mt-0.5">
                  {fact.emotionalValence === "positive" ? "😊" : "😔"}
                </span>
                <p className="text-xs text-foreground line-clamp-2 flex-1">{fact.fact}</p>
                <span className="text-xs text-muted-foreground shrink-0">
                  {((fact.emotionalIntensity ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
            {emotionalFacts.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No emotional memories detected yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Dream Cycle Activity */}
      {dreamLogs.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <Activity className="size-4 text-muted-foreground" />
            Recent Dream Cycles
          </h3>
          <div className="space-y-2">
            {dreamLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground w-20 shrink-0">{timeAgo(log.created_at)}</span>
                <Badge variant="secondary" className="text-xs">{log.cycle_type}</Badge>
                <span className="text-muted-foreground">
                  +{log.facts_created} facts, +{log.observations_created} obs
                  {log.observations_pruned > 0 && `, -${log.observations_pruned} pruned`}
                </span>
                <span className="ml-auto text-muted-foreground">{log.duration_ms}ms</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
