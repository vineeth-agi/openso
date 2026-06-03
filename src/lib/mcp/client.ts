/**
 * MCP Client — Universal Tool Discovery & Execution
 *
 * Connects to MCP servers (stdio or streamable-http), discovers tools,
 * and converts them into Vercel AI SDK compatible tool definitions.
 *
 * This replaces custom tool integrations with the MCP standard,
 * giving the agent access to thousands of community MCP servers.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tool as aiTool } from "ai";
import { z } from "zod";

import type {
  MCPServerConfig,
  MCPTool,
  MCPToolCallResult,
} from "./types";

import { createAdminClient } from "@/lib/insforge/admin";

// ── Connection Pool ──

interface PooledConnection {
  client: Client;
  config: MCPServerConfig;
  tools: MCPTool[];
  connectedAt: number;
  lastUsed: number;
}

const connectionPool = new Map<string, PooledConnection>();
const CONNECTION_TTL_MS = 5 * 60 * 1000; // 5 minutes idle timeout

// ── Core Client ──

/**
 * Connect to an MCP server, returning a pooled or fresh connection.
 */
async function connectToServer(
  config: MCPServerConfig,
  userId?: string
): Promise<PooledConnection> {
  // Return pooled connection if still alive
  const existing = connectionPool.get(config.id);
  if (existing && Date.now() - existing.lastUsed < CONNECTION_TTL_MS) {
    existing.lastUsed = Date.now();
    return existing;
  }

  // Clean up stale connection
  if (existing) {
    try { await existing.client.close(); } catch { /* ignore */ }
    connectionPool.delete(config.id);
  }

  const headers = config.headers ?? {};

  const client = new Client(
    { name: "jarvis-agent", version: "1.0.0" },
    { capabilities: {} },
  );

  let transport;
  if (config.transport === "stdio") {
    if (!config.command) throw new Error(`MCP server ${config.id}: stdio transport requires 'command'`);
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
    });
  } else if (config.transport === "streamable-http") {
    if (!config.url) throw new Error(`MCP server ${config.id}: streamable-http transport requires 'url'`);
    transport = new StreamableHTTPClientTransport(
      new URL(config.url),
      { requestInit: { headers } },
    );
  } else {
    throw new Error(`MCP server ${config.id}: unsupported transport '${config.transport}'`);
  }

  await client.connect(transport);

  // Discover tools
  const toolsResult = await client.listTools();
  const tools: MCPTool[] = (toolsResult.tools ?? []).map((t) => {
    // Ensure schema has explicit type: "object" for compatibility
    const rawSchema = t.inputSchema as Record<string, unknown>;
    const inputSchema: MCPTool["inputSchema"] = {
      type: "object",
      properties: (rawSchema?.properties as Record<string, unknown>) ?? {},
      required: Array.isArray(rawSchema?.required) ? (rawSchema.required as string[]) : [],
    };
    return {
      name: t.name,
      description: t.description,
      inputSchema,
      serverId: config.id,
      serverName: config.name,
    };
  });

  const pooled: PooledConnection = {
    client,
    config,
    tools,
    connectedAt: Date.now(),
    lastUsed: Date.now(),
  };

  connectionPool.set(config.id, pooled);
  console.log(`[MCP] Connected to ${config.name} — discovered ${tools.length} tools`);
  return pooled;
}

/**
 * Call a tool on an MCP server.
 */
async function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<MCPToolCallResult> {
  const conn = connectionPool.get(serverId);
  if (!conn) throw new Error(`MCP server ${serverId} not connected`);

  conn.lastUsed = Date.now();
  const result = await conn.client.callTool({ name: toolName, arguments: args });

  return {
    content: (result.content as MCPToolCallResult["content"]) ?? [],
    isError: result.isError as boolean | undefined,
  };
}

// ── Vercel AI SDK Bridge ──

/**
 * Convert MCP JSON Schema to Zod schema for Vercel AI SDK.
 */
