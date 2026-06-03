import { generateObject } from "ai";
import { z } from "zod";

import { google } from "@/lib/ai/google-provider";

function getModel() {
  return google();
}

export interface ExtractedEntity {
  name: string;
  entityType: "person" | "company" | "technology" | "project" | "location" | "concept" | "event" | "role";
  description?: string;
  attributes?: Record<string, string>;
}

export interface ExtractedRelationship {
  sourceEntity: string;       // entity name
  sourceType: string;         // entity type
  targetEntity: string;       // entity name
  targetType: string;         // entity type
  relationshipType: string;   // e.g. "works_at", "uses", "knows"
}

export interface GraphExtraction {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

const GraphSchema = z.object({
  entities: z.array(z.object({
    name: z.string(),
    entityType: z.enum(["person", "company", "technology", "project", "location", "concept", "event", "role"]),
    description: z.string().optional(),
  })),
  relationships: z.array(z.object({
    sourceEntity: z.string(),
    sourceType: z.string(),
    targetEntity: z.string(),
    targetType: z.string(),
    relationshipType: z.string(),
  })),
});

/**
 * Extract entities and relationships from a conversation.
 * This processes BOTH user and assistant messages for maximum coverage.
 *
 * Inspired by mem0's graph store — entities are nodes, relationships are edges.
 * The LLM identifies people, companies, technologies, projects, etc.
 * and the connections between them.
 */
export async function extractGraph(
  conversationText: string,
  context?: string,
): Promise<GraphExtraction> {
  const prompt = `You are a knowledge graph extraction engine. Analyze the conversation and extract entities and relationships.

Rules:
1. Extract entities mentioned in the conversation: people, companies, technologies, projects, locations, concepts, events, roles.
2. Extract relationships between entities: who works where, what technology is used in which project, etc.
3. The "user" is always an implicit entity — extract their relationships to other entities.
4. Be precise: only extract what is explicitly stated or strongly implied.
5. Normalize entity names: "React.js" and "React" → "React", "JS" and "JavaScript" → "JavaScript".
6. Use lowercase snake_case for relationship types: "works_at", "uses", "knows", "interested_in", "skilled_in", "manages", "part_of", "located_in".

Entity types: person, company, technology, project, location, concept, event, role

${context ? `Context: ${context}` : ""}

If no meaningful entities/relationships can be extracted, return empty arrays.`;

  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: GraphSchema,
      prompt: `${prompt}\n\nConversation:\n${conversationText}`,
    });

    const entities: ExtractedEntity[] = object.entities.map((e) => ({
      name: e.name.trim(),
      entityType: e.entityType,
      description: e.description,
    }));

    const relationships: ExtractedRelationship[] = object.relationships.map((r) => ({
      sourceEntity: r.sourceEntity.trim(),
      sourceType: r.sourceType,
      targetEntity: r.targetEntity.trim(),
      targetType: r.targetType,
      relationshipType: r.relationshipType.toLowerCase().replace(/\s+/g, "_"),
    }));

    return { entities, relationships };
  } catch {
    return { entities: [], relationships: [] };
  }
}

