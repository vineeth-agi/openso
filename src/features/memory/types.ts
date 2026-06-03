export interface MemoryFact {
  id: string;
  category: string;
  fact: string;
  source: string;
  sourceId: string | null;
  memoryType: string;
  confidence: number;
  importance: number;
  accessCount: number;
  isLatest: boolean;
  supersededBy: string | null;
  emotionalValence?: string | null;
  emotionalIntensity?: number;
  halfLifeDays?: number;
  retrievalCount?: number;
  eventTime?: string | null;
  validUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  staticFacts: string[];
  dynamicFacts: string[];
  summary: string;
  lastComputedAt: string;
  version: number;
}

export interface GraphEntity {
  id: string;
  name: string;
  entityType: string;
  description: string | null;
  mentionCount: number;
  lastMentionedAt: string;
}

export interface GraphRelationship {
  id: string;
  sourceEntityId: string;
  sourceName: string;
  sourceType: string;
  targetEntityId: string;
  targetName: string;
  targetType: string;
  relationshipType: string;
  strength: number;
}

export interface MemoryDocument {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
}

export interface DreamCycleLog {
  id: string;
  user_id: string;
  cycle_type: string;
  facts_created: number;
  facts_updated: number;
  observations_created: number;
  observations_pruned: number;
  duration_ms: number;
  created_at: string;
}

export interface AgentActivityItem {
  id: string;
  activity_type: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  scheduled_for: string;
  created_at: string;
}
