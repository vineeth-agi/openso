import { Daytona } from "@daytonaio/sdk";
import { tool } from "ai";
import { z } from "zod";

import { getConnectionAdmin } from "@/lib/connections";

/**
 * Ensures the Daytona instance is initialized with correct environment variables
 */
export function getDaytonaClient() {
  const apiKey = process.env.DAYTONA_API_KEY;
  const serverUrl = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";
  
  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is not set.");
  }
  
  const options: Record<string, string> = { apiKey, serverUrl };
  options.target = process.env.DAYTONA_TARGET || "eu";
  
  return new Daytona(options as any);
}

/**
 * Builds the Daytona code execution sandboxing tools.
 */
export function buildDaytonaTools(userId: string) {
  return {
    create_sandbox: tool({
      description: "Create a new isolated code execution sandbox using Daytona. Available languages/environments include 'typescript', 'python', 'javascript', 'go', 'rust'. Returns a sandboxId that you MUST use for subsequent code execution tools. Ensure to delete the sandbox when you are fully done.",
      inputSchema: z.object({
        language: z.string().describe("Language environment to initialize (e.g., 'python', 'typescript')"),
      }),
      execute: async ({ language }) => {
        try {
          const daytona = getDaytonaClient();
          
          // Fetch GitHub token before creating sandbox so we can inject via envVars.
          // Use `getConnectionAdmin` so encrypted (`enc:v1:`) columns are
          // decrypted before reaching the sandbox env (DB-HIGH-01).
          let githubToken = "";
          let githubUsername = "bot";
          try {
            const ghConn = await getConnectionAdmin(userId, "github");
            if (ghConn?.access_token) {
              githubToken = ghConn.access_token;
              githubUsername = ghConn.github_username || "bot";
            }
          } catch (e) {
            console.warn("[daytona] Could not fetch GitHub token:", e);
          }

          const sandbox = await daytona.create({ 
            language,
            envVars: githubToken ? { 
              GITHUB_TOKEN: githubToken,
              GH_TOKEN: githubToken,
            } : {},
            // Tag the sandbox with the owning user so /api/repo-agent/delete
            // can verify ownership before destroying it (Finding 3).
            labels: { userId, source: "chat-create-sandbox" },
            autoDeleteInterval: 15
          });

          // Configure git and install gh CLI
          if (githubToken) {
            try {
              // 1. Configure git to use token for HTTPS pushes
              await sandbox.process.executeCommand(
                `git config --global user.name "${githubUsername}" && ` +
                `git config --global user.email "${githubUsername}@users.noreply.github.com" && ` +
                `git config --global url."https://x-access-token:${githubToken}@github.com/".insteadOf "https://github.com/"`
              );
              
              // 2. Install gh CLI (skip if already present)
              await sandbox.process.executeCommand(
                `(which gh > /dev/null 2>&1) || ` +
                `(curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null && ` +
                `echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && ` +
                `apt-get update -qq && apt-get install -y -qq gh 2>/dev/null) && ` +
                `gh auth setup-git 2>/dev/null || true`
              );
              console.log("[daytona] GitHub auth + gh CLI configured in sandbox", sandbox.id);
            } catch (e) {
              console.warn("[daytona] GitHub setup partial failure (non-blocking):", e);
            }
          }
          
          return { 
            status: "success", 
            sandboxId: sandbox.id,
            workspaceUrl: (sandbox as unknown as { url?: string }).url,
            githubReady: !!githubToken,
            message: `Sandbox created with ID ${sandbox.id}. ${githubToken ? "GitHub CLI (gh) installed and authenticated. git push configured with token auth." : "No GitHub token found."} Use execute_command, write_file, or code_run tools.` 
          };
        } catch (error) {
          console.error("[daytona] create_sandbox error:", error);
          return { status: "error", error: error instanceof Error ? error.message : "Failed to create sandbox" };
        }
      },
    }),

    execute_command: tool({
      description: "Execute a standard bash or CLI command inside the sandbox. Use this to install dependencies (e.g. 'pip install numpy') or run terminal commands.",
      inputSchema: z.object({
        sandboxId: z.string().describe("ID of the sandbox created via create_sandbox"),
        command: z.string().describe("The bash command to execute"),
      }),
      execute: async ({ sandboxId, command }) => {
        try {
          const daytona = getDaytonaClient();
          // Daytona SDK: daytona.get(id) returns a Sandbox; sandbox.process.executeCommand
          // returns ExecuteResponse { exitCode, result, artifacts? }. `result` contains
          // merged stdout + stderr (the SDK does not split them).
          const sandbox = await daytona.get(sandboxId);
          if (!sandbox) return { status: "error", error: "Sandbox not found" };

          const response = await sandbox.process.executeCommand(command);
          return {
            status: response.exitCode === 0 ? "success" : "failure",
            exitCode: response.exitCode,
            result: response.result ?? "",
          };
        } catch (error) {
          return { status: "error", error: error instanceof Error ? error.message : "Command execution failed" };
        }
      },
    }),

    code_run: tool({
      description: "Execute a snippet of code directly without writing it to a file first. Good for quick data analysis or scripts.",
      inputSchema: z.object({
        sandboxId: z.string().describe("The sandbox ID"),
        code: z.string().describe("The code snippet to run"),
      }),
      execute: async ({ sandboxId, code }) => {
        try {
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          if (!sandbox) return { status: "error", error: "Sandbox not found" };

          const response = await sandbox.process.codeRun(code);
          return {
            status: response.exitCode === 0 ? "success" : "failure",
            exitCode: response.exitCode,
            result: response.result,
          };
        } catch (error) {
          return { status: "error", error: error instanceof Error ? error.message : "Code run failed" };
        }
      },
    }),

    write_file: tool({
      description: "Write content to a file inside the sandbox. Useful for large scripts or data files.",
      inputSchema: z.object({
        sandboxId: z.string(),
        filePath: z.string().describe("Path to write to (e.g. 'script.py' or 'data.json')"),
        content: z.string().describe("Content of the file"),
      }),
      execute: async ({ sandboxId, filePath, content }) => {
        try {
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          await sandbox.fs.uploadFile(Buffer.from(content, 'utf-8'), filePath);
          return { status: "success", message: `Wrote file ${filePath}` };
        } catch (error) {
          return { status: "error", error: error instanceof Error ? error.message : "File write failed" };
        }
      },
    }),

    read_file: tool({
      description: "Read the content of a file from the sandbox.",
      inputSchema: z.object({
        sandboxId: z.string(),
        filePath: z.string(),
      }),
      execute: async ({ sandboxId, filePath }) => {
        try {
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          const buffer = await sandbox.fs.downloadFile(filePath);
          return { status: "success", content: buffer.toString('utf-8') };
        } catch (error) {
          return { status: "error", error: error instanceof Error ? error.message : "File read failed" };
        }
      },
    }),

    list_directory: tool({
      description:
        "List files and directories inside the sandbox using `find`. Use this to explore repository structure. Returns file paths (one per line).",
      inputSchema: z.object({
        sandboxId: z.string(),
        path: z.string().describe("Directory path inside the sandbox. Use relative paths like 'workspace/repo' or 'workspace/repo/src' (resolved under the sandbox user's home dir). Absolute paths like /workspace fail because the sandbox user is non-root."),
        maxDepth: z.number().int().min(1).max(6).default(2).describe("Max recursion depth (1-6). Default: 2."),
        pattern: z.string().optional().describe("Optional glob pattern, e.g. '*.ts' or '*.py'"),
      }),
      execute: async ({ sandboxId, path, maxDepth, pattern }) => {
        try {
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          if (!sandbox) return { status: "error", error: "Sandbox not found" };

          const safePath = path.replace(/["`$\\]/g, "");
          const patternArg = pattern ? ` -name ${JSON.stringify(pattern)}` : "";
          const cmd = `find ${JSON.stringify(safePath)} -maxdepth ${maxDepth} -type f${patternArg} ` +
            `-not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' ` +
            `-not -path '*/__pycache__/*' -not -path '*/.next/*' -not -path '*/target/*' | head -500`;
          const response = await sandbox.process.executeCommand(cmd);
          const files = (response.result || "").trim();
          const lineCount = files ? files.split("\n").length : 0;
          return {
            status: response.exitCode === 0 ? "success" : "failure",
            exitCode: response.exitCode,
            fileCount: lineCount,
            files: files.slice(0, 20000), // cap response size
            truncated: (response.result || "").length > 20000,
          };
        } catch (error) {
          return { status: "error", error: error instanceof Error ? error.message : "list_directory failed" };
        }
      },
    }),

    search_files: tool({
      description:
        "Search for a text pattern inside files in the sandbox using `grep -rn`. Use this to find where a symbol, error message, or concept is used in the codebase. Returns matching file:line:text entries.",
      inputSchema: z.object({
        sandboxId: z.string(),
        pattern: z.string().describe("Text or regex pattern to search for"),
        path: z.string().default("workspace/repo").describe("Directory to search in (relative to sandbox user's home). Default: workspace/repo"),
        filePattern: z.string().optional().describe("Optional file glob filter, e.g. '*.ts' or '*.py'"),
        maxResults: z.number().int().min(1).max(300).default(100),
      }),
      execute: async ({ sandboxId, pattern, path, filePattern, maxResults }) => {
        try {
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          if (!sandbox) return { status: "error", error: "Sandbox not found" };

          const safePath = path.replace(/["`$\\]/g, "");
          const include = filePattern ? ` --include=${JSON.stringify(filePattern)}` : "";
          // Fixed-string mode (-F) is safer than regex; caller asks for literal text more often than regex
          const cmd = `grep -rnI -F${include} --exclude-dir=node_modules --exclude-dir=.git ` +
            `--exclude-dir=dist --exclude-dir=build --exclude-dir=.next --exclude-dir=__pycache__ ` +
            `${JSON.stringify(pattern)} ${JSON.stringify(safePath)} | head -${maxResults}`;
          const response = await sandbox.process.executeCommand(cmd);
          const output = (response.result || "").trim();
          // grep exits 1 when no match — not an error for us
          return {
            status: "success",
            exitCode: response.exitCode,
            matches: output.slice(0, 20000),
            matchCount: output ? output.split("\n").length : 0,
            truncated: output.length > 20000,
          };
        } catch (error) {
          return { status: "error", error: error instanceof Error ? error.message : "search_files failed" };
        }
      },
    }),

    view_file_lines: tool({
      description:
        "View a specific line range of a file in the sandbox. Use this to read only the relevant portion of a large file. Line numbers are 1-indexed and both ends inclusive.",
      inputSchema: z.object({
        sandboxId: z.string(),
        filePath: z.string(),
        startLine: z.number().int().min(1).default(1),
        endLine: z.number().int().min(1).default(200),
      }),
      execute: async ({ sandboxId, filePath, startLine, endLine }) => {
        try {
          if (endLine < startLine) return { status: "error", error: "endLine must be >= startLine" };
          if (endLine - startLine > 1000) {
            return { status: "error", error: "Range too large; request at most 1000 lines" };
          }
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          if (!sandbox) return { status: "error", error: "Sandbox not found" };

          const cmd = `sed -n '${startLine},${endLine}p' ${JSON.stringify(filePath)}`;
          const response = await sandbox.process.executeCommand(cmd);
          return {
            status: response.exitCode === 0 ? "success" : "failure",
            exitCode: response.exitCode,
            filePath,
            startLine,
            endLine,
            content: (response.result || "").slice(0, 20000),
          };
        } catch (error) {
          return { status: "error", error: error instanceof Error ? error.message : "view_file_lines failed" };
        }
      },
    }),

    apply_patch: tool({
      description:
        "Apply an exact search/replace patch to a file in the sandbox. The search text must match exactly once in the file. Use this for precise, auditable code edits. If search text appears 0 or more than 1 times, the patch fails safely.",
      inputSchema: z.object({
        sandboxId: z.string(),
        filePath: z.string(),
        search: z.string().describe("Exact text to find (must match exactly once). Include 2-3 lines of context if possible."),
        replace: z.string().describe("Replacement text"),
      }),
      execute: async ({ sandboxId, filePath, search, replace }) => {
        try {
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          if (!sandbox) return { status: "error", error: "Sandbox not found" };

          const buffer = await sandbox.fs.downloadFile(filePath);
          const original = buffer.toString("utf8");

          // Count occurrences (fixed-string, not regex)
          let count = 0;
          let idx = -1;
          while ((idx = original.indexOf(search, idx + 1)) !== -1) {
            count++;
            if (count > 1) break;
          }
          if (count === 0) {
            return { status: "error", error: "Search text not found in file", filePath };
          }
          if (count > 1) {
            return { status: "error", error: "Search text is ambiguous (multiple matches). Add more context.", filePath };
          }

          const updated = original.replace(search, replace);
          await sandbox.fs.uploadFile(Buffer.from(updated, "utf8"), filePath);
          return {
            status: "success",
            filePath,
            bytesBefore: original.length,
            bytesAfter: updated.length,
          };
        } catch (error) {
          return { status: "error", error: error instanceof Error ? error.message : "apply_patch failed" };
        }
      },
    }),

    delete_sandbox: tool({
      description: "Destroy the sandbox and free up resources. MUST call this when finished.",
      inputSchema: z.object({
        sandboxId: z.string(),
      }),
      execute: async ({ sandboxId }) => {
        try {
          const daytona = getDaytonaClient();
          const sandbox = await daytona.get(sandboxId);
          if (sandbox) {
            await daytona.delete(sandbox);
          }
          return { status: "success", message: `Sandbox ${sandboxId} deleted` };
        } catch (error) {
          console.error("[daytona] delete_sandbox error:", error);
          return { status: "error", error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  };
}
