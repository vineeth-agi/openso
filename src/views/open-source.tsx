"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDot,
  ExternalLink,
  GitFork,
  Star,
  Timer,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { relativeAge } from "@/lib/format";
import { cn } from "@/lib/utils";

type Project = {
  id: string;
  name: string;
  description: string;
  url: string;
  stars: string;
  forks: string;
  issues: string;
  language: string;
  languageColor: string;
  tags: string[];
  owner: string;
  avatar: string;
  ycBacked: boolean;
  lastCommitAt: string | null;
  activityLevel: string | null;
};

const getLanguageColor = (language: string) => {
  switch (language) {
    case "TypeScript":
      return "bg-blue-500";
    case "JavaScript":
      return "bg-yellow-400";
    case "Python":
      return "bg-blue-600";
    case "Rust":
      return "bg-orange-500";
    case "Go":
      return "bg-cyan-500";
    case "Java":
      return "bg-red-500";
    case "C++":
      return "bg-pink-500";
    case "C":
      return "bg-gray-500";
    default:
      return "bg-muted-foreground/64";
  }
};

const getLanguageSvg = (language: string): string | null => {
  const map: Record<string, string> = {
    TypeScript: "typescript",
    JavaScript: "javascript",
    Python: "python",
    Rust: "rust",
    Go: "go",
    Java: "java",
    C: "c",
    Bash: "bash",
  };
  return map[language] ? `/lang-icons/${map[language]}.svg` : null;
};

const ALL_LANGUAGES = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Rust",
  "Go",
  "Java",
  "C",
];

// -- Repo Card Component --
function RepoCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const svgPath = getLanguageSvg(project.language);
  const [imgError, setImgError] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-ring/50 hover:shadow-sm hover:shadow-ring/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Header: avatar + name + owner */}
      <div className="flex items-start gap-3">
        <div className="size-9 shrink-0 overflow-hidden rounded-lg border border-border bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
          {project.avatar && !imgError ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={project.avatar}
              alt={project.owner}
              className="size-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            (project.name ?? "?")[0].toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
            {project.name}
          </h3>
          <p className="text-xs text-muted-foreground">{project.owner}</p>
        </div>
        {project.ycBacked && (
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-orange-500 text-xs font-bold leading-none text-white" title="YC Backed">
            Y
          </span>
        )}
      </div>

      {/* Description */}
      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {project.description}
      </p>

      {/* Tags */}
      <div className="mt-3 flex flex-wrap gap-1">
        {project.tags.slice(0, 3).map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="text-xs px-1.5 py-0 font-normal"
          >
            {tag}
          </Badge>
        ))}
        {project.tags.length > 3 && (
          <span className="text-xs text-muted-foreground px-1">
            +{project.tags.length - 3}
          </span>
        )}
      </div>

      {/* Footer: language + stats */}
      <div className="mt-auto pt-3 flex items-center justify-between border-t border-border/50">
        <div className="flex items-center gap-1.5">
          {svgPath ? (
            <img src={svgPath} alt={project.language} width={14} height={14} className="shrink-0" />
          ) : (
            <span className={cn("size-2.5 rounded-full", getLanguageColor(project.language))} />
          )}
          <span className="text-xs text-muted-foreground">{project.language}</span>
          {project.lastCommitAt && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                title={`Last commit ${new Date(project.lastCommitAt).toLocaleDateString()}`}
              >
                <Timer className="size-3" />
                {relativeAge(project.lastCommitAt)}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 tabular-nums">
            <Star className="size-3" />
            {project.stars}
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            <GitFork className="size-3" />
            {project.forks}
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            <CircleDot className="size-3" />
            {project.issues}
          </span>
        </div>
      </div>
    </button>
  );
}

// -- Skeleton Card --
function SkeletonCard() {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-1/3 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-4/5 rounded bg-muted" />
      </div>
      <div className="mt-3 flex gap-1">
        <div className="h-4 w-12 rounded bg-muted" />
        <div className="h-4 w-14 rounded bg-muted" />
        <div className="h-4 w-10 rounded bg-muted" />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="h-3 w-24 rounded bg-muted" />
      </div>
    </div>
  );
}

