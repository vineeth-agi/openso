/**
 * GET /api/portfolio/check/[slug]
 *
 * Checks whether a username slug is available.
 * Returns { available: boolean }.
 */

import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";

const USERNAME_REGEX = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  if (!USERNAME_REGEX.test(slug)) {
    return NextResponse.json({
      available: false,
      reason: "Invalid format. Use lowercase letters, numbers, hyphens, underscores (3-32 chars).",
    });
  }

  const db = createAdminClient();

  const { data } = await db.database.from("user_portfolios")
    .select("user_id")
    .eq("username", slug)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ available: true });
  }

  // It's taken by this same user — still "available" for them to reuse
  if (data.user_id === auth.user.id) {
    return NextResponse.json({ available: true, yours: true });
  }

  return NextResponse.json({ available: false, reason: "Username is already taken." });
}
