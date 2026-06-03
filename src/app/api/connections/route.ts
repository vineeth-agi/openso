import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/require-user";
import { getAllConnectionsAdmin, disconnectApp } from "@/lib/connections";
import { createAdminClient } from "@/lib/insforge/admin";
import { safeErrorResponse } from "@/lib/security/safe-error";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/connections
 * Returns the user's active connections (Gmail, Google Calendar, GitHub).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();

    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const connections = await getAllConnectionsAdmin(user.id);
    const db = createAdminClient();

    // Return sanitized list (no raw tokens to the client)
    const safe = await Promise.all(
      connections.map(async (c) => {
        let jobStatus: string | null = null;
        if (c.provider === "github") {
          const { data: job } = await db.database
            .from("github_ingestion_jobs")
            .select("status")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          jobStatus = (job as { status: string } | null)?.status ?? null;
        }

        return {
          provider: c.provider,
          account_email: c.account_email,
          account_name: c.account_name,
          account_avatar: c.account_avatar,
          github_username: c.github_username,
          status: c.status,
          connected: true,
          jobStatus,
        };
      })
    );

    return NextResponse.json({ connections: safe });
  } catch (err) {
    return safeErrorResponse(err, { scope: "/api/connections:GET", status: 500 });
  }
}

/**
 * DELETE /api/connections?provider=gmail|google_calendar|github
 * Disconnects an app.
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized — please refresh the page and try again" }, { status: 401 });
    }

    // Support both query param (?provider=gmail) and JSON body ({ provider: "gmail" })
    const url = new URL(request.url);
    let provider = url.searchParams.get("provider");
    if (!provider) {
      try {
        const body = await request.json();
        provider = body.provider;
      } catch {
        // No JSON body either
      }
    }

    const validProviders = ["github", "gmail"];
    if (!provider || !validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `provider must be one of: ${validProviders.join(", ")}` },
        { status: 400 }
      );
    }

    await disconnectApp(user.id, provider);
    return NextResponse.json({ success: true, provider });
  } catch (err) {
    return safeErrorResponse(err, { scope: "/api/connections:DELETE", status: 500 });
  }
}
