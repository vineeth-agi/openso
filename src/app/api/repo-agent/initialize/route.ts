/**
 * Repo Agent — Initialize API Route
 *
 * POST /api/repo-agent/initialize
 * Body: { repoFullName: "owner/repo" }
 *
 * Stub: repo indexing is being rebuilt. Returns not_implemented for all
 * valid requests.
 */

import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/insforge/server";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    // 1. Authenticate.
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2. Parse + validate the body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const repoFullName = (body as { repoFullName?: unknown })?.repoFullName;
    if (
      !repoFullName ||
      typeof repoFullName !== "string" ||
      !repoFullName.includes("/")
    ) {
      return NextResponse.json(
        { error: "Invalid repo name. Expected format: owner/repo" },
        { status: 400 },
      );
    }
    const slashCount = (repoFullName.match(/\//g) ?? []).length;
    const [owner, repo] = repoFullName.split("/");
    if (slashCount !== 1 || !owner || !repo) {
      return NextResponse.json(
        { error: "Invalid repo name. Expected format: owner/repo" },
        { status: 400 },
      );
    }

    // 3. Repo indexing is being rebuilt — return not_implemented.
    return NextResponse.json({
      status: "not_implemented",
      repoFullName,
      message: "Repo indexing is being rebuilt.",
    });
  } catch (error) {
    console.error("[repo-agent/initialize] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
