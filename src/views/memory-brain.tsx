"use client";

import { useState, useCallback } from "react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
 Database } from "lucide-react";

import { ActivityTab } from '../features/memory/components/activity-tab';
import { DocumentsTab } from '../features/memory/components/documents-tab';
import { FactsTab } from '../features/memory/components/facts-tab';
import { GraphTab } from '../features/memory/components/graph-tab';
import { OverviewTab } from '../features/memory/components/overview-tab';
import { MemoryFact, UserProfile, GraphEntity, GraphRelationship, MemoryDocument, DreamCycleLog, AgentActivityItem } from '../features/memory/types';

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



export type TabId = "overview" | "facts" | "graph" | "documents" | "activity";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Brain },
  { id: "facts", label: "Core Facts", icon: Database },
  { id: "graph", label: "Knowledge Graph", icon: Network },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "activity", label: "Activity", icon: Activity },
];

export function MemoryBrainView() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const queryClient = useQueryClient();

  const { data: memoryData, isLoading: loading } = useQuery({
    queryKey: ['memory-brain'],
    queryFn: async () => {
      const [factsRes, profileRes, graphRes, docsRes, activitiesRes, dreamRes] = await Promise.all([
        fetch("/api/memory?view=all"),
        fetch("/api/memory?view=profile"),
        fetch("/api/memory?view=graph"),
        fetch("/api/memory?view=documents"),
        fetch("/api/memory?view=activities&limit=20"),
        fetch("/api/memory/dream-cycle"),
      ]);

      const [factsData, profileData, graphData, docsData, activitiesData, dreamData] = await Promise.all([
        factsRes.ok ? factsRes.json() : { facts: [] },
        profileRes.ok ? profileRes.json() : { profile: null },
        graphRes.ok ? graphRes.json() : { entities: [], relationships: [] },
        docsRes.ok ? docsRes.json() : { documents: [] },
        activitiesRes.ok ? activitiesRes.json() : { activities: [] },
        dreamRes.ok ? dreamRes.json() : { pendingBufferMessages: 0, recentDreamCycles: [] },
      ]);

      return {
        facts: factsData.facts ?? [] as MemoryFact[],
        profile: profileData.profile ?? null as UserProfile | null,
        entities: graphData.entities ?? [] as GraphEntity[],
        relationships: graphData.relationships ?? [] as GraphRelationship[],
        documents: docsData.documents ?? [] as MemoryDocument[],
        activities: activitiesData.activities ?? [] as AgentActivityItem[],
        dreamLogs: dreamData.recentDreamCycles ?? [] as DreamCycleLog[],
        pendingBuffer: dreamData.pendingBufferMessages ?? 0,
      };
    }
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/memory/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['memory-brain'] }), 3000);
    }
  });

  const deleteFactMutation = useMutation({
    mutationFn: async (factId: string) => {
      await fetch("/api/memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factId }),
      });
      return factId;
    },
    onSuccess: (factId) => {
      queryClient.setQueryData(['memory-brain'], (old: any) => old ? {
        ...old,
        facts: old.facts.filter((f: any) => f.id !== factId)
      } : old);
    }
  });

  const facts = memoryData?.facts ?? [];
  const profile = memoryData?.profile ?? null;
  const entities = memoryData?.entities ?? [];
  const relationships = memoryData?.relationships ?? [];
  const documents = memoryData?.documents ?? [];
  const activities = memoryData?.activities ?? [];
  const dreamLogs = memoryData?.dreamLogs ?? [];
  const pendingBuffer = memoryData?.pendingBuffer ?? 0;
  const syncing = syncMutation.isPending;

  const handleSync = () => syncMutation.mutate();
  const handleDeleteFact = (id: string) => deleteFactMutation.mutate(id);

  if (loading || !memoryData) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading memory...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <Brain className="size-4" />
            Memory Brain
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {facts.filter((f: MemoryFact) => f.isLatest).length} memories • {entities.length} entities • {documents.length} document chunks
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Sync Memory
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b px-4 sm:px-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap",
              activeTab === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {activeTab === "overview" && (
          <OverviewTab
            facts={facts}
            profile={profile}
            entities={entities}
            dreamLogs={dreamLogs}
            pendingBuffer={pendingBuffer}
          />
        )}
        {activeTab === "facts" && (
          <FactsTab facts={facts} onDelete={handleDeleteFact} />
        )}
        {activeTab === "graph" && (
          <GraphTab entities={entities} relationships={relationships} facts={facts} />
        )}
        {activeTab === "documents" && (
          <DocumentsTab documents={documents} />
        )}
        {activeTab === "activity" && (
          <ActivityTab activities={activities} />
        )}
      </div>
    </div>
  );
}
