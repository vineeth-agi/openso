/**
 * Repo Agent — List User Repos API Route
 *
 * GET /api/repo-agent/repos
 *
 * Returns the user's GitHub repositories. First checks the github_memory_repos table
 * (which is populated during GitHub Memory ingestion). Falls back to the GitHub API
 * if the memory table is empty or unavailable.
 */

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. Authenticate
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { user } = auth;

    const db = createAdminClient();

    // 2. Try github_memory_repos first (fast, already cached)
    const { data: memoryRepos } = await db
      .database.from("github_memory_repos")
      .select("full_name, name, description, primary_language, stargazers_count, is_private, is_fork, is_archived, html_url, pushed_at, topics")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .order("pushed_at", { ascending: false })
      .limit(100);

    if (memoryRepos && memoryRepos.length > 0) {
      return NextResponse.json({
        source: "memory",
        repos: memoryRepos.map((r) => ({
          fullName: r.full_name,
          name: r.name,
          description: r.description,
          language: r.primary_language,
          stars: r.stargazers_count,
          isPrivate: r.is_private,
          isFork: r.is_fork,
          url: r.html_url,
          pushedAt: r.pushed_at,
          topics: r.topics ?? [],
        })),
      });
    }

    // 3. Fallback: fetch from GitHub API directly.
    //    Read the token via `getConnectionAdmin` (DB-HIGH-01) so it is
    //    decrypted by `decryptConnectionRow` before being used as a
    //    bearer. Direct `from("connected_apps").select("access_token")`
    //    reads ciphertext and silently fails for `enc:v1:`-wrapped rows.
    const { getConnectionAdmin } = await import("@/lib/connections");
    const ghConn = await getConnectionAdmin(user.id, "github");

    if (!ghConn?.access_token) {
      return NextResponse.json({
        source: "none",
        repos: [],
        error: "GitHub not connected",
      });
    }

    // Fetch repos from GitHub API
    const ghRes = await fetch(
      "https://api.github.com/user/repos?sort=pushed&per_page=100&type=all",
      {
        headers: {
          Authorization: `Bearer ${ghConn.access_token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!ghRes.ok) {
      return NextResponse.json(
        { error: `GitHub API error: ${ghRes.status}` },
        { status: 502 }
      );
    }

    const ghRepos = await ghRes.json();

    return NextResponse.json({
      source: "github_api",
      repos: (ghRepos as Array<Record<string, unknown>>)
        .filter((r) => !r.archived)
        .map((r) => ({
          fullName: r.full_name,
          name: r.name,
          description: r.description,
          language: r.language,
          stars: r.stargazers_count,
          isPrivate: r.private,
          isFork: r.fork,
          url: r.html_url,
          pushedAt: r.pushed_at,
          topics: r.topics ?? [],
        })),
    });
  } catch (error) {
    console.error("[repo-agent] List repos error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
