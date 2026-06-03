// @ts-nocheck
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



interface GraphNode {
  id: string;
  label: string;
  color: string;
  size: number;
  nodeType: "center" | "entity" | "fact";
  entityType?: string;
  data?: GraphEntity | MemoryFact;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  label?: string;
  strength?: number;
  isCenter?: boolean;
}

export function GraphTab({
  entities,
  relationships,
  facts,
}: {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  facts: MemoryFact[];
}) {
  const [selectedNode, setSelectedNode] = useState<{ type: "entity" | "fact"; data: GraphEntity | MemoryFact } | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- react-force-graph-2d has no exported component type
  const [ForceGraph, setForceGraph] = useState<React.ComponentType<any> | null>(null);

  // Dynamically import react-force-graph-2d (no SSR)
  useEffect(() => {
    import("react-force-graph-2d").then((mod) => {
      setForceGraph(() => mod.default);
    });
  }, []);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const entityTypes = useMemo(() => {
    return Array.from(new Set(entities.map((e) => e.entityType))).sort();
  }, [entities]);

  // Build graph data for force-graph
  const graphData = useMemo(() => {
    const TYPE_COLORS: Record<string, string> = {
      person: "#3b82f6",
      company: "#22c55e",
      technology: "#06b6d4",
      project: "#8b5cf6",
      location: "#f59e0b",
      concept: "#ec4899",
      event: "#ef4444",
      role: "#6366f1",
    };

    const FACT_COLORS: Record<string, string> = {
      personal: "#6366f1",
      professional: "#22c55e",
      technical: "#3b82f6",
      preference: "#ec4899",
      behavioral: "#14b8a6",
      goal: "#f59e0b",
      outcome: "#8b5cf6",
    };

    // Filter entities
    const filteredEntities = typeFilter === "all"
      ? entities
      : entities.filter((e) => e.entityType === typeFilter);

    // Limit to top 80 entities by mention count
    const visibleEntities = [...filteredEntities]
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 80);

    const visibleEntityIds = new Set(visibleEntities.map((e) => e.id));

    // Top 15 facts for the inner ring
    const topFacts = facts.filter((f) => f.isLatest).slice(0, 15);

    // Build nodes
    const nodes: GraphNode[] = [
      // Central "You" node
      {
        id: "you",
        label: "You",
        color: "#6366f1",
        size: 12,
        nodeType: "center",
      },
      // Entity nodes
      ...visibleEntities.map((e) => ({
        id: e.id,
        label: e.name,
        color: TYPE_COLORS[e.entityType] ?? "#6b7280",
        size: Math.min(8, 3 + e.mentionCount * 0.5),
        nodeType: "entity",
        entityType: e.entityType,
        data: e,
      })),
      // Fact nodes
      ...topFacts.map((f) => ({
        id: `fact-${f.id}`,
        label: f.fact.length > 30 ? f.fact.slice(0, 30) + "…" : f.fact,
        color: FACT_COLORS[f.category] ?? "#6b7280",
        size: 2.5,
        nodeType: "fact",
        data: f,
      })),
    ];

    // Build links
    const links: GraphLink[] = [];

    // Entity-to-entity relationships
    for (const rel of relationships) {
      if (visibleEntityIds.has(rel.sourceEntityId) && visibleEntityIds.has(rel.targetEntityId)) {
        links.push({
          source: rel.sourceEntityId,
          target: rel.targetEntityId,
          label: rel.relationshipType,
          strength: rel.strength,
        });
      }
    }

    // Connect entities to center with weak links (for clustering)
    for (const e of visibleEntities) {
      links.push({
        source: "you",
        target: e.id,
        strength: 0.05,
        isCenter: true,
      });
    }

    // Connect facts to center
    for (const f of topFacts) {
      links.push({
        source: "you",
        target: `fact-${f.id}`,
        strength: 0.1,
        isCenter: true,
      });
    }

    return { nodes, links };
  }, [entities, relationships, facts, typeFilter]);

  if (!ForceGraph) {
    return (
      <div className="flex h-[400px] sm:h-[600px] items-center justify-center rounded-xl border border-border bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entities.length === 0 && facts.filter((f) => f.isLatest).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Network className="size-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-foreground">No knowledge graph yet</p>
        <p className="text-xs text-muted-foreground mt-1">Chat more to build your knowledge graph</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-44" size="sm">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types ({entities.length})</SelectItem>
              {entityTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type} ({entities.filter((e) => e.entityType === type).length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {graphData.nodes.length} nodes • {graphData.links.length} links
            {entities.length > 80 && ` (showing top 80 of ${entities.length})`}
          </span>
        </div>

        {/* Legend */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Circle className="size-2 fill-blue-400 text-blue-400" />Person</span>
          <span className="flex items-center gap-1"><Circle className="size-2 fill-green-400 text-green-400" />Company</span>
          <span className="flex items-center gap-1"><Circle className="size-2 fill-cyan-400 text-cyan-400" />Tech</span>
          <span className="flex items-center gap-1"><Circle className="size-2 fill-purple-400 text-purple-400" />Project</span>
          <span className="flex items-center gap-1"><Circle className="size-2 fill-amber-400 text-amber-400" />Location</span>
        </div>
      </div>

      {/* Graph Canvas */}
      <div ref={containerRef} className="h-[400px] sm:h-[600px] rounded-xl border border-border bg-background overflow-hidden">
        <ForceGraph
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          backgroundColor="#0a0a0f"
          nodeLabel={(node: GraphNode) => node.label}
          nodeColor={(node: GraphNode) => node.color}
          nodeVal={(node: GraphNode) => node.size}
          nodeCanvasObject={(node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const label = node.label;
            const size = node.size || 4;
            const fontSize = Math.max(10 / globalScale, 1.5);

            // Draw node circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
            ctx.fillStyle = node.color + (node.nodeType === "fact" ? "88" : "cc");
            ctx.fill();

            // Glow for center node
            if (node.nodeType === "center") {
              ctx.shadowColor = node.color;
              ctx.shadowBlur = 15;
              ctx.beginPath();
              ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
              ctx.fillStyle = node.color;
              ctx.fill();
              ctx.shadowBlur = 0;
            }

            // Draw label (only when zoomed in enough)
            if (globalScale > 0.8 || node.nodeType === "center" || node.size > 5) {
              ctx.font = `${node.nodeType === "center" ? "bold " : ""}${fontSize}px Sans-Serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillStyle = "#e2e8f0";
              ctx.fillText(label, node.x, node.y + size + fontSize + 1);
            }
          }}
          linkColor={(link: GraphLink) => link.isCenter ? "#ffffff08" : "#ffffff22"}
          linkWidth={(link: GraphLink) => link.isCenter ? 0.2 : Math.max(0.5, (link.strength || 0.5) * 2)}
          linkDirectionalParticles={(link: GraphLink) => link.isCenter ? 0 : link.strength > 0.7 ? 2 : 0}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleColor={() => "#6366f1"}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          cooldownTicks={100}
          onNodeClick={(node: GraphNode) => {
            if (node.nodeType === "center") return;
            if (node.nodeType === "entity") {
              setSelectedNode({ type: "entity", data: node.data });
            } else if (node.nodeType === "fact") {
              setSelectedNode({ type: "fact", data: node.data });
            }
          }}
          onBackgroundClick={() => setSelectedNode(null)}
        />
      </div>

      {/* Selected Node Detail Panel */}
      {selectedNode && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {selectedNode.type === "entity" ? (
                <Badge className={cn("text-xs", ENTITY_TYPE_COLORS[(selectedNode.data as GraphEntity).entityType] ?? "")}>
                  {(selectedNode.data as GraphEntity).entityType}
                </Badge>
              ) : (
                <Badge className={cn("text-xs", CATEGORY_COLORS[(selectedNode.data as MemoryFact).category] ?? "")}>
                  {(selectedNode.data as MemoryFact).category}
                </Badge>
              )}
              <h4 className="text-sm font-semibold">
                {selectedNode.type === "entity"
                  ? (selectedNode.data as GraphEntity).name
                  : "Memory Fact"}
              </h4>
            </div>
            <button onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>

          {selectedNode.type === "entity" ? (
            <div className="mt-2 space-y-1.5">
              {(selectedNode.data as GraphEntity).description && (
                <p className="text-xs text-muted-foreground">{(selectedNode.data as GraphEntity).description}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Mentioned {(selectedNode.data as GraphEntity).mentionCount} times • Last: {timeAgo((selectedNode.data as GraphEntity).lastMentionedAt)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {relationships
                  .filter((r) => r.sourceEntityId === (selectedNode.data as GraphEntity).id || r.targetEntityId === (selectedNode.data as GraphEntity).id)
                  .slice(0, 8)
                  .map((rel) => {
                    const isSource = rel.sourceEntityId === (selectedNode.data as GraphEntity).id;
                    return (
                      <Badge key={rel.id} variant="outline" className="text-[9px] gap-1">
                        {rel.relationshipType.replace(/_/g, " ")} → {isSource ? rel.targetName : rel.sourceName}
                      </Badge>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-1.5">
              <p className="text-xs text-foreground">{(selectedNode.data as MemoryFact).fact}</p>
              <p className="text-xs text-muted-foreground">
                Source: {SOURCE_LABELS[(selectedNode.data as MemoryFact).source] ?? (selectedNode.data as MemoryFact).source} •
                Confidence: {((selectedNode.data as MemoryFact).confidence * 100).toFixed(0)}% •
                {timeAgo((selectedNode.data as MemoryFact).createdAt)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
