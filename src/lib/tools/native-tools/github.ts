import { Octokit } from "@octokit/rest";
import { tool } from "ai";
import { z } from "zod";

import { createAdminClient } from "@/lib/insforge/admin";
import { voyageEmbedRaw } from "@/lib/memory/embeddings";

/**
 * Builds Exhaustive Native Vercel AI Tools for GitHub using Octokit.
 * @param accessToken  OAuth token from connected_apps table
 * @param defaultOwner The user's GitHub username (stored in connected_apps.github_username).
 *                     Used as the default `owner` for all per-repo calls, so the AI
 *                     doesn't need to guess it.
 * @param userId       InsForge user ID for GitHub Memory personalization (optional).
 */
export function buildGithubTools(accessToken: string, defaultOwner?: string, userId?: string) {
  const octokit = new Octokit({ auth: accessToken, userAgent: "Jarvis-Agent/2.0" });

  // ──────────────────────────────────────────────────────────────
  // 0. DISCOVERY — Always call this first when you don't know repos/owner
  // ──────────────────────────────────────────────────────────────

  const github_get_authenticated_user = tool({
    description: "Get the authenticated GitHub user's profile, including their login (username). Call this FIRST if you don't know the user's GitHub username or need to verify connectivity.",
    inputSchema: z.object({
      _: z.string().optional().describe("Dummy parameter - not used")
    }),
    execute: async () => {
      try {
        const { data } = await octokit.users.getAuthenticated();
        return {
          login: data.login,
          name: data.name,
          email: data.email,
          public_repos: data.public_repos,
          followers: data.followers,
          following: data.following,
          bio: data.bio,
          url: data.html_url,
        };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_list_repos = tool({
    description: "List repositories the authenticated user has access to. Call this to discover repo names before making per-repo calls.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Number of repos to return (default 20)"),
      visibility: z.enum(["all", "public", "private"]).optional().describe("Filter by visibility (default: all)"),
    }),
    execute: async ({ limit = 20, visibility = "all" }) => {
      try {
        const { data } = await octokit.repos.listForAuthenticatedUser({ sort: "updated", per_page: limit, visibility });
        return data.map(r => ({
          name: r.name,
          full_name: r.full_name,
          owner: r.owner.login,
          private: r.private,
          url: r.html_url,
          description: r.description,
          default_branch: r.default_branch,
          updated_at: r.updated_at,
        }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  // ──────────────────────────────────────────────────────────────
  // 1. Codebase & Files
  // ──────────────────────────────────────────────────────────────

  const github_get_file_contents = tool({
    description: "Read the full contents of a file or list a directory in a repository.",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? "").describe(`Repository owner (GitHub username). Defaults to the connected user: ${defaultOwner ?? "unknown — call github_get_authenticated_user first"}`),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File or directory path"),
      ref: z.string().optional().describe("Branch, tag, or commit SHA"),
    }),
    execute: async ({ owner, repo, path, ref }) => {
      try {
        const { data } = await octokit.repos.getContent({ owner: owner || defaultOwner || "", repo, path, ref });
        if (Array.isArray(data)) return data.map(i => ({ name: i.name, type: i.type, path: i.path }));
        // @ts-ignore
        if (data.type === "file" && data.encoding === "base64") return Buffer.from(data.content, "base64").toString("utf8");
        return data;
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_create_file = tool({
    description: "Create a new file in a repository.",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? "").describe("Repository owner"),
      repo: z.string(),
      path: z.string(),
      message: z.string().describe("Commit message"),
      content: z.string().describe("Raw file content (do not base64 encode)"),
      branch: z.string().describe("Branch to commit to"),
    }),
    execute: async ({ owner, repo, path, message, content, branch }) => {
      try {
        const res = await octokit.repos.createOrUpdateFileContents({
          owner: owner || defaultOwner || "", repo, path, message, content: Buffer.from(content).toString("base64"), branch
        });
        return { success: true, commit: res.data.commit.sha };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_update_file = tool({
    description: "Update an existing file in a repository. Requires the current file's SHA (get it from github_get_file_contents).",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? "").describe("Repository owner"),
      repo: z.string(),
      path: z.string(),
      message: z.string(),
      content: z.string().describe("New raw file content"),
      sha: z.string().describe("Current blob SHA of the file"),
      branch: z.string(),
    }),
    execute: async ({ owner, repo, path, message, content, sha, branch }) => {
      try {
        const res = await octokit.repos.createOrUpdateFileContents({
          owner: owner || defaultOwner || "", repo, path, message, content: Buffer.from(content).toString("base64"), sha, branch
        });
        return { success: true, commit: res.data.commit.sha };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_search_code = tool({
    description: "Search for code across GitHub repositories.",
    inputSchema: z.object({
      query: z.string().describe("Search query e.g. 'function_name repo:owner/repo'"),
      limit: z.number().optional(),
    }),
    execute: async ({ query, limit = 10 }) => {
      try {
        const { data } = await octokit.search.code({ q: query, per_page: limit });
        return data.items.map(i => ({ name: i.name, path: i.path, repo: i.repository.full_name, url: i.html_url }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  // ──────────────────────────────────────────────────────────────
  // 2. Commits & Branches
  // ──────────────────────────────────────────────────────────────

  const github_list_branches = tool({
    description: "List branches in a repository.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string() }),
    execute: async ({ owner, repo }) => {
      try {
        const { data } = await octokit.repos.listBranches({ owner: owner || defaultOwner || "", repo });
        return data.map(b => b.name);
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_create_branch = tool({
    description: "Create a new branch in a repository.",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? ""),
      repo: z.string(),
      branch: z.string().describe("New branch name"),
      sha: z.string().describe("SHA to branch from"),
    }),
    execute: async ({ owner, repo, branch, sha }) => {
      try {
        const res = await octokit.git.createRef({ owner: owner || defaultOwner || "", repo, ref: `refs/heads/${branch}`, sha });
        return { success: true, ref: res.data.ref };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_list_commits = tool({
    description: "Get recent commits for a repository or branch.",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? ""),
      repo: z.string(),
      sha: z.string().optional().describe("Branch name or SHA"),
      limit: z.number().optional(),
    }),
    execute: async ({ owner, repo, sha, limit = 10 }) => {
      try {
        const { data } = await octokit.repos.listCommits({ owner: owner || defaultOwner || "", repo, sha, per_page: limit });
        return data.map(c => ({ sha: c.sha, message: c.commit.message, author: c.commit.author?.name, date: c.commit.author?.date }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_get_commit = tool({
    description: "Get the full details and file diffs of a specific commit.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), ref: z.string() }),
    execute: async ({ owner, repo, ref }) => {
      try {
        const { data } = await octokit.repos.getCommit({ owner: owner || defaultOwner || "", repo, ref });
        return { sha: data.sha, message: data.commit.message, files: data.files?.map(f => ({ filename: f.filename, additions: f.additions, deletions: f.deletions, patch: f.patch })) };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_compare_commits = tool({
    description: "Compare two branches or commits to see the combined diff.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), base: z.string(), head: z.string() }),
    execute: async ({ owner, repo, base, head }) => {
      try {
        const { data } = await octokit.repos.compareCommits({ owner: owner || defaultOwner || "", repo, base, head });
        return { status: data.status, ahead_by: data.ahead_by, behind_by: data.behind_by, files: data.files?.map(f => ({ filename: f.filename, patch: f.patch })) };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  // ──────────────────────────────────────────────────────────────
  // 3. Pull Requests
  // ──────────────────────────────────────────────────────────────

  const github_list_pull_requests = tool({
    description: "List pull requests in a repository.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), state: z.enum(["open", "closed", "all"]).optional() }),
    execute: async ({ owner, repo, state = "open" }) => {
      try {
        const { data } = await octokit.pulls.list({ owner: owner || defaultOwner || "", repo, state });
        return data.map(pr => ({ number: pr.number, title: pr.title, state: pr.state, user: pr.user?.login, head: pr.head.ref }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_get_pull_request = tool({
    description: "Get details and mergeability status of a pull request.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), pull_number: z.number() }),
    execute: async ({ owner, repo, pull_number }) => {
      try {
        const { data } = await octokit.pulls.get({ owner: owner || defaultOwner || "", repo, pull_number });
        return { title: data.title, body: data.body, state: data.state, merged: data.merged, mergeable: data.mergeable, additions: data.additions, deletions: data.deletions };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_create_pull_request = tool({
    description: "Create a new pull request.",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? ""),
      repo: z.string(),
      title: z.string(),
      head: z.string().describe("Branch with your changes"),
      base: z.string().describe("Target branch (e.g. main)"),
      body: z.string(),
    }),
    execute: async ({ owner, repo, title, head, base, body }) => {
      try {
        const { data } = await octokit.pulls.create({ owner: owner || defaultOwner || "", repo, title, head, base, body });
        return { success: true, number: data.number, url: data.html_url };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_update_pull_request = tool({
    description: "Update a pull request (title, body, or close it).",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), pull_number: z.number(), title: z.string().optional(), body: z.string().optional(), state: z.enum(["open", "closed"]).optional() }),
    execute: async ({ owner, repo, pull_number, title, body, state }) => {
      try {
        const { data } = await octokit.pulls.update({ owner: owner || defaultOwner || "", repo, pull_number, title, body, state });
        return { success: true, url: data.html_url };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_merge_pull_request = tool({
    description: "Merge an approved pull request.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), pull_number: z.number(), commit_title: z.string().optional(), merge_method: z.enum(["merge", "squash", "rebase"]).optional() }),
    execute: async ({ owner, repo, pull_number, commit_title, merge_method = "merge" }) => {
      try {
        const { data } = await octokit.pulls.merge({ owner: owner || defaultOwner || "", repo, pull_number, commit_title, merge_method });
        return { success: data.merged, message: data.message };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_list_pr_files = tool({
    description: "Get all files and diffs changed in a PR.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), pull_number: z.number() }),
    execute: async ({ owner, repo, pull_number }) => {
      try {
        const { data } = await octokit.pulls.listFiles({ owner: owner || defaultOwner || "", repo, pull_number });
        return data.map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_list_pr_reviews = tool({
    description: "Get code reviews on a pull request.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), pull_number: z.number() }),
    execute: async ({ owner, repo, pull_number }) => {
      try {
        const { data } = await octokit.pulls.listReviews({ owner: owner || defaultOwner || "", repo, pull_number });
        return data.map(r => ({ user: r.user?.login, state: r.state, body: r.body }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_create_pr_review = tool({
    description: "Submit a code review with optional inline line-by-line comments (like CodeRabbit). Use the `comments` array to annotate specific lines of code in the diff. Each comment targets a specific file and line.",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? ""),
      repo: z.string(),
      pull_number: z.number(),
      event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
      body: z.string().describe("Top-level review summary"),
      comments: z.array(z.object({
        path: z.string().describe("File path relative to repo root"),
        line: z.number().describe("The line number in the diff to comment on (new file side)"),
        body: z.string().describe("The review comment for this specific line"),
        side: z.enum(["LEFT", "RIGHT"]).default("RIGHT").describe("LEFT = old file, RIGHT = new file (default)"),
      })).optional().describe("Inline comments on specific lines of code. Omit for a top-level-only review."),
    }),
    execute: async ({ owner, repo, pull_number, event, body, comments }) => {
      try {
        const reviewParams: Record<string, unknown> = {
          owner: owner || defaultOwner || "", repo, pull_number, event, body,
        };
        if (comments && comments.length > 0) {
          reviewParams.comments = comments.map(c => ({
            path: c.path,
            line: c.line,
            body: c.body,
            side: c.side || "RIGHT",
          }));
        }
        const { data } = await octokit.pulls.createReview(reviewParams as any);
        return { success: true, url: data.html_url, comments_posted: comments?.length ?? 0 };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_reply_to_review_comment = tool({
    description: "Reply to an existing PR review comment thread (for conversational interactions like '@bot fix this'). Use github_list_pr_review_comments to find comment IDs first.",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? ""),
      repo: z.string(),
      pull_number: z.number(),
      comment_id: z.number().describe("ID of the review comment to reply to"),
      body: z.string().describe("Reply text (markdown supported)"),
    }),
    execute: async ({ owner, repo, pull_number, comment_id, body }) => {
      try {
        const { data } = await octokit.pulls.createReplyForReviewComment({
          owner: owner || defaultOwner || "", repo, pull_number, comment_id, body,
        });
        return { success: true, id: data.id, url: data.html_url };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_list_pr_review_comments = tool({
    description: "List all review comments on a pull request (inline code comments, not top-level issue comments). Use this to find comment IDs for threaded replies.",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? ""),
      repo: z.string(),
      pull_number: z.number(),
    }),
    execute: async ({ owner, repo, pull_number }) => {
      try {
        const { data } = await octokit.pulls.listReviewComments({
          owner: owner || defaultOwner || "", repo, pull_number, per_page: 100,
        });
        return data.map(c => ({
          id: c.id,
          path: c.path,
          line: c.line,
          body: c.body?.slice(0, 500),
          user: c.user?.login,
          created_at: c.created_at,
          in_reply_to_id: c.in_reply_to_id,
        }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  // ──────────────────────────────────────────────────────────────
  // 4. Issues & Comments
  // ──────────────────────────────────────────────────────────────

  const github_list_issues = tool({
    description: "List issues in a repository. If the user doesn't specify owner/repo, use github_list_repos first to discover their repos.",
    inputSchema: z.object({
      owner: z.string().default(defaultOwner ?? "").describe(`Repository owner. Defaults to connected user: ${defaultOwner ?? "unknown"}`),
      repo: z.string().describe("Repository name (not a wildcard — must be a real repo name)"),
      state: z.enum(["open", "closed", "all"]).optional(),
      limit: z.number().optional(),
    }),
    execute: async ({ owner, repo, state = "open", limit = 30 }) => {
      try {
        const { data } = await octokit.issues.listForRepo({ owner: owner || defaultOwner || "", repo, state, per_page: limit });
        return data.filter(i => !i.pull_request).map(i => ({ number: i.number, title: i.title, state: i.state, user: i.user?.login }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_get_issue = tool({
    description: "Get full details of a specific issue.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), issue_number: z.number() }),
    execute: async ({ owner, repo, issue_number }) => {
      try {
        const { data } = await octokit.issues.get({ owner: owner || defaultOwner || "", repo, issue_number });
        return { title: data.title, body: data.body, state: data.state, url: data.html_url };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_create_issue = tool({
    description: "Create a new issue.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), title: z.string(), body: z.string() }),
    execute: async ({ owner, repo, title, body }) => {
      try {
        const { data } = await octokit.issues.create({ owner: owner || defaultOwner || "", repo, title, body });
        return { success: true, number: data.number, url: data.html_url };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_update_issue = tool({
    description: "Update an issue (title, body, or close it by setting state='closed').",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), issue_number: z.number(), title: z.string().optional(), body: z.string().optional(), state: z.enum(["open", "closed"]).optional() }),
    execute: async ({ owner, repo, issue_number, title, body, state }) => {
      try {
        const { data } = await octokit.issues.update({ owner: owner || defaultOwner || "", repo, issue_number, title, body, state });
        return { success: true, url: data.html_url };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_list_issue_comments = tool({
    description: "List comments on an issue or pull request.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), issue_number: z.number() }),
    execute: async ({ owner, repo, issue_number }) => {
      try {
        const { data } = await octokit.issues.listComments({ owner: owner || defaultOwner || "", repo, issue_number });
        return data.map(c => ({ id: c.id, user: c.user?.login, body: c.body, created_at: c.created_at }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_create_issue_comment = tool({
    description: "Add a comment to an issue or pull request.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), issue_number: z.number(), body: z.string() }),
    execute: async ({ owner, repo, issue_number, body }) => {
      try {
        const { data } = await octokit.issues.createComment({ owner: owner || defaultOwner || "", repo, issue_number, body });
        return { success: true, id: data.id, url: data.html_url };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  // ──────────────────────────────────────────────────────────────
  // 5. Repos & Workflows
  // ──────────────────────────────────────────────────────────────

  const github_get_repo = tool({
    description: "Get detailed information about a specific repository.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string() }),
    execute: async ({ owner, repo }) => {
      try {
        const { data } = await octokit.repos.get({ owner: owner || defaultOwner || "", repo });
        return { name: data.full_name, default_branch: data.default_branch, permissions: data.permissions, stars: data.stargazers_count };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_fork_repo = tool({
    description: "Fork a repository to the authenticated user's account.",
    inputSchema: z.object({ owner: z.string(), repo: z.string() }),
    execute: async ({ owner, repo }) => {
      try {
        const { data } = await octokit.repos.createFork({ owner, repo });
        return { success: true, name: data.full_name, url: data.html_url };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_list_workflows = tool({
    description: "List GitHub Actions workflows in a repository.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string() }),
    execute: async ({ owner, repo }) => {
      try {
        const { data } = await octokit.actions.listRepoWorkflows({ owner: owner || defaultOwner || "", repo });
        return data.workflows.map(w => ({ id: w.id, name: w.name, state: w.state, path: w.path }));
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_dispatch_workflow = tool({
    description: "Manually trigger a GitHub Actions workflow run.",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), workflow_id: z.number(), ref: z.string() }),
    execute: async ({ owner, repo, workflow_id, ref }) => {
      try {
        await octokit.actions.createWorkflowDispatch({ owner: owner || defaultOwner || "", repo, workflow_id, ref });
        return { success: true };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  const github_get_workflow_run = tool({
    description: "Get status of a GitHub Actions workflow run (check if tests passed).",
    inputSchema: z.object({ owner: z.string().default(defaultOwner ?? ""), repo: z.string(), run_id: z.number() }),
    execute: async ({ owner, repo, run_id }) => {
      try {
        const { data } = await octokit.actions.getWorkflowRun({ owner: owner || defaultOwner || "", repo, run_id });
        return { status: data.status, conclusion: data.conclusion, html_url: data.html_url };
      } catch (e: any) { return { error: e.message }; }
    },
  });

  // ──────────────────────────────────────────────────────────────
  // OPEN SOURCE CONTRIBUTION TOOLS (pgvector + voyage-code-3)
  // ──────────────────────────────────────────────────────────────

  const github_search_contributor_issues = tool({
    description: `Search for open source issues to contribute to across all curated repositories.
Uses semantic search — understands meaning, not just keywords.
Use this for ANY query about: finding issues, contributing to open source, good first issues, bugs to fix, documentation tasks, beginner-friendly work.
Supports filters: language (Python/TypeScript), difficulty (easy/medium/hard), issue type (bug/feature/documentation/test), specific repo name, max time estimate.`,
    inputSchema: z.object({
      topic: z.string()
        .describe("What the issue is about semantically. E.g. 'authentication bugs', 'memory leak', 'websocket', 'docs improvement'. Use 'open source contribution' if user has no specific topic."),
      language: z.string().optional()
        .describe("Filter by programming language: 'Python', 'TypeScript', etc."),
      difficulty: z.enum(["easy", "medium", "hard", "any"]).optional().default("any")
        .describe("'easy' = good first issue/beginner. 'any' = no filter."),
      issue_type: z.enum(["bug", "documentation", "test", "feature", "any"]).optional().default("any")
        .describe("Type of issue to find."),
      repo_name: z.string().optional()
        .describe("Filter to a specific repository by its name (e.g. 'vercel', 'OpenHands', 'mem0', 'cal.diy', 'firecrawl', 'graphify', 'emdash', etc.)"),
      unassigned_only: z.boolean().optional().default(true)
        .describe("Only show available issues (not assigned, no open PR, not claimed)"),
      help_wanted_only: z.boolean().optional().default(false)
        .describe("Only issues with 'help wanted' label"),
      max_age_days: z.number().optional().default(90)
        .describe("Only issues updated within N days"),
      max_minutes: z.number().optional()
        .describe("Max estimated effort in minutes. 30=quick fix, 60=1hr, 180=half day, 480=full day"),
      offset: z.number().optional().default(0)
        .describe("Pagination — use 10 for 'show more'"),
      limit: z.number().optional().default(10)
        .describe("Number of results"),
    }),
    execute: async ({ topic, language, difficulty, issue_type, repo_name,
                      unassigned_only = true, help_wanted_only = false,
                      max_age_days = 90, max_minutes, offset = 0, limit = 10 }) => {
      try {
        const db = createAdminClient();

        // ── 0. Auto-personalize from GitHub Memory ──
        let personalizedLanguage = language;
        let personalizedDifficulty = difficulty;
        let personalizedTopic = topic;
        let personalizationApplied = false;

        if (userId) {
          try {
            // Fetch top expertise
            const { data: expertise } = await db.database.from("github_memory_expertise")
              .select("skill, skill_category, confidence, years_active")
              .eq("user_id", userId)
              .gte("confidence", 0.3)
              .order("confidence", { ascending: false })
              .limit(10);

            // Fetch insights (especially oss_readiness)
            const { data: insights } = await db.database.from("github_memory_insights")
              .select("insight_type, insight, confidence")
              .eq("user_id", userId)
              .in("insight_type", ["oss_readiness", "domain_expertise", "growth_area"])
              .order("confidence", { ascending: false })
              .limit(5);

            if (expertise && expertise.length > 0) {
              // Auto-set language if not specified
              if (!language) {
                const topLang = expertise.find((e: { skill_category: string }) => e.skill_category === "language");
                if (topLang) {
                  personalizedLanguage = topLang.skill;
                  personalizationApplied = true;
                }
              }

              // Auto-set difficulty based on experience
              if (difficulty === "any" || !difficulty) {
                const topSkill = expertise[0];
                if (topSkill && topSkill.years_active >= 3 && topSkill.confidence >= 0.7) {
                  personalizedDifficulty = "medium";
                } else if (topSkill && topSkill.years_active >= 1) {
                  personalizedDifficulty = "easy";
                }
                if (personalizedDifficulty !== difficulty) personalizationApplied = true;
              }

              // Boost topic with domain expertise if topic is vague
              const VAGUE_TOPIC_RE = /^(open source contribution|anything|something|any issue|find me|give me)/i;
              if (VAGUE_TOPIC_RE.test(topic) && insights && insights.length > 0) {
                const domainInsight = insights.find((i: { insight_type: string }) => i.insight_type === "domain_expertise");
                if (domainInsight) {
                  personalizedTopic = domainInsight.insight.slice(0, 200);
                  personalizationApplied = true;
                }
              }
            }
          } catch (e) {
            // Personalization is best-effort — don't break search
            console.warn("[OSFinder] Personalization failed, proceeding without:", e);
          }
        }

        // ── 1. Embed the query with voyage-code-3 ──
        const VAGUE_RE = /^(anything|something|any\s+issue|whatever|surprise|find\s+me|give\s+me|pick\b|i\s+don.?t\s+know)/i;
        let queryVector: number[] | null = null;

        const searchTopic = personalizedTopic || topic;
        if (!VAGUE_RE.test(searchTopic) && searchTopic.length >= 4) {
          try {
            const vectors = await voyageEmbedRaw([searchTopic], "query", {
              model: "voyage-code-3",
              outputDimension: 1024,
            });
            queryVector = vectors[0] ?? null;
          } catch {
            // Embedding failure is handled below (queryVector stays null)
          }
        }

        if (!queryVector) {
          return { issues: [], total: 0, message: "Could not embed query. Try a more specific topic." };
        }

        // ── 2. Stage 1: pgvector search (fetch 50 candidates) ──
        const rpcParams: Record<string, unknown> = {
          query_embedding: queryVector,          // raw number[] — NOT JSON.stringify
          filter_language: personalizedLanguage || null,
          filter_difficulty: (personalizedDifficulty === "any" ? null : personalizedDifficulty) || null,
          filter_type: issue_type === "any" ? null : issue_type,
          filter_repo_name: repo_name || null,
          filter_unassigned: unassigned_only === true ? true : null,  // only true/null, never false
          filter_help_wanted: help_wanted_only || null,
          filter_well_described: null,           // no body_length filter — include all valid issues
          filter_max_age_days: max_age_days,
          filter_max_minutes: max_minutes || null,
          match_count: 50,
          min_similarity: 0.10,                 // lower threshold → more candidates for reranker
        };

        const { data: candidates, error } = await db.database.rpc("match_open_issues", rpcParams);

        if (error) {
          console.error("[OSFinder] RPC error:", error.message);
          return { issues: [], total: 0, message: "Search failed: " + error.message };
        }

        if (!candidates || candidates.length === 0) {
          return { issues: [], total: 0, message: "No matching issues found. Try a broader topic or remove filters." };
        }

        // ── 3. Stage 2: TypeScript re-ranking ──
        const daysSince = (dateStr: string) =>
          (Date.now() - new Date(dateStr).getTime()) / 86400000;

        const reranked = candidates
          .map((issue: any) => ({
            ...issue,
            score: (issue.similarity ?? 0) * 1.0
              + Math.min((issue.reactions_plus_one || 0) / 100, 1) * 0.15
              + ((issue.reactions_eyes || 0) > 0 ? 0.15 : 0)
              + (issue.has_help_wanted ? 0.20 : 0)
              + (issue.author_is_maintainer ? 0.10 : 0)
              + ((issue.body_length || 0) > 100 ? 0.10 : 0)
              + (issue.milestone_due_soon ? 0.15 : 0)
              + ((issue.comment_count || 0) >= 1 && (issue.comment_count || 0) <= 5 ? 0.05 : 0)
              + (issue.has_reproduction_steps ? 0.10 : 0)
              + (issue.has_code_block ? 0.05 : 0)
              + (issue.is_fresh ? 0.15 : 0)
              + (daysSince(issue.created_at) <= 30 ? 0.05 : 0)
              - (issue.is_assigned ? 0.50 : 0)
              - (issue.has_open_pr ? 0.40 : 0)
              - (issue.is_claimed_by_label ? 0.30 : 0)
              - (issue.has_sub_issues ? 0.10 : 0)
              - ((issue.comment_count || 0) > 20 ? 0.10 : 0),
          }))
          .sort((a: any, b: any) => b.score - a.score)
          .slice(offset, offset + limit);

        // ── 4. Format for LLM display ──
        const formatted = reranked.map((issue: any) => ({
          number: issue.number,
          title: issue.title,
          url: issue.url,
          repo: `${issue.repo_owner}/${issue.repo_name}`,
          repo_stars: issue.repo_stars,
          repo_language: issue.repo_language,
          repo_avatar: issue.repo_avatar,
          repo_health: issue.repo_health,
          repo_activity: issue.repo_activity,
          contributing_url: issue.repo_contributing_url,
          difficulty: issue.difficulty,
          issue_type: issue.issue_type,
          labels: issue.labels,
          is_available: !issue.is_assigned && !issue.has_open_pr && !issue.is_claimed_by_label,
          has_help_wanted: issue.has_help_wanted,
          comment_count: issue.comment_count,
          reactions_plus_one: issue.reactions_plus_one,
          estimated_minutes: issue.estimated_minutes,
          is_fresh: issue.is_fresh,
          similarity: Math.round((issue.similarity ?? 0) * 100) + "%",
        }));

        return {
          issues: formatted,
          total_candidates: candidates.length,
          showing: `${offset + 1}–${offset + formatted.length} of ${candidates.length}`,
          filters_applied: {
            language: personalizedLanguage ?? language,
            difficulty: personalizedDifficulty ?? difficulty,
            issue_type,
            repo_name,
            max_minutes,
          },
          ...(personalizationApplied ? {
            personalization: {
              applied: true,
              auto_language: personalizedLanguage !== language ? personalizedLanguage : undefined,
              auto_difficulty: personalizedDifficulty !== difficulty ? personalizedDifficulty : undefined,
              topic_boosted: personalizedTopic !== topic,
              note: "Filters were auto-personalized based on your GitHub history. Override by specifying filters explicitly.",
            },
          } : {}),
        };

      } catch (e: any) {
        console.error("[OSFinder] Error:", e);
        return { error: e.message };
      }
    },
  });

  return {
    github_get_authenticated_user,
    github_list_repos,
    github_get_file_contents,
    github_create_file,
    github_update_file,
    github_search_code,
    github_list_branches,
    github_create_branch,
    github_list_commits,
    github_get_commit,
    github_compare_commits,
    github_list_pull_requests,
    github_get_pull_request,
    github_create_pull_request,
    github_update_pull_request,
    github_merge_pull_request,
    github_list_pr_files,
    github_list_pr_reviews,
    github_create_pr_review,
    github_reply_to_review_comment,
    github_list_pr_review_comments,
    github_list_issues,
    github_get_issue,
    github_create_issue,
    github_update_issue,
    github_list_issue_comments,
    github_create_issue_comment,
    github_get_repo,
    github_fork_repo,
    github_list_workflows,
    github_dispatch_workflow,
    github_get_workflow_run,
    github_search_contributor_issues,
  };
}
