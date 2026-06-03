import GitHubContributionGraph from "@portfolio/components/sections/contribution-graph";

import { createAdminClient } from "@/lib/insforge/admin";

/**
 * Level mapping from GitHub's contribution level strings to numeric 0-4
 */
const LEVEL_MAP: Record<string, number> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

interface Props {
  githubUser: string | undefined;
  userId: string | null;
}

/**
 * Async Server Component for GitHub contributions.
 *
 * Uses the public GitHub contributions HTML scraping approach (no auth token needed).
 * Falls back to the connected GitHub account from connected_apps if socials.github
 * is not set in the portfolio config.
 *
 * Wrapped in <Suspense> by the parent — the page streams instantly while
 * this component fetches data independently.
 */
export async function ContributionGraphServer({ githubUser, userId }: Props) {
  // If no github username in config, look it up from connected_apps
  let resolvedUser = githubUser;
  if (!resolvedUser && userId) {
    try {
      const db = createAdminClient();
      const { data: connection } = await db.database.from("connected_apps")
        .select("github_username, metadata")
        .eq("user_id", userId)
        .eq("provider", "github")
        .eq("status", "active")
        .maybeSingle();
      resolvedUser =
        connection?.github_username ??
        (connection?.metadata as Record<string, string> | null)?.login ??
        undefined;
    } catch {
      // Silent
    }
  }

  if (!resolvedUser) return null;

  try {
    const contributions = await fetchPublicContributions(resolvedUser);
    if (!contributions.data.length) return null;

    return (
      <GitHubContributionGraph
        data={contributions.data}
        lifetimeTotal={contributions.total}
      />
    );
  } catch {
    return null;
  }
}

/**
 * Scrape GitHub's public contribution calendar HTML.
 * No auth token needed — works for any public GitHub user.
 */
async function fetchPublicContributions(username: string) {
  const url = `https://github.com/users/${encodeURIComponent(username)}/contributions`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: controller.signal,
      next: { revalidate: 3600 },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return { data: [], total: 0 };
    }

  const html = await res.text();

  // Parse contribution cells: data-date="YYYY-MM-DD" ... data-level="N"
  const days: { date: string; count: number; level: number }[] = [];
  const cellRegex = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*?data-level="(\d)"[^<]*?(?:(\d+)\s+contribution)?/g;
  let match;

  while ((match = cellRegex.exec(html)) !== null) {
    const date = match[1];
    const level = parseInt(match[2]);
    const countGroup = match[3];
    const count = countGroup
      ? parseInt(countGroup)
      : level === 0 ? 0 : Math.max(1, level * 2 - 1);

    days.push({ date, count, level });
  }

  if (days.length === 0) {
    return { data: [], total: 0 };
  }

  days.sort((a, b) => a.date.localeCompare(b.date));

    const totalMatch = html.match(/([\d,]+)\s+contributions?\s/);
    const total = totalMatch
      ? parseInt(totalMatch[1].replace(/,/g, ""))
      : days.reduce((sum, d) => sum + d.count, 0);

    return { data: days, total };
  } catch (error) {
    console.error("[contribution-graph] fetch failed or timed out:", error);
    return { data: [], total: 0 };
  }
}
