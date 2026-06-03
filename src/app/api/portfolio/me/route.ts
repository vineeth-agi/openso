/**
 * GET /api/portfolio/me
 *
 * Returns the authenticated user's portfolio row including site_config.
 * Used by the portfolio settings page to display current state.
 */

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { PortfolioSiteConfigSchema } from "@/lib/profile/portfolio-types";
import { safeErrorResponse } from "@/lib/security/safe-error";

export async function GET() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();

  const { data, error } = await db.database.from("user_portfolios")
    .select("id, username, site_config, display_name, bio, avatar_url, tech_stack, years_experience, config_generated_at, is_published, published_at")
    .eq("user_id", auth.user.id)
    .limit(1);

  if (error) {
    return safeErrorResponse(error, { scope: "/api/portfolio/me:GET", status: 500 });
  }

  const row = data?.[0] ?? null;

  if (!row) {
    return NextResponse.json({ portfolio: null });
  }

  return NextResponse.json({ portfolio: row });
}

/**
 * PATCH /api/portfolio/me
 *
 * Allows manual overrides to portfolio fields and site_config.
 * Deep-merges the provided partial site_config into the existing config.
 *
 * Body: {
 *   site_config?: Partial<PortfolioSiteConfig>,
 *   display_name?: string,
 *   bio?: string,
 *   avatar_url?: string,
 *   tech_stack?: string[],
 * }
 */
export async function PATCH(req: Request) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const db = createAdminClient();

  // Load existing row
  const { data: existingRows } = await db.database.from("user_portfolios")
    .select("site_config, display_name, bio, avatar_url, tech_stack")
    .eq("user_id", auth.user.id)
    .limit(1);
  const existing = existingRows?.[0] ?? null;
  const existingConfig = (existing?.site_config ?? {}) as Record<string, unknown>;

  // Deep merge site_config (1 level deep for sub-objects)
  const incomingConfig = (body.site_config ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...existingConfig };
  for (const [key, value] of Object.entries(incomingConfig)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existingConfig[key] &&
      typeof existingConfig[key] === "object" &&
      !Array.isArray(existingConfig[key])
    ) {
      merged[key] = { ...(existingConfig[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      merged[key] = value;
    }
  }

  // Validate merged config — drop unknown nested keys with `.strict()`.
  // The previous `passthrough()` accepted any nested keys, which meant any
  // future renderer that gained an unsafe sink would inherit a stored-XSS
  // vector (Finding 19).
  const validated = PortfolioSiteConfigSchema.strict().safeParse(merged);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return NextResponse.json({ error: `Invalid config: ${issues}` }, { status: 400 });
  }

  // Ensure only known keys remain; reject anything else (no `custom_*` escape hatch).
  const allowedTopLevelKeys = new Set(Object.keys(PortfolioSiteConfigSchema.shape));
  for (const key of Object.keys(merged)) {
    if (!allowedTopLevelKeys.has(key)) {
      return NextResponse.json({ error: `Invalid config: key "${key}" is not allowed` }, { status: 400 });
    }
  }

  // Build the upsert payload
  const upsertPayload: Record<string, unknown> = {
    user_id: auth.user.id,
    site_config: validated.data,
    config_source: "manual",
    updated_at: new Date().toISOString(),
  };

  // Allow updating top-level portfolio fields
  if (body.display_name !== undefined) upsertPayload.display_name = body.display_name;
  if (body.bio !== undefined) upsertPayload.bio = body.bio;
  if (body.avatar_url !== undefined) upsertPayload.avatar_url = body.avatar_url;
  if (body.tech_stack !== undefined) upsertPayload.tech_stack = body.tech_stack;

  const { error } = await db.database.from("user_portfolios")
    .upsert(upsertPayload, { onConflict: "user_id" });

  if (error) {
    return safeErrorResponse(error, { scope: "/api/portfolio/me:PATCH", status: 500 });
  }

  return NextResponse.json({ success: true, site_config: merged });
}
