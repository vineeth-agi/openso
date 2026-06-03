/**
 * MCP Server Registry
 *
 * Defines which MCP servers are available for the agent to use.
 * Servers are conditionally enabled based on environment variables.
 *
 * Add new MCP servers here to instantly give the agent new capabilities.
 * Browse available servers at: https://github.com/modelcontextprotocol/servers
 */

import type { MCPServerConfig } from "./types";

/**
 * Get all configured MCP servers.
 * Only servers with required env vars set will be enabled.
 */
export function getMCPServers(): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];

  // ── Filesystem Server ──
  // Gives the agent read/write access to specified directories
  if (process.env.MCP_FILESYSTEM_PATHS) {
    const paths = process.env.MCP_FILESYSTEM_PATHS.split(",").map((p) => p.trim());
    servers.push({
      id: "filesystem",
      name: "Filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", ...paths],
      enabled: true,
      tags: ["files", "read", "write"],
    });
  }

  // ── Brave Search Server ──
  // Web search capabilities via Brave Search API
  if (process.env.BRAVE_API_KEY) {
    servers.push({
      id: "brave-search",
      name: "Brave Search",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY },
      enabled: true,
      tags: ["search", "web"],
    });
  }

  // ── Fetch Server ──
  // HTTP fetch capabilities for reading web pages/APIs
  servers.push({
    id: "fetch",
    name: "Fetch",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    enabled: !!process.env.MCP_ENABLE_FETCH,
    tags: ["web", "http", "api"],
  });

  // ── Memory Server ──
  // Knowledge graph-based persistent memory
  servers.push({
    id: "memory",
    name: "MCP Memory",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    enabled: !!process.env.MCP_ENABLE_MEMORY,
    tags: ["memory", "knowledge-graph"],
  });

  // ── Sequential Thinking Server ──
  // Structured reasoning and problem decomposition
  servers.push({
    id: "sequential-thinking",
    name: "Sequential Thinking",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    enabled: !!process.env.MCP_ENABLE_THINKING,
    tags: ["reasoning", "planning"],
  });

  // ── Custom/Remote MCP Servers ──
  // Parse MCP_SERVERS env var for user-defined servers
  // Format: JSON array of MCPServerConfig objects
  if (process.env.MCP_SERVERS) {
    try {
      const custom = JSON.parse(process.env.MCP_SERVERS) as MCPServerConfig[];
      for (const server of custom) {
        servers.push({ ...server, enabled: server.enabled ?? true });
      }
    } catch (err) {
      console.error("[MCP] Failed to parse MCP_SERVERS env var:", err);
    }
  }

  return servers;
}

/**
 * Get enabled MCP server configs filtered by tags.
 */
export function getMCPServersByTag(tag: string): MCPServerConfig[] {
  return getMCPServers().filter(
    (s) => s.enabled && s.tags?.includes(tag),
  );
}
