/**
 * MCP Module — Public API
 *
 * Usage:
 *   import { discoverMCPTools, getMCPServers } from "@/lib/mcp";
 *   const { tools } = await discoverMCPTools(getMCPServers());
 */

export { discoverMCPTools, disconnectAll, getConnectionStatus, mcpToolsToAiTools } from "./client";
export { getMCPServers, getMCPServersByTag } from "./servers";
export type {
  MCPServerConfig,
  MCPTool,
  MCPToolCallResult,
  MCPResource,
  MCPServerRegistry,
  MCPTransport,
} from "./types";
