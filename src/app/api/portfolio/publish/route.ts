/**
 * POST /api/portfolio/publish
 *
 * Sets a username slug and marks the portfolio as published.
 * The portfolio becomes publicly accessible at /portfolio/[username].
 *
 * Body: { username: string }
 *
 * DELETE /api/portfolio/publish
 * Unpublishes the portfolio (sets is_published = false).
 */

import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { updatePortfolioNav } from "@/lib/profile/portfolio-config-generator";
import { safeErrorResponse } from "@/lib/security/safe-error";

const USERNAME_REGEX = /^[a-z0-9][a-z0-9_-]{2,31}$/;

// ── POST — publish ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { username } = body;

  if (!username || !USERNAME_REGEX.test(username)) {
    return NextResponse.json(
      {
        error:
          "Invalid username. Must be 3-32 characters: lowercase letters, numbers, hyphens, underscores.",
      },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  // Check if username is taken by another user
  const { data: existing } = await db.database.from("user_portfolios")
    .select("user_id")
    .eq("username", username)
    .neq("user_id", auth.user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "Username is already taken. Please choose another." },
      { status: 409 },
    );
  }

  // Make sure the user has a portfolio config
  const { data: portfolio } = await db.database.from("user_portfolios")
    .select("id, site_config")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!portfolio?.site_config) {
    return NextResponse.json(
      { error: "No portfolio config found. Generate your portfolio first." },
      { status: 400 },
    );
  }

  // Update nav paths to use the chosen username
  await updatePortfolioNav(auth.user.id, username);

  // Publish
  const { error } = await db.database.from("user_portfolios").upsert(
    {
      user_id: auth.user.id,
      username,
      is_published: true,
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return safeErrorResponse(error, { scope: "/api/portfolio/publish:POST", status: 500 });
  }

  // Invalidate ISR cache so the public portfolio page shows immediately
  revalidatePath(`/portfolio/${username}`);

  return NextResponse.json({
    success: true,
    url: `/portfolio/${username}`,
    message: `Portfolio published at /portfolio/${username}`,
  });
}

// ── DELETE — unpublish ────────────────────────────────────────────────────

export async function DELETE() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();

  // Load username before clearing is_published so we can revalidate the correct path
  const { data: existing } = await db.database.from("user_portfolios")
    .select("username")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const { error } = await db.database.from("user_portfolios")
    .update({
      is_published: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", auth.user.id);

  if (error) {
    return safeErrorResponse(error, { scope: "/api/portfolio/publish:DELETE", status: 500 });
  }

  if (existing?.username) {
    revalidatePath(`/portfolio/${existing.username}`);
  }

  return NextResponse.json({ success: true, message: "Portfolio unpublished." });
}
