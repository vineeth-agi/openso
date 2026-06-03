import { NextResponse } from "next/server";

/**
 * GET /api/location
 *
 * Returns a best-effort location + weather snapshot for the footer widget.
 * Falls back to empty JSON when geo-IP / weather is unavailable.
 */
export async function GET() {
  // Placeholder — returns empty so the footer falls through gracefully.
  // Replace with a real geo-IP + weather service when needed.
  return NextResponse.json({});
}