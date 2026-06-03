import { extractFacts } from "../extractor";
import { addFact } from "../store";

import { createAdminClient } from "@/lib/insforge/admin";

const SOURCE = "github";

/**
 * Ingest GitHub profile data into memory facts.
 * Uses the pre-analyzed data stored in the profiles table.
 */
export async function ingestGitHub(userId: string): Promise<{
  factsAdded: number;
}> {
  const db = createAdminClient();

  const { data: profile } = await db.database.from("profiles")
    .select(
      "github_username, github_languages, github_stats, github_summary",
    )
    .eq("id", userId)
    .single();

  if (!profile || !profile.github_username) {
    return { factsAdded: 0 };
  }

  let factsAdded = 0;

  // Build a rich text representation for fact extraction
  const textParts: string[] = [];

  textParts.push(`GitHub username: ${profile.github_username}`);

  if (profile.github_languages?.length > 0) {
    textParts.push(
      `Programming languages used (by usage): ${profile.github_languages.join(", ")}`,
    );
  }

  if (profile.github_stats) {
    const stats = profile.github_stats as {
      total_repos?: number;
      total_stars?: number;
      total_forks?: number;
      top_topics?: string[];
    };
    textParts.push(`Total repositories: ${stats.total_repos ?? 0}`);
    textParts.push(`Total stars: ${stats.total_stars ?? 0}`);
    textParts.push(`Total forks: ${stats.total_forks ?? 0}`);
    if (stats.top_topics?.length) {
      textParts.push(`Top project topics: ${stats.top_topics.join(", ")}`);
    }
  }

  if (profile.github_summary) {
    textParts.push(`\nGitHub profile summary:\n${profile.github_summary}`);
  }

  const fullText = textParts.join("\n");

  const extracted = await extractFacts(fullText, SOURCE, {
    hint: "This is GitHub profile data. Focus on technical skills, project interests, and open-source contributions.",
  });

  for (const fact of extracted) {
    const result = await addFact(userId, fact, SOURCE, profile.github_username);
    if (result.action !== "skipped") factsAdded++;
  }

  return { factsAdded };
}
