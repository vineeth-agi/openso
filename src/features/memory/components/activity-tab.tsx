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



export function ActivityTab({ activities }: { activities: AgentActivityItem[] }) {
  const STATUS_COLORS: Record<string, string> = {
    completed: "bg-emerald-500",
    pending: "bg-amber-500",
    failed: "bg-red-500",
    dismissed: "bg-muted-foreground",
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{activities.length} recent activities</p>

      <div className="space-y-2">
        {activities.map((act) => (
          <div key={act.id} className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className={cn("size-2 rounded-full mt-1.5 shrink-0", STATUS_COLORS[act.status] ?? "bg-muted-foreground")} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-foreground truncate">{act.title}</h4>
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">
                  {(act.activity_type ?? "unknown").replace(/_/g, " ")}
                </Badge>
              </div>
              {act.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{act.description}</p>
              )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{timeAgo(act.created_at)}</span>
          </div>
        ))}
      </div>

      {activities.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Zap className="size-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No agent activity yet</p>
        </div>
      )}
    </div>
  );
}
