import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/views
 *
 * Registers a page/slug view and returns the updated count.
 * Body: { slug: string }
 */
export async function POST(req: NextRequest) {
  let body: { slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ views: 0 }, { status: 200 });
  }

  const slug = body.slug;
  if (!slug) {
    return NextResponse.json({ views: 0 }, { status: 200 });
  }

  // Placeholder — always returns 1 for now.
  // Replace with a real DB-backed view counter when ready.
  return NextResponse.json({ views: 1 });
}