import { cache } from "react";

import { createAdminClient } from "@/lib/insforge/admin";

export interface PortfolioRowData {
  user_id: string | null;
  site_config: Record<string, unknown> | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  resume_structured?: Record<string, unknown> | null;
}

/**
 * Cached portfolio lookup — fetches all fields from user_portfolios once per request.
 * React's `cache()` deduplicates calls within the same render pass so the layout
 * (metadata + body) and page all share the same database query.
 */
export const getCachedPortfolio = cache(
  async (username: string): Promise<PortfolioRowData | null> => {
    const db = createAdminClient();
    const { data } = await db.database.from("user_portfolios")
      .select("user_id, site_config, display_name, bio, avatar_url")
      .eq("username", username)
      .eq("is_published", true)
      .maybeSingle();

    if (!data) return null;

    let resume_structured: Record<string, unknown> | null = null;
    if (data.user_id) {
      try {
        const { data: profile } = await db.database.from("user_profiles")
          .select("resume_structured")
          .eq("user_id", data.user_id)
          .maybeSingle();
        resume_structured = (profile?.resume_structured as Record<string, unknown>) ?? null;
      } catch {
        // Silent fallback
      }
    }

    return {
      user_id: data.user_id,
      site_config: data.site_config,
      display_name: data.display_name,
      bio: data.bio,
      avatar_url: data.avatar_url,
      resume_structured,
    };
  },
);