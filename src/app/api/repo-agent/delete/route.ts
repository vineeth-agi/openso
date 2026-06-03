/**
 * Repo Agent — Delete Sandbox API Route
 *
 * POST /api/repo-agent/delete
 * Body: { sandboxId: "..." }
 *
 * Authenticates the user, verifies sandbox ownership via Daytona labels
 * (Finding 3 — without ownership verification, any authenticated user
 * could destroy any other user's sandbox by submitting its ID),
 * and calls the Daytona Client to destroy the container immediately.
 */

import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/insforge/server";
import { safeErrorResponse } from "@/lib/security/safe-error";
import { getDaytonaClient } from "@/lib/tools/daytona-tools";

export async function POST(req: Request) {
  try {
    // 1. Authenticate
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { user } = auth;

    // 2. Parse payload
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const sandboxId = (body as { sandboxId?: unknown })?.sandboxId;
    if (!sandboxId || typeof sandboxId !== "string") {
      return NextResponse.json(
        { error: "Invalid sandbox ID. Expected a non-empty string." },
        { status: 400 }
      );
    }

    // Defensive shape check: Daytona sandbox ids are uuid-ish.
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(sandboxId)) {
      return NextResponse.json({ error: "Invalid sandbox ID format" }, { status: 400 });
    }

    console.log(`[repo-agent] Delete request for sandbox ${sandboxId} by user ${user.id}...`);

    // 3. Look up sandbox and verify ownership via labels.
    const daytona = getDaytonaClient();
    let sandbox: Awaited<ReturnType<typeof daytona.get>> | null = null;
    try {
      sandbox = await daytona.get(sandboxId);
    } catch (e) {
      // Daytona returns an error when the sandbox doesn't exist — treat as 404.
      console.warn(`[repo-agent] daytona.get failed for ${sandboxId}:`, e);
      return NextResponse.json({ error: "Sandbox not found" }, { status: 404 });
    }

    if (!sandbox) {
      return NextResponse.json({ error: "Sandbox not found" }, { status: 404 });
    }

    // Ownership check via labels. Sandboxes created via daytona-tools
    // tag themselves with `userId`. Sandboxes that lack
    // a userId label are considered legacy / system-owned and only deletable
    // by their own creator path (we refuse the request to be safe).
    const labels = (sandbox as { labels?: Record<string, string> }).labels ?? {};
    const ownerId = labels.userId;
    if (!ownerId || ownerId !== user.id) {
      console.warn(
        `[repo-agent] Refusing delete: sandbox ${sandboxId} owner=${ownerId ?? "<none>"} caller=${user.id}`,
      );
      // Return 404 (not 403) so we don't confirm the existence of foreign sandboxes.
      return NextResponse.json({ error: "Sandbox not found" }, { status: 404 });
    }

    // 4. Ownership confirmed — destroy the sandbox.
    try {
      await daytona.delete(sandbox);
      console.log(`[repo-agent] Sandbox ${sandboxId} deleted successfully.`);
    } catch (daytonaError) {
      // Container may already be gone — best effort.
      console.warn(`[repo-agent] Daytona delete warning (non-blocking):`, daytonaError);
    }

    return NextResponse.json({
      status: "success",
      message: `Sandbox ${sandboxId} has been successfully deleted/cleaned up.`,
    });
  } catch (error) {
    return safeErrorResponse(error, { scope: "/api/repo-agent/delete", status: 500 });
  }
}