// -- Detail Dialog --
function RepoDetailDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!project) return null;
  const svgPath = getLanguageSvg(project.language);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={project.avatar}
              alt={project.owner}
              className="size-10 rounded-lg border border-border"
            />
            <div>
              <DialogTitle className="text-lg">{project.name}</DialogTitle>
              <DialogDescription className="text-xs">
                {project.owner}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {project.description}
          </p>

          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Star className="size-4 text-yellow-500" />
              <span className="font-medium">{project.stars}</span>
              <span className="text-muted-foreground">stars</span>
            </div>
            <div className="flex items-center gap-1.5">
              <GitFork className="size-4 text-muted-foreground" />
              <span className="font-medium">{project.forks}</span>
              <span className="text-muted-foreground">forks</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CircleDot className="size-4 text-green-500" />
              <span className="font-medium">{project.issues}</span>
              <span className="text-muted-foreground">issues</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Language</span>
            <Badge variant="outline" className="gap-1.5">
              {svgPath ? (
                <img src={svgPath} alt={project.language} width={14} height={14} className="shrink-0" />
              ) : (
                <span className={cn("size-1.5 rounded-full", getLanguageColor(project.language))} />
              )}
              {project.language}
            </Badge>
            {project.ycBacked && (
              <Badge className="gap-1 bg-orange-500/15 text-orange-500 hover:bg-orange-500/20 border-orange-500/25">
                <span className="inline-flex size-3.5 items-center justify-center rounded-sm bg-orange-500 text-[9px] font-bold leading-none text-white">Y</span>
                YC Backed
              </Badge>
            )}
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground">Technologies</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {project.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Close
            </Button>
          </DialogClose>
          <Button size="sm" asChild>
            <a href={`${project.url}/issues`} target="_blank" rel="noopener noreferrer" className="gap-1.5">
              <CircleDot className="size-3.5" />
              View Issues
            </a>
          </Button>
          <Button size="sm" asChild>
            <a href={project.url} target="_blank" rel="noopener noreferrer" className="gap-1.5">
              <ExternalLink className="size-3.5" />
              Open on GitHub
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OpenSourceView() {
  const PAGE_SIZE = 12;
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [globalFilter, setGlobalFilter] = useState("");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [techFilter, setTechFilter] = useState<string>("all");
  const [ycFilter, setYcFilter] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Fetch projects via same-origin server endpoint (browser SDK
  // can't authenticate cross-origin to InsForge).
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const r = await fetch("/api/open-source/repos", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Request failed (${r.status})`);
        }
        const body = (await r.json()) as {
          data: Array<{
            id: string;
            name: string;
            description: string | null;
            url: string;
            stars: number;
            forks: number;
            issues: number;
            language: string | null;
            language_color: string | null;
            tags: string[];
            owner: string | null;
            avatar: string | null;
            yc_backed: boolean | null;
            last_commit_at: string | null;
            activity_level: string | null;
          }>;
        };

        const transformedData: Project[] = (body.data ?? []).map((repo) => ({
          id: repo.id,
          name: repo.name,
          description: repo.description ?? "",
          url: repo.url,
          stars: String(repo.stars ?? 0),
          forks: String(repo.forks ?? 0),
          issues: String(repo.issues ?? 0),
          language: repo.language ?? "",
          languageColor: repo.language_color ?? "",
          tags: repo.tags ?? [],
          owner: repo.owner ?? "",
          avatar: repo.avatar ?? "",
          ycBacked: Boolean(repo.yc_backed),
          lastCommitAt: repo.last_commit_at ?? null,
          activityLevel: repo.activity_level ?? null,
        }));

        setProjects(transformedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load repos");
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  const ALL_TECHNOLOGIES = useMemo(
    () => Array.from(new Set(projects.flatMap((p) => p.tags))).sort(),
    [projects],
  );

  // Filter projects
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (languageFilter !== "all" && p.language !== languageFilter) return false;
      if (techFilter !== "all" && !p.tags.includes(techFilter)) return false;
      if (ycFilter && !p.ycBacked) return false;
      if (globalFilter) {
        const search = globalFilter.toLowerCase();
        const matches =
          p.name.toLowerCase().includes(search) ||
          p.description.toLowerCase().includes(search) ||
          p.owner.toLowerCase().includes(search) ||
          p.language.toLowerCase().includes(search) ||
          p.tags.some((t) => t.toLowerCase().includes(search));
        if (!matches) return false;
      }
      return true;
    });
  }, [projects, languageFilter, techFilter, ycFilter, globalFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredProjects.length / PAGE_SIZE);
  const paginatedProjects = useMemo(
    () => filteredProjects.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredProjects, page],
  );

  const totalIssues = useMemo(
    () =>
      filteredProjects.reduce((sum, p) => {
        const n = parseFloat(p.issues.replace("k", "")) * (p.issues.includes("k") ? 1000 : 1);
        return sum + n;
      }, 0),
    [filteredProjects],
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [languageFilter, techFilter, ycFilter, globalFilter]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-destructive font-medium">Failed to load repositories</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <h1 className="text-base font-semibold">Open Source Projects</h1>
            <p className="text-xs text-muted-foreground">
              {filteredProjects.length} repositories &middot;{" "}
              <span className="inline-flex items-center gap-1">
                <CircleDot className="inline size-3" />
                {totalIssues.toLocaleString()} total issues
              </span>
            </p>
          </div>
          <div className="relative w-full sm:w-auto">
            <input
              type="text"
              placeholder="Search projects..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="h-8 w-full sm:w-56 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap overflow-x-auto">
          <Select
            value={languageFilter}
            onValueChange={setLanguageFilter}
          >
            <SelectTrigger className="w-full sm:w-42.5" size="sm">
              <SelectValue placeholder="All Languages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <span className="flex items-center gap-2">All Languages</span>
              </SelectItem>
              {ALL_LANGUAGES.map((lang) => {
                const svgPath = getLanguageSvg(lang);
                return (
                  <SelectItem key={lang} value={lang}>
                    <span className="flex items-center gap-2">
                      {svgPath ? (
                        <img src={svgPath} alt={lang} width={14} height={14} className="shrink-0" />
                      ) : (
                        <span className={cn("size-2.5 rounded-full", getLanguageColor(lang))} />
                      )}
                      {lang}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Select
            value={techFilter}
            onValueChange={setTechFilter}
          >
            <SelectTrigger className="w-full sm:w-44" size="sm">
              <SelectValue placeholder="All Technologies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Technologies</SelectItem>
              {ALL_TECHNOLOGIES.map((tech) => (
                <SelectItem key={tech} value={tech}>
                  {tech}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={ycFilter ? "default" : "outline"}
            size="sm"
            onClick={() => setYcFilter((prev) => !prev)}
            className="gap-1.5 text-xs"
          >
            <span className="inline-flex size-4 items-center justify-center rounded-sm bg-orange-500 text-xs font-bold leading-none text-white">
              Y
            </span>
            YC Backed
          </Button>

          {(languageFilter !== "all" || techFilter !== "all" || ycFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLanguageFilter("all");
                setTechFilter("all");
                setYcFilter(false);
              }}
              className="text-xs text-muted-foreground"
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Card Grid */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : paginatedProjects.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-sm font-medium text-foreground">No repositories found</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try adjusting your search or filters
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paginatedProjects.map((project) => (
              <RepoCard
                key={project.id}
                project={project}
                onClick={() => {
                  setSelectedProject(project);
                  setDetailOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-2.5 sm:px-6">
          <p className="text-sm text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredProjects.length)}
            </span>{" "}
            of{" "}
            <span className="font-medium text-foreground">
              {filteredProjects.length}
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

      {/* Detail Dialog */}
      <RepoDetailDialog
        project={selectedProject}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
