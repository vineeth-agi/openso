import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/revalidate
 *
 * Invalidates the ISR cache for one of the caller's own paths. Used after
 * portfolio settings save / publish so the public page immediately reflects
 * changes.
 *
 * Security (Finding 6): the previous version accepted any path string from
 * any authenticated user, allowing cache-thrash DoS. This version restricts
 * the path to the caller's own portfolio (`/portfolio/<their username>`)
 * and rate-limits to 10 requests / minute / user.
 *
 * Body: { path: string }
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: cheap defense against accidental client retry loops AND
  // a deliberate cache-thrash attack.
  const rl = await rateLimit(`revalidate:${auth.user.id}`, 10);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { path } = body;
  if (!path || typeof path !== "string" || path.length > 256) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  // Strip query/hash and normalize.
  const cleanPath = path.split(/[?#]/)[0];
  if (!cleanPath.startsWith("/")) {
    return NextResponse.json({ error: "path must start with /" }, { status: 400 });
  }

  // Look up the caller's own portfolio username — only paths under their
  // own portfolio are revalidatable. Everything else returns 403.
  const db = createAdminClient();
  const { data: portfolio } = await db.database.from("user_portfolios")
    .select("username")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const ownUsername = portfolio?.username as string | undefined;
  if (!ownUsername) {
    return NextResponse.json(
      { error: "No portfolio username — publish your portfolio first." },
      { status: 400 },
    );
  }

  const allowedPrefix = `/portfolio/${ownUsername}`;
  if (cleanPath !== allowedPrefix && !cleanPath.startsWith(`${allowedPrefix}/`)) {
    return NextResponse.json(
      { error: "Path outside your portfolio scope" },
      { status: 403 },
    );
  }

  revalidatePath(cleanPath);
  return NextResponse.json({ success: true, revalidated: cleanPath });
}
