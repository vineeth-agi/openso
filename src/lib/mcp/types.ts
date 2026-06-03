/**
 * MCP (Model Context Protocol) Types
 *
 * Defines the type system for MCP server configurations,
 * tool discovery, and execution results.
 */

// ── Server Configuration ──

export type MCPTransport = "stdio" | "streamable-http";

export interface MCPServerConfig {
  /** Unique identifier for this server */
  id: string;
  /** Human-readable name */
  name: string;
  /** Transport type */
  transport: MCPTransport;
  /** For stdio: the command to spawn */
  command?: string;
  /** For stdio: arguments to pass */
  args?: string[];
  /** For stdio: environment variables */
  env?: Record<string, string>;
  /** For streamable-http: the URL */
  url?: string;
  /** For streamable-http: headers */
  headers?: Record<string, string>;
  /** Whether this server is enabled */
  enabled: boolean;
  /** Tags for categorizing servers */
  tags?: string[];
}

// ── Tool Discovery ──

export interface MCPToolSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: MCPToolSchema;
  /** Which MCP server provides this tool */
  serverId: string;
  serverName: string;
}

// ── Execution ──

export interface MCPToolCallResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

// ── Resource Discovery ──

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverId: string;
}

// ── Registry ──

export interface MCPServerRegistry {
  servers: MCPServerConfig[];
  version: string;
  updatedAt: string;
}
