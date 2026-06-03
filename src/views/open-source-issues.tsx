"use client";

import { useEffect, useMemo, useState } from "react";

import {
  AlertCircle,
  Bug,
  ChevronDown,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDot,
  Code2,
  DollarSign,
  ExternalLink,
  FileText,
  GitPullRequest,
  Heart,
  Image as ImageIcon,
  ListChecks,
  MessageSquare,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Star,
  Timer,
  TrendingUp,
  Wand2,
  Wrench,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ageBucket, relativeAge, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Types ──
type Issue = {
  id: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
  difficulty: "easy" | "medium" | "hard" | "unknown";
  issue_type: "bug" | "documentation" | "test" | "feature" | "refactor" | "other";
  has_help_wanted: boolean;
  is_assigned: boolean;
  has_open_pr: boolean;
  is_claimed_by_label: boolean;
  comment_count: number;
  body_length: number;
  reactions_plus_one: number;
  reactions_eyes: number;
  reactions_rocket: number;
  author_is_maintainer: boolean;
  has_code_block: boolean;
  has_reproduction_steps: boolean;
  has_screenshots: boolean;
  has_error_log: boolean;
  has_milestone: boolean;
  milestone_due_soon: boolean;
  estimated_minutes: number | null;
  expertise_required: "beginner" | "junior" | "mid" | "senior" | "unknown";
  has_bounty: boolean;
  bounty_amount: string | null;
  is_fresh: boolean;
  is_stuck_long_term: boolean;
  created_at: string | null;
  updated_at: string | null;
  // joined repo fields
  repo: {
    id: string;
    name: string;
    owner: string;
    avatar: string | null;
    language: string | null;
    stars: string | null;
    activity_level: string | null;
    license_type: string | null;
    contributing_url: string | null;
    is_trending: boolean;
    avg_first_response_hours: number | null;
    avg_pr_merge_hours: number | null;
  };
};

type DifficultyBucket = "any" | "easy" | "medium" | "hard";
type TypeBucket = "any" | "bug" | "feature" | "documentation" | "test" | "refactor";
type AgeBucket = "any" | "fresh" | "recent" | "normal";
type SortOrder =
  | "quickest"
  | "wanted"
  | "freshest"
  | "trending"
  | "merge_speed";

const PAGE_SIZE = 18;

// ── Small visual helpers ────────────────────────────────────────────────────

function difficultyTone(d: Issue["difficulty"]): string {
  switch (d) {
    case "easy":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "medium":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "hard":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-border/60 bg-muted/40 text-muted-foreground";
  }
}

function typeIcon(t: Issue["issue_type"]) {
  switch (t) {
    case "bug":
      return Bug;
    case "feature":
      return Sparkles;
    case "documentation":
      return FileText;
    case "test":
      return ListChecks;
    case "refactor":
      return Wrench;
    default:
      return CircleDot;
  }
}

function activityTone(level: string | null | undefined): string {
  switch ((level ?? "").toLowerCase()) {
    case "very active":
      return "bg-emerald-400";
    case "active":
      return "bg-emerald-500/70";
    case "moderate":
      return "bg-amber-400";
    case "low activity":
      return "bg-zinc-500";
    default:
      return "bg-zinc-600";
  }
}

function formatMinutes(mins: number | null): string {
  if (!mins) return "—";
  if (mins < 60) return `~${mins}m`;
  if (mins < 60 * 8) return `~${Math.round(mins / 60)}h`;
  return `~${Math.round(mins / (60 * 8))}d`;
}

function formatHours(h: number | null | undefined): string | null {
  if (h == null) return null;
  if (h < 1) return `<1h`;
  if (h < 48) return `${Math.round(h)}h`;
  const days = Math.round(h / 24);
  return `${days}d`;
}

// ── Issue Card ─────────────────────────────────────────────────────────────

function IssueCard({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  const TypeIcon = typeIcon(issue.issue_type);
  const ageKind = ageBucket(issue.created_at);
  const ageStr = relativeAge(issue.created_at);
  const updatedStr = timeAgo(issue.updated_at);
  const [imgError, setImgError] = useState(false);

  const ageChipTone =
    ageKind === "fresh"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : ageKind === "stuck"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : "border-border/60 bg-muted/40 text-muted-foreground";

  const responseHours = formatHours(issue.repo.avg_first_response_hours);
  const mergeHours = formatHours(issue.repo.avg_pr_merge_hours);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-ring/50 hover:shadow-sm hover:shadow-ring/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Top chips: age + bounty + trending */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                ageChipTone,
              )}
            >
              <Timer className="size-3" />
              {ageKind === "stuck" ? `Stuck · ${ageStr}` : ageStr}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Opened {timeAgo(issue.created_at)} · Updated {updatedStr}
          </TooltipContent>
        </Tooltip>

        {issue.is_fresh && ageKind === "fresh" && (
          <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
            <Sparkles className="size-3" /> Fresh
          </Badge>
        )}

        {issue.has_bounty && (
          <Badge className="h-5 gap-1 border-emerald-500/40 bg-emerald-500/15 px-1.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20">
            <DollarSign className="size-3" />
            {issue.bounty_amount ?? "Bounty"}
          </Badge>
        )}

        {issue.has_help_wanted && (
          <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
            <Heart className="size-3" /> Help wanted
          </Badge>
        )}

        {issue.repo.is_trending && (
          <Badge variant="outline" className="h-5 gap-1 border-orange-500/40 bg-orange-500/10 px-1.5 text-[10px] text-orange-300">
            <TrendingUp className="size-3" /> Trending
          </Badge>
        )}
      </div>

      {/* Title */}
      <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
        {issue.title}
      </h3>

      {/* Repo line */}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {issue.repo.avatar && !imgError && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={issue.repo.avatar}
            alt={issue.repo.owner}
            className="size-4 shrink-0 rounded-sm border border-border"
            onError={() => setImgError(true)}
          />
        )}
        <span className="truncate font-medium text-foreground/80">
          {issue.repo.owner}/{issue.repo.name}
        </span>
        {issue.repo.language && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span>{issue.repo.language}</span>
          </>
        )}
        {issue.repo.activity_level && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="inline-flex items-center gap-1">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  activityTone(issue.repo.activity_level),
                )}
              />
              {issue.repo.activity_level}
            </span>
          </>
        )}
      </div>

      {/* Meta row: difficulty + effort + type */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize",
            difficultyTone(issue.difficulty),
          )}
        >
          {issue.difficulty === "unknown" ? "?" : issue.difficulty}
        </span>
        {issue.estimated_minutes != null && (
          <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            <Timer className="size-3" />
            {formatMinutes(issue.estimated_minutes)}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
          <TypeIcon className="size-3" />
          {issue.issue_type}
        </span>
      </div>

      {/* Demand / community signals */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
        {issue.reactions_plus_one > 0 && (
          <span className="inline-flex items-center gap-1">
            👍 {issue.reactions_plus_one}
          </span>
        )}
        {issue.reactions_eyes > 0 && (
          <span className="inline-flex items-center gap-1">
            👀 {issue.reactions_eyes}
          </span>
        )}
        {issue.comment_count > 0 && (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3" />
            {issue.comment_count}
          </span>
        )}
        {responseHours && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-emerald-400/80">
                <Wand2 className="size-3" />
                Response {responseHours}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Average maintainer first response time
            </TooltipContent>
          </Tooltip>
        )}
        {mergeHours && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-emerald-400/80">
                <GitPullRequest className="size-3" />
                Merge {mergeHours}
              </span>
            </TooltipTrigger>
            <TooltipContent>Average PR merge time</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Footer: body quality + license */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {issue.has_code_block && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Code2 className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Has code block</TooltipContent>
            </Tooltip>
          )}
          {issue.has_reproduction_steps && (
            <Tooltip>
              <TooltipTrigger asChild>
                <ListChecks className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Has reproduction steps</TooltipContent>
            </Tooltip>
          )}
          {issue.has_error_log && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Includes error log</TooltipContent>
            </Tooltip>
          )}
          {issue.has_screenshots && (
            <Tooltip>
              <TooltipTrigger asChild>
                <ImageIcon className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Has screenshots</TooltipContent>
            </Tooltip>
          )}
        </div>
        {issue.repo.license_type && issue.repo.license_type !== "unknown" && (
          <span className="inline-flex items-center gap-1 capitalize">
            <Shield className="size-3" />
            {issue.repo.license_type}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function SkeletonIssueCard() {
  return (
    <div className="flex animate-pulse flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex gap-1.5">
        <div className="h-4 w-12 rounded bg-muted" />
        <div className="h-4 w-14 rounded bg-muted" />
      </div>
      <div className="mt-3 h-4 w-4/5 rounded bg-muted" />
      <div className="mt-2 h-3 w-2/5 rounded bg-muted" />
      <div className="mt-3 flex gap-1.5">
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-4 w-12 rounded bg-muted" />
        <div className="h-4 w-14 rounded bg-muted" />
      </div>
      <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
      <div className="mt-auto flex justify-between border-t border-border/50 pt-3">
        <div className="h-3 w-12 rounded bg-muted" />
        <div className="h-3 w-12 rounded bg-muted" />
      </div>
    </div>
  );
}

// ── Detail Dialog ──────────────────────────────────────────────────────────

function IssueDetailDialog({
  issue,
  open,
  onOpenChange,
}: {
  issue: Issue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!issue) return null;
  const TypeIcon = typeIcon(issue.issue_type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {issue.repo.avatar && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={issue.repo.avatar}
                alt={issue.repo.owner}
                className="size-5 rounded-sm border border-border"
              />
            )}
            <span className="font-medium text-foreground/80">
              {issue.repo.owner}/{issue.repo.name}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span>#{issue.number}</span>
          </div>
          <DialogTitle className="text-base">{issue.title}</DialogTitle>
          <DialogDescription className="text-xs">
            Opened {timeAgo(issue.created_at)} · Updated{" "}
            {timeAgo(issue.updated_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium capitalize",
                difficultyTone(issue.difficulty),
              )}
            >
              {issue.difficulty === "unknown" ? "Difficulty ?" : issue.difficulty}
            </span>
            {issue.estimated_minutes != null && (
              <Badge variant="outline" className="h-5 gap-1 text-[11px]">
                <Timer className="size-3" />
                {formatMinutes(issue.estimated_minutes)}
              </Badge>
            )}
            <Badge variant="outline" className="h-5 gap-1 text-[11px] capitalize">
              <TypeIcon className="size-3" />
              {issue.issue_type}
            </Badge>
            {issue.has_bounty && (
              <Badge className="h-5 gap-1 border-emerald-500/40 bg-emerald-500/15 text-[11px] text-emerald-300">
                <DollarSign className="size-3" />
                {issue.bounty_amount ?? "Bounty"}
              </Badge>
            )}
            {issue.expertise_required !== "unknown" && (
              <Badge variant="secondary" className="h-5 capitalize text-[11px]">
                {issue.expertise_required} level
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Demand
              </div>
              <div className="mt-1 flex items-center gap-3 tabular-nums">
                <span>👍 {issue.reactions_plus_one}</span>
                <span>👀 {issue.reactions_eyes}</span>
                <span>🚀 {issue.reactions_rocket}</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {issue.comment_count} comments
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Maintainer
              </div>
              <div className="mt-1 text-foreground">
                {formatHours(issue.repo.avg_first_response_hours) ?? "—"}{" "}
                response
              </div>
              <div className="text-muted-foreground">
                {formatHours(issue.repo.avg_pr_merge_hours) ?? "—"} PR merge
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {issue.has_code_block && <span>● Code block</span>}
            {issue.has_reproduction_steps && <span>● Repro steps</span>}
            {issue.has_error_log && <span>● Error log</span>}
            {issue.has_screenshots && <span>● Screenshots</span>}
            {issue.body_length > 0 && (
              <span>● {issue.body_length.toLocaleString()} chars</span>
            )}
          </div>

          {issue.labels.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Labels
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {issue.labels.map((l) => (
                  <Badge
                    key={l}
                    variant="secondary"
                    className="text-[10px] font-normal"
                  >
                    {l}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {issue.repo.contributing_url && (
            <a
              href={issue.repo.contributing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <FileText className="size-3" />
              Read CONTRIBUTING.md
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Close
            </Button>
          </DialogClose>
          <Button size="sm" asChild>
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="gap-1.5"
            >
              <ExternalLink className="size-3.5" />
              Open on GitHub
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main View ──────────────────────────────────────────────────────────────

export function OpenSourceIssuesView() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // ── Filters ──
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState<string>("all");
  const [difficulty, setDifficulty] = useState<DifficultyBucket>("any");
  const [issueType, setIssueType] = useState<TypeBucket>("any");
  const [age, setAge] = useState<AgeBucket>("any");
  const [available, setAvailable] = useState(false);
  const [responsiveOnly, setResponsiveOnly] = useState(false);
  const [bountyOnly, setBountyOnly] = useState(false);
  const [helpWantedOnly, setHelpWantedOnly] = useState(false);
  const [permissiveOnly, setPermissiveOnly] = useState(false);
  const [wellDescribedOnly, setWellDescribedOnly] = useState(false);
  const [trendingOnly, setTrendingOnly] = useState(false);
  const [sort, setSort] = useState<SortOrder>("quickest");

  // ── Fetch ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);

      // Same-origin endpoint reads the httpOnly cookie server-side
      // and forwards the bearer to InsForge. Browser-direct SDK
      // calls can't authenticate cross-origin.
      try {
        const r = await fetch("/api/open-source/issues", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          if (!cancelled) setError(body.error ?? `Request failed (${r.status})`);
          if (!cancelled) setLoading(false);
          return;
        }
        const body = (await r.json()) as { data: Record<string, unknown>[] };
        if (cancelled) return;

        // InsForge typing returns repo as either an object or an array
        // depending on FK relationship metadata; coerce to a single
        // object defensively.
        const rows = (body.data ?? []).map((row) => {
          const rawRepo = row.repo as unknown;
          const repo = Array.isArray(rawRepo) ? rawRepo[0] : rawRepo;
          return { ...row, repo: repo ?? {} } as Issue;
        });

        setIssues(rows);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load issues");
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived: language options ──
  const languageOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) {
      if (i.repo.language) set.add(i.repo.language);
    }
    return Array.from(set).sort();
  }, [issues]);

  // ── Filter ──
  const filtered = useMemo(() => {
    const maxAgeDays =
      age === "fresh" ? 7 : age === "recent" ? 30 : age === "normal" ? 90 : null;

    return issues.filter((i) => {
      if (search) {
        const q = search.toLowerCase();
        const hay =
          i.title.toLowerCase() +
          " " +
          i.repo.name.toLowerCase() +
          " " +
          i.repo.owner.toLowerCase() +
          " " +
          (i.labels.join(" ").toLowerCase());
        if (!hay.includes(q)) return false;
      }
      if (language !== "all" && i.repo.language !== language) return false;
      if (difficulty !== "any" && i.difficulty !== difficulty) return false;
      if (issueType !== "any" && i.issue_type !== issueType) return false;
      if (maxAgeDays != null) {
        if (!i.created_at) return false;
        const days = Math.floor(
          (Date.now() - new Date(i.created_at).getTime()) / 86400000,
        );
        if (days > maxAgeDays) return false;
      }
      if (available) {
        if (i.is_assigned || i.has_open_pr || i.is_claimed_by_label)
          return false;
      }
      if (responsiveOnly) {
        if (
          i.repo.avg_first_response_hours == null ||
          i.repo.avg_first_response_hours > 72
        )
          return false;
      }
      if (bountyOnly && !i.has_bounty) return false;
      if (helpWantedOnly && !i.has_help_wanted) return false;
      if (permissiveOnly && i.repo.license_type !== "permissive") return false;
      if (wellDescribedOnly && i.body_length <= 200) return false;
      if (trendingOnly && !i.repo.is_trending) return false;
      return true;
    });
  }, [
    issues,
    search,
    language,
    difficulty,
    issueType,
    age,
    available,
    responsiveOnly,
    bountyOnly,
    helpWantedOnly,
    permissiveOnly,
    wellDescribedOnly,
    trendingOnly,
  ]);

  // ── Sort ──
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sort) {
      case "quickest":
        arr.sort((a, b) => {
          const ae = a.estimated_minutes ?? 99999;
          const be = b.estimated_minutes ?? 99999;
          if (ae !== be) return ae - be;
          return b.reactions_plus_one - a.reactions_plus_one;
        });
        break;
      case "wanted":
        arr.sort((a, b) => {
          if (b.reactions_plus_one !== a.reactions_plus_one) {
            return b.reactions_plus_one - a.reactions_plus_one;
          }
          return b.reactions_eyes - a.reactions_eyes;
        });
        break;
      case "freshest":
        arr.sort((a, b) => {
          const at = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bt - at;
        });
        break;
      case "trending":
        arr.sort((a, b) => {
          const at = a.repo.is_trending ? 1 : 0;
          const bt = b.repo.is_trending ? 1 : 0;
          if (at !== bt) return bt - at;
          return b.reactions_plus_one - a.reactions_plus_one;
        });
        break;
      case "merge_speed":
        arr.sort((a, b) => {
          const ah = a.repo.avg_pr_merge_hours ?? 99999;
          const bh = b.repo.avg_pr_merge_hours ?? 99999;
          return ah - bh;
        });
        break;
    }
    return arr;
  }, [filtered, sort]);

  // ── Pagination ──
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = useMemo(
    () => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [sorted, page],
  );

  useEffect(() => {
    setPage(0);
  }, [
    search,
    language,
    difficulty,
    issueType,
    age,
    available,
    responsiveOnly,
    bountyOnly,
    helpWantedOnly,
    permissiveOnly,
    wellDescribedOnly,
    trendingOnly,
    sort,
  ]);

  const hasAdvancedFilters =
    permissiveOnly ||
    wellDescribedOnly ||
    trendingOnly ||
    helpWantedOnly ||
    bountyOnly ||
    responsiveOnly;
  const anyFilter =
    !!search ||
    language !== "all" ||
    difficulty !== "any" ||
    issueType !== "any" ||
    age !== "any" ||
    available ||
    hasAdvancedFilters;

  function clearAll() {
    setSearch("");
    setLanguage("all");
    setDifficulty("any");
    setIssueType("any");
    setAge("any");
    setAvailable(false);
    setResponsiveOnly(false);
    setBountyOnly(false);
    setHelpWantedOnly(false);
    setPermissiveOnly(false);
    setWellDescribedOnly(false);
    setTrendingOnly(false);
    setSort("quickest");
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="font-medium text-destructive">
            Failed to load issues
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <h1 className="text-base font-semibold">Open Source Issues</h1>
              <p className="text-xs text-muted-foreground">
                {sorted.length.toLocaleString()} issues ready to claim &middot;{" "}
                <span className="text-emerald-400/80">
                  {sorted.filter((i) => i.is_fresh).length} fresh this week
                </span>
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search title, repo, label…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-7 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Primary filters row — all controls on one wrapping line */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v)}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="All languages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All languages</SelectItem>
                {languageOptions.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={difficulty}
              onValueChange={(v) => setDifficulty(v as DifficultyBucket)}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any difficulty</SelectItem>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={issueType}
              onValueChange={(v) => setIssueType(v as TypeBucket)}
            >
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any type</SelectItem>
                <SelectItem value="bug">Bug</SelectItem>
                <SelectItem value="feature">Feature</SelectItem>
                <SelectItem value="documentation">Docs</SelectItem>
                <SelectItem value="test">Test</SelectItem>
                <SelectItem value="refactor">Refactor</SelectItem>
              </SelectContent>
            </Select>

            <Select value={age} onValueChange={(v) => setAge(v as AgeBucket)}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any age</SelectItem>
                <SelectItem value="fresh">Fresh (≤ 7d)</SelectItem>
                <SelectItem value="recent">Recent (≤ 30d)</SelectItem>
                <SelectItem value="normal">≤ 90d</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sort} onValueChange={(v) => setSort(v as SortOrder)}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quickest">Quickest win</SelectItem>
                <SelectItem value="wanted">Most wanted</SelectItem>
                <SelectItem value="freshest">Freshest</SelectItem>
                <SelectItem value="trending">Trending repos</SelectItem>
                <SelectItem value="merge_speed">Fastest merge</SelectItem>
              </SelectContent>
            </Select>

            <FilterMultiSelect
              available={available}
              setAvailable={setAvailable}
              responsiveOnly={responsiveOnly}
              setResponsiveOnly={setResponsiveOnly}
              helpWantedOnly={helpWantedOnly}
              setHelpWantedOnly={setHelpWantedOnly}
              bountyOnly={bountyOnly}
              setBountyOnly={setBountyOnly}
              permissiveOnly={permissiveOnly}
              setPermissiveOnly={setPermissiveOnly}
              wellDescribedOnly={wellDescribedOnly}
              setWellDescribedOnly={setWellDescribedOnly}
              trendingOnly={trendingOnly}
              setTrendingOnly={setTrendingOnly}
            />

            {anyFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </Button>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <SkeletonIssueCard key={i} />
              ))}
            </div>
          ) : paged.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <div className="mb-3 text-4xl">🪶</div>
              <p className="text-sm font-medium text-foreground">
                No matching issues
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Loosen a filter or try a different search.
              </p>
              {anyFilter && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearAll}
                  className="mt-3"
                >
                  Clear all filters
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {paged.map((i) => (
                <IssueCard
                  key={i.id}
                  issue={i}
                  onOpen={() => {
                    setSelected(i);
                    setDetailOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 sm:px-6">
            <p className="text-xs text-muted-foreground">
              Showing{" "}
              <span className="font-medium text-foreground tabular-nums">
                {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, sorted.length)}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground tabular-nums">
                {sorted.length.toLocaleString()}
              </span>
            </p>
            <div className="flex items-center gap-1">
              <Button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                size="sm"
                variant="outline"
              >
                <ChevronLeftIcon className="size-4" />
                <span className="hidden sm:inline">Previous</span>
              </Button>
              <Button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                size="sm"
                variant="outline"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        )}

        <IssueDetailDialog
          issue={selected}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      </div>
    </TooltipProvider>
  );
}

// ── Filter multi-select dropdown ───────────────────────────────────────────

type BoolSetter = (next: boolean | ((prev: boolean) => boolean)) => void;

function FilterMultiSelect({
  available,
  setAvailable,
  responsiveOnly,
  setResponsiveOnly,
  helpWantedOnly,
  setHelpWantedOnly,
  bountyOnly,
  setBountyOnly,
  permissiveOnly,
  setPermissiveOnly,
  wellDescribedOnly,
  setWellDescribedOnly,
  trendingOnly,
  setTrendingOnly,
}: {
  available: boolean;
  setAvailable: BoolSetter;
  responsiveOnly: boolean;
  setResponsiveOnly: BoolSetter;
  helpWantedOnly: boolean;
  setHelpWantedOnly: BoolSetter;
  bountyOnly: boolean;
  setBountyOnly: BoolSetter;
  permissiveOnly: boolean;
  setPermissiveOnly: BoolSetter;
  wellDescribedOnly: boolean;
  setWellDescribedOnly: BoolSetter;
  trendingOnly: boolean;
  setTrendingOnly: BoolSetter;
}) {
  const options: {
    key: string;
    label: string;
    hint?: string;
    checked: boolean;
    setChecked: BoolSetter;
  }[] = [
    {
      key: "available",
      label: "Available now",
      hint: "Hide assigned · open PR · claimed-by-label",
      checked: available,
      setChecked: setAvailable,
    },
    {
      key: "responsive",
      label: "Maintainer responsive",
      hint: "Avg first response < 72h",
      checked: responsiveOnly,
      setChecked: setResponsiveOnly,
    },
    {
      key: "helpWanted",
      label: "Help wanted",
      checked: helpWantedOnly,
      setChecked: setHelpWantedOnly,
    },
    {
      key: "bounty",
      label: "Has bounty",
      checked: bountyOnly,
      setChecked: setBountyOnly,
    },
    {
      key: "permissive",
      label: "Permissive license",
      hint: "MIT · Apache · BSD · ISC",
      checked: permissiveOnly,
      setChecked: setPermissiveOnly,
    },
    {
      key: "wellDescribed",
      label: "Well-described",
      hint: "Body > 200 chars",
      checked: wellDescribedOnly,
      setChecked: setWellDescribedOnly,
    },
    {
      key: "trending",
      label: "Trending repo",
      checked: trendingOnly,
      setChecked: setTrendingOnly,
    },
  ];

  const activeCount = options.reduce((n, o) => n + (o.checked ? 1 : 0), 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 gap-1.5 px-3 text-xs font-normal",
            activeCount > 0 && "border-primary/40 bg-primary/10 text-foreground",
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          Filter
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] tabular-nums"
            >
              {activeCount}
            </Badge>
          )}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Filters
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.key}
            checked={opt.checked}
            onCheckedChange={(c) => opt.setChecked(Boolean(c))}
            onSelect={(e) => e.preventDefault()}
            className="flex flex-col items-start gap-0.5 py-2"
          >
            <span className="text-xs font-medium">{opt.label}</span>
            {opt.hint && (
              <span className="pl-0 text-[10px] text-muted-foreground">
                {opt.hint}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