function jsonSchemaToZod(schema: MCPTool["inputSchema"]): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  const required = new Set(schema?.required ?? []);

  for (const [key, prop] of Object.entries(schema?.properties ?? {})) {
    const p = prop as Record<string, unknown>;
    const propType = p.type as string;
    let field: z.ZodType;

    switch (propType) {
      case "string":
        field = p.enum
          ? z.enum(p.enum as [string, ...string[]])
          : z.string();
        break;
      case "number":
      case "integer":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      case "array":
        field = z.array(z.unknown());
        break;
      case "object":
        field = z.record(z.string(), z.unknown());
        break;
      default:
        field = z.unknown();
    }

    if (p.description && typeof field.describe === "function") {
      field = field.describe(p.description as string);
    }

    if (!required.has(key)) {
      field = field.optional();
    }

    shape[key] = field;
  }

  return z.object(shape);
}

/**
 * Convert discovered MCP tools into Vercel AI SDK tool definitions.
 * These can be spread directly into the `tools` parameter of `streamText()`.
 */
export function mcpToolsToAiTools(
  mcpTools: MCPTool[],
): Record<string, ReturnType<typeof aiTool>> {
  const result: Record<string, ReturnType<typeof aiTool>> = {} as Record<string, ReturnType<typeof aiTool>>;

  for (const t of mcpTools) {
    // Namespace tool names to avoid collisions: mcp_serverId_toolName
    const toolKey = `mcp_${t.serverId}_${t.name}`;

    result[toolKey] = aiTool({
      description: `[MCP:${t.serverName}] ${t.description ?? t.name}`,
      inputSchema: jsonSchemaToZod(t.inputSchema),
      execute: async (args: Record<string, unknown>) => {
        try {
          const callResult = await callTool(t.serverId, t.name, args);

          if (callResult.isError) {
            const errorText = callResult.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            return { error: errorText || "MCP tool returned an error" };
          }

          // Flatten text content for the AI
          const texts = callResult.content
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "");

          if (texts.length === 1) return { result: texts[0] };
          if (texts.length > 1) return { results: texts };

          // Return raw content for non-text types
          return { content: callResult.content };
        } catch (err) {
          console.error(`[MCP] Tool call failed: ${toolKey}`, err);
          return { error: err instanceof Error ? err.message : "MCP tool call failed" };
        }
      },
    }) as unknown as ReturnType<typeof aiTool>;
  }

  return result;
}

// ── Public API ──

/**
 * Connect to multiple MCP servers and return all discovered tools
 * as Vercel AI SDK compatible tool definitions.
 *
 * Usage in chat route:
 * ```ts
 * const mcpTools = await discoverMCPTools(getMCPServers(), userId);
 * allTools = { ...nativeTools, ...mcpTools };
 * ```
 */
export async function discoverMCPTools(
  configs: MCPServerConfig[],
  userId?: string,
): Promise<{
  tools: Record<string, ReturnType<typeof aiTool>>;
  discoveredTools: MCPTool[];
  errors: Array<{ serverId: string; error: string }>;
}> {
  const allTools: MCPTool[] = [];
  const errors: Array<{ serverId: string; error: string }> = [];

  const results = await Promise.allSettled(
    configs
      .filter((c) => c.enabled)
      .map(async (config) => {
        const conn = await connectToServer(config, userId);
        return conn.tools;
      }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const config = configs.filter((c) => c.enabled)[i];
    if (result.status === "fulfilled") {
      allTools.push(...result.value);
    } else {
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`[MCP] Failed to connect to ${config.name}:`, errMsg);
      errors.push({ serverId: config.id, error: errMsg });
    }
  }

  return {
    tools: mcpToolsToAiTools(allTools),
    discoveredTools: allTools,
    errors,
  };
}

/**
 * Disconnect all pooled MCP servers. Call on process shutdown.
 */
export async function disconnectAll(): Promise<void> {
  for (const [id, conn] of connectionPool) {
    try {
      await conn.client.close();
    } catch { /* ignore */ }
    connectionPool.delete(id);
  }
}

/**
 * Get the current state of all connections for debugging/UI.
 */
export function getConnectionStatus(): Array<{
  serverId: string;
  serverName: string;
  connected: boolean;
  toolCount: number;
  connectedAt: number;
  lastUsed: number;
}> {
  return Array.from(connectionPool.values()).map((conn) => ({
    serverId: conn.config.id,
    serverName: conn.config.name,
    connected: true,
    toolCount: conn.tools.length,
    connectedAt: conn.connectedAt,
    lastUsed: conn.lastUsed,
  }));
}
