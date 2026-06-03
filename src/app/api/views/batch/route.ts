import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/views/batch?slugs=slug1,slug2,...
 *
 * Returns view counts for multiple slugs at once.
 * Used by ViewsProvider to prefetch counts in bulk.
 */
export async function GET(req: NextRequest) {
  const slugsParam = req.nextUrl.searchParams.get("slugs") || "";
  const slugs = slugsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Placeholder — returns 0 for every slug.
  // Replace with a real DB-backed batch fetch when ready.
  const views: Record<string, number> = {};
  for (const slug of slugs) {
    views[slug] = 0;
  }

  return NextResponse.json({ views });
}