/**
 * GitHub Memory System — Public API
 */

export { createIngestionJob, getJob, runIngestion } from "./ingestion";
export { embedGitHubMemory } from "./embedder";
export { runGitHubDreamCycle } from "./dream-cycle";
export {
  getGitHubMemoryContext,
  formatGitHubMemoryPrompt,
  type GitHubMemoryContext,
} from "./retriever";
export type {
  IngestionJob,
  IngestionStatus,
  GitHubExpertise,
  GitHubGraphEdge,
  GitHubMemoryRepo,
} from "./types";

import { createAdminClient } from "@/lib/insforge/admin";

/**
 * Delete ALL GitHub memory data for a user.
 * Called when user disconnects GitHub from connectors.
 * Clears 11 tables: repos, commits, PRs, issues, contributions, collaborators,
 * graph, expertise, narrative, insights, ingestion jobs.
 */
export async function deleteGitHubMemory(userId: string): Promise<void> {
  const db = createAdminClient();

  const tables = [
    "github_memory_insights",
    "github_developer_narrative",
    "github_memory_graph",
    "github_memory_expertise",
    "github_memory_collaborators",
    "github_memory_contributions",
    "github_memory_commits",
    "github_memory_prs",
    "github_memory_issues",
    "github_memory_repos",
    "github_ingestion_jobs",
    // Repo indexing data (pgvector code chunks + status)
    "repo_code_chunks",
    "repo_index_status",
  ];

  await Promise.allSettled(
    tables.map((table) =>
      db.database.from(table).delete().eq("user_id", userId)
    ),
  );
}
