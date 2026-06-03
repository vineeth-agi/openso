import { formatDistanceToNow } from "date-fns";

/**
 * Format a date string as a human-readable relative time (e.g. "5m ago", "2h ago").
 *
 * Replaces 3 duplicate implementations:
 *   - memory-brain.tsx → timeAgo()
 *   - cron-jobs.tsx    → formatRelativeTime()
 *   - dashboard-shell  → formatDistanceToNow (date-fns)
 *
 * Uses date-fns under the hood for consistent output.
 */
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return "—";
  }
}

/**
 * Format a relative time that also handles future dates (e.g. "in 5m").
 * Used for cron job scheduling where next_run_at can be in the future.
 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const mins = Math.floor(abs / 60000);
  const hours = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);
  if (mins < 1) return future ? "in a moment" : "just now";
  if (hours < 1) return future ? `in ${mins}m` : `${mins}m ago`;
  if (days < 1) return future ? `in ${hours}h` : `${hours}h ago`;
  return future ? `in ${days}d` : `${days}d ago`;
}

/**
 * Compact age form intended for chips/badges, no "ago" suffix.
 *   < 60s   → "now"
 *   < 60m   → "5m"
 *   < 24h   → "3h"
 *   < 30d   → "2d"
 *   < 365d  → "5w" (weeks) up to ~6w, then "3mo"
 *   else    → "1y"
 */
export function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(diff / 86400000);
  if (days < 14) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}

/**
 * Bucket an issue's age into a UX category that drives styling and copy.
 *   fresh   → ≤ 7 days  (lower competition, maintainer engaged)
 *   recent  → ≤ 30 days
 *   normal  → ≤ 90 days
 *   stuck   → > 90 days (open without movement; corresponds to is_stuck_long_term)
 */
export function ageBucket(
  iso: string | null | undefined,
): "fresh" | "recent" | "normal" | "stuck" | "unknown" {
  if (!iso) return "unknown";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 7) return "fresh";
  if (days <= 30) return "recent";
  if (days <= 90) return "normal";
  return "stuck";
}
