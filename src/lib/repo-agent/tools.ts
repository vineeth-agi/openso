/**
 * Repo Agent — Chat Tools
 *
 * Provides AI tools for querying a repo that's been indexed inside a Daytona sandbox.
 *
 * Tools:
 *   - search_repo_code  (sandbox): Semantic code search via ephemeral vector index
 *   - get_repo_structure (sandbox): Reads file_tree.txt and skeleton.json from the sandbox
 *   - read_repo_file    (sandbox): Live file read from sandbox
 */

import { tool } from "ai";
import { z } from "zod";

import { voyageEmbedRaw } from "@/lib/memory/embeddings";
import { getDaytonaClient } from "@/lib/tools/daytona-tools";

/**
 * Builds the repo agent tools for the chat agent.
 *
 * All tools require an active Daytona sandbox.
 */
export function buildRepoAgentTools(
  sandboxId: string,
  repoFullName: string,
) {
  return {
    search_repo_code: tool({
      description:
        "Semantically search the indexed codebase of the selected repository. " +
        "Returns the most relevant code chunks ranked by cosine similarity. " +
        "Use this to find where a feature is implemented, locate a bug, understand architecture, " +
        "or find all usages of a pattern. Always search first before reading files.",
      inputSchema: z.object({
        query: z.string().describe("Natural language search query — what to find in the codebase"),
        limit: z.number().int().min(1).max(20).default(10).describe("Number of results (default 10)"),
      }),
      execute: async ({ query, limit }) => {
        try {
          // 1. Embed the query with Voyage (code-tuned model)
          const queryEmbedding = await voyageEmbedRaw([query], "query", {
            model: "voyage-code-3",
          });
          if (!queryEmbedding[0] || queryEmbedding[0].length === 0) {
            return { status: "error", error: "Failed to embed search query" };
          }

          // 2. Send query vector to the sandbox search script
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          if (!sandbox) return { status: "error", error: "Sandbox not found" };

          // Write query vector to temp file
          await sandbox.fs.uploadFile(
            Buffer.from(JSON.stringify({ vector: queryEmbedding[0], limit }), "utf-8"),
            "query.json"
          );

          // Run the search script inside the sandbox
          const searchResult = await sandbox.process.executeCommand(
            `node -e '
const fs = require("fs");
const query = JSON.parse(fs.readFileSync("query.json", "utf-8"));
const store = JSON.parse(fs.readFileSync("vectors.json", "utf-8"));

function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

const results = store.chunks
  .map(chunk => ({
    filePath: chunk.filePath,
    content: chunk.content,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    tier: chunk.tier,
    similarity: cosineSim(query.vector, chunk.embedding),
  }))
  .sort((a, b) => b.similarity - a.similarity)
  .slice(0, query.limit);

console.log(JSON.stringify(results));
'`
          );

          if (searchResult.exitCode !== 0) {
            return {
              status: "error",
              error: `Search failed: ${(searchResult.result ?? "").slice(0, 500)}`,
            };
          }

          const results = JSON.parse(searchResult.result ?? "[]");
          return {
            status: "success",
            repo: repoFullName,
            resultCount: results.length,
            results: results.map((r: { filePath: string; content: string; startLine: number | null; endLine: number | null; tier: string; similarity: number }) => ({
              filePath: r.filePath,
              content: r.content.slice(0, 3000), // Cap content size
              startLine: r.startLine,
              endLine: r.endLine,
              tier: r.tier,
              similarity: Math.round(r.similarity * 1000) / 1000,
            })),
          };
        } catch (error) {
          console.error("[repo-agent] search_repo_code error:", error);
          return {
            status: "error",
            error: error instanceof Error ? error.message : "Search failed",
          };
        }
      },
    }),

    get_repo_structure: tool({
      description:
        "Get the file tree and skeleton of the selected repository from the sandbox. " +
        "Returns the file_tree.txt (list of all file paths) and skeleton.json " +
        "(structural overview of the codebase). " +
        "Use this once at the start of a chat to orient before any other tool call.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          if (!sandbox) return { status: "error", error: "Sandbox not found" };

          // Read file_tree.txt
          let fileTree = "";
          try {
            const treeBuffer = await sandbox.fs.downloadFile("file_tree.txt");
            fileTree = treeBuffer.toString("utf-8");
          } catch {
            // file_tree.txt may not exist yet
          }

          // Read skeleton.json
          let skeleton: unknown = null;
          try {
            const skelBuffer = await sandbox.fs.downloadFile("skeleton.json");
            skeleton = JSON.parse(skelBuffer.toString("utf-8"));
          } catch {
            // skeleton.json may not exist yet
          }

          return {
            status: "success",
            repoFullName,
            fileTree: fileTree.slice(0, 50000),
            skeleton,
          };
        } catch (error) {
          console.error("[repo-agent] get_repo_structure error:", error);
          return {
            status: "error",
            error: error instanceof Error ? error.message : "Failed to read repo structure",
          };
        }
      },
    }),

    read_repo_file: tool({
      description:
        "Read the full contents of a specific file from the repository in the sandbox. " +
        "Use this after search_repo_code points you to a file and you need to see the full context. " +
        "Optionally specify a line range to read only a portion.",
      inputSchema: z.object({
        filePath: z.string().describe("Relative path within the repo (e.g. 'src/lib/auth.ts')"),
        startLine: z.number().int().min(1).optional().describe("Start line (1-indexed, inclusive)"),
        endLine: z.number().int().min(1).optional().describe("End line (1-indexed, inclusive)"),
      }),
      execute: async ({ filePath, startLine, endLine }) => {
        try {
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          if (!sandbox) return { status: "error", error: "Sandbox not found" };

          const cleanPath = filePath.replace(/^repo\/?/, "");
          const fullPath = `repo/${cleanPath}`;

          if (startLine && endLine) {
            // Read specific line range
            const cmd = `sed -n '${startLine},${endLine}p' ${JSON.stringify(fullPath)}`;
            const result = await sandbox.process.executeCommand(cmd);
            return {
              status: result.exitCode === 0 ? "success" : "error",
              filePath: cleanPath,
              startLine,
              endLine,
              content: (result.result ?? "").slice(0, 20000),
            };
          }

          // Read full file
          const buffer = await sandbox.fs.downloadFile(fullPath);
          const content = buffer.toString("utf-8");
          return {
            status: "success",
            filePath: cleanPath,
            content: content.slice(0, 20000),
            totalLines: content.split("\n").length,
          };
        } catch (error) {
          return {
            status: "error",
            error: error instanceof Error ? error.message : "File read failed",
            filePath,
          };
        }
      },
    }),
  };
}
