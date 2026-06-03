"use client";

import { useState, useEffect } from "react";

import {
  Briefcase,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  ExternalLink,
  MapPin,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Types ──

interface JobListing {
  id: string;
  title: string;
  url: string;
  apply_url: string | null;
  location_raw: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  is_remote: boolean;
  workplace_type: string | null;
  department: string | null;
  category: string | null;
  experience_level: string | null;
  job_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_raw: string | null;
  has_equity: boolean | null;
  skills: string[];
  tech_stack: string[];
  programming_languages: string[];
  visa_sponsorship: string | null;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  days_listed: number;
  is_likely_ghost: boolean;
  benefits_detected: string[];
  company_id: string;
  job_board_companies: {
    name: string;
    slug: string;
    logo_url: string | null;
    one_liner: string | null;
    industry: string | null;
    team_size: number | null;
    stage: string | null;
    is_yc: boolean;
    yc_batch: string | null;
    hq_location: string | null;
    tags: string[];
  } | null;
}

// ── Helpers ──

function formatSalary(min: number | null, max: number | null, currency: string | null): string | null {
  if (!min && !max) return null;
  const cur = currency ?? "USD";
  const fmt = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
    return n.toString();
  };
  if (min && max) return `${cur === "USD" ? "$" : cur + " "}${fmt(min)} – ${fmt(max)}`;
  if (max) return `Up to ${cur === "USD" ? "$" : cur + " "}${fmt(max)}`;
  if (min) return `${cur === "USD" ? "$" : cur + " "}${fmt(min)}+`;
  return null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const EXPERIENCE_LABELS: Record<string, string> = {
  internship: "Internship",
  entry: "Entry Level",
  mid: "Mid Level",
  senior: "Senior",
  staff: "Staff",
  lead: "Lead",
  director: "Director",
  vp: "VP",
  executive: "Executive",
};

const CATEGORY_LABELS: Record<string, string> = {
  engineering: "Engineering",
  design: "Design",
  product: "Product",
  data: "Data",
  marketing: "Marketing",
  sales: "Sales",
  ops: "Operations",
  people: "People",
  finance: "Finance",
  security: "Security",
  research: "Research",
  support: "Support",
};

// Best-effort label for a country value coming from `job_board_listings.country`.
// Some rows store ISO 3166-1 alpha-2 codes ("US", "IN"), others store full names
// ("United States"). We map the common 2-letter codes for nicer display and
// fall back to the raw value otherwise.
const COUNTRY_NAME_BY_CODE: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  UK: "United Kingdom",
  IE: "Ireland",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  NL: "Netherlands",
  PT: "Portugal",
  CH: "Switzerland",
  SE: "Sweden",
  NO: "Norway",
  FI: "Finland",
  DK: "Denmark",
  PL: "Poland",
  IN: "India",
  SG: "Singapore",
  AU: "Australia",
  NZ: "New Zealand",
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  HK: "Hong Kong",
  TW: "Taiwan",
  BR: "Brazil",
  MX: "Mexico",
  AR: "Argentina",
  IL: "Israel",
  AE: "United Arab Emirates",
  ZA: "South Africa",
};

function countryLabel(code: string): string {
  const trimmed = code.trim();
  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    return COUNTRY_NAME_BY_CODE[upper] ?? upper;
  }
  return trimmed;
}

// ── Job Card ──

function JobCard({ job }: { job: JobListing }) {
  const company = job.job_board_companies;
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency);
  const [imgError, setImgError] = useState(false);

  return (
    <a
      href={job.apply_url || job.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Header: Logo + Company + Title */}
      <div className="flex items-start gap-3">
        {company?.logo_url && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logo_url}
            alt={company.name}
            className="size-10 shrink-0 rounded-lg border border-border bg-white object-contain p-1"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-xs font-bold text-muted-foreground">
            {(company?.name ?? "?")[0]}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
            {job.title}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-muted-foreground truncate">{company?.name ?? "Unknown"}</span>
            {company?.is_yc && (
              <span className="inline-flex size-4 items-center justify-center rounded bg-orange-500 text-[8px] font-bold text-white shrink-0" title={`YC ${company.yc_batch ?? ""}`}>
                Y
              </span>
            )}
          </div>
        </div>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Location + Salary + Type */}
      <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        {job.location_raw && (
          <span className="flex items-center gap-1">
            <MapPin className="size-3" />
            {job.location_raw.length > 30 ? job.location_raw.slice(0, 30) + "…" : job.location_raw}
          </span>
        )}
        {job.workplace_type && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0">
            {job.workplace_type}
          </Badge>
        )}
        {salary && (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
            <DollarSign className="size-3" />
            {salary}
          </span>
        )}
        {job.has_equity && (
          <Badge variant="outline" className="text-xs px-1.5 py-0 border-purple-500/30 text-purple-500">
            +Equity
          </Badge>
        )}
      </div>

      {/* Skills/Tech */}
      {(job.skills.length > 0 || job.tech_stack.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1">
          {[...new Set([...job.skills, ...job.tech_stack])].slice(0, 4).map((skill, i) => (
            <Badge key={`${skill}-${i}`} variant="secondary" className="text-xs px-1.5 py-0 font-normal">
              {skill}
            </Badge>
          ))}
          {[...new Set([...job.skills, ...job.tech_stack])].length > 4 && (
            <span className="text-xs text-muted-foreground px-1">
              +{[...new Set([...job.skills, ...job.tech_stack])].length - 4}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto pt-3 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {job.experience_level && (
            <span>{EXPERIENCE_LABELS[job.experience_level] ?? job.experience_level}</span>
          )}
          {job.experience_level && job.job_type && <span>•</span>}
          {job.job_type && <span>{job.job_type}</span>}
        </div>
        <span className="flex items-center gap-1">
          <Clock className="size-2.5" />
          {timeAgo(job.posted_at || job.first_seen_at)}
        </span>
      </div>
    </a>
  );
}

// ── Skeleton ──

function SkeletonCard() {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-3 w-1/3 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
      <div className="mt-3 flex gap-1">
        <div className="h-4 w-12 rounded bg-muted" />
        <div className="h-4 w-14 rounded bg-muted" />
        <div className="h-4 w-10 rounded bg-muted" />
      </div>
      <div className="mt-auto pt-3 flex justify-between">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="h-3 w-12 rounded bg-muted" />
      </div>
    </div>
  );
}

// ── Main Page ──

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [experienceFilter, setExperienceFilter] = useState("all");
  const [workplaceFilter, setWorkplaceFilter] = useState("all");
  const [ycFilter, setYcFilter] = useState(false);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [availableCountries, setAvailableCountries] = useState<string[]>([]);
  const [countrySearch, setCountrySearch] = useState("");

  // Pagination states
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const limit = 24;

  // Debounce search query to prevent high frequency backend API hits
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset page to 1 when filters or search term changes
  useEffect(() => {
    setPage(1);
  }, [
    categoryFilter,
    experienceFilter,
    workplaceFilter,
    debouncedSearch,
    ycFilter,
    selectedCountries,
  ]);

  // Load distinct country values once for the Location dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/jobs/countries");
        if (!res.ok) return;
        const data = (await res.json()) as { countries?: string[] };
        if (cancelled) return;
        setAvailableCountries(data.countries ?? []);
      } catch {
        // Silent failure — Location dropdown just stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const fetchJobs = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (categoryFilter !== "all") params.set("category", categoryFilter);
        if (experienceFilter !== "all") params.set("experience_level", experienceFilter);
        if (workplaceFilter !== "all") params.set("workplace_type", workplaceFilter);
        if (ycFilter) params.set("is_yc", "true");
        if (selectedCountries.length > 0) {
          params.set("country", selectedCountries.join(","));
        }
        if (debouncedSearch.trim() !== "") params.set("search", debouncedSearch.trim());
        params.set("page", page.toString());
        params.set("limit", limit.toString());

        const res = await fetch(`/api/jobs?${params}`);
        if (!res.ok) throw new Error("Failed to fetch jobs");
        const data = await res.json();
        setJobs(data.jobs ?? []);
        setTotalCount(data.pagination?.totalCount ?? 0);
        setTotalPages(data.pagination?.totalPages ?? 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      } finally {
        setLoading(false);
      }
    };
    fetchJobs();
  }, [
    page,
    categoryFilter,
    experienceFilter,
    workplaceFilter,
    debouncedSearch,
    ycFilter,
    selectedCountries,
  ]);

  // Since filtering is fully server-side, filteredJobs is just jobs
  const filteredJobs = jobs;

  // Generate array of page numbers with ellipsis support
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (page > 3) {
        pages.push("...");
      }

      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (page < totalPages - 2) {
        pages.push("...");
      }

      // Always show last page
      pages.push(totalPages);
    }

    return pages;
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-destructive font-medium">Failed to load jobs</p>
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
            <h1 className="text-base font-semibold flex items-center gap-2">
              <Briefcase className="size-4" />
              Job Board
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalCount} active listings from top companies
            </p>
          </div>
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search jobs, companies, skills..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 w-full sm:w-56 text-sm"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap overflow-x-auto">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-36" size="sm">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={experienceFilter} onValueChange={setExperienceFilter}>
            <SelectTrigger className="w-full sm:w-36" size="sm">
              <SelectValue placeholder="Experience" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              {Object.entries(EXPERIENCE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={workplaceFilter} onValueChange={setWorkplaceFilter}>
            <SelectTrigger className="w-full sm:w-36" size="sm">
              <SelectValue placeholder="Workplace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="remote">Remote</SelectItem>
              <SelectItem value="hybrid">Hybrid</SelectItem>
              <SelectItem value="onsite">On-site</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 gap-1.5 px-3 text-xs font-normal",
                  selectedCountries.length > 0 &&
                    "border-primary/40 bg-primary/10 text-foreground",
                )}
              >
                <MapPin className="size-3.5" />
                Location
                {selectedCountries.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] tabular-nums"
                  >
                    {selectedCountries.length}
                  </Badge>
                )}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                Country
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableCountries.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No countries available
                </div>
              ) : (
                <>
                  {/* Search input — wrapped so clicks/keystrokes don't close
                      the dropdown or trigger Radix's roving focus. */}
                  <div
                    className="px-2 pb-2"
                    onKeyDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search countries..."
                        value={countrySearch}
                        onChange={(e) => setCountrySearch(e.target.value)}
                        className="h-7 pl-7 text-xs"
                      />
                    </div>
                  </div>
                  {(() => {
                    const q = countrySearch.trim().toLowerCase();
                    const filtered = q
                      ? availableCountries.filter((c) => {
                          const raw = c.toLowerCase();
                          const label = countryLabel(c).toLowerCase();
                          return raw.includes(q) || label.includes(q);
                        })
                      : availableCountries;

                    if (filtered.length === 0) {
                      return (
                        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                          No matches for &ldquo;{countrySearch}&rdquo;
                        </div>
                      );
                    }

                    return (
                      <div className="max-h-72 overflow-y-auto">
                        {filtered.map((c) => {
                          const checked = selectedCountries.includes(c);
                          return (
                            <DropdownMenuCheckboxItem
                              key={c}
                              checked={checked}
                              onCheckedChange={(next) => {
                                setSelectedCountries((prev) =>
                                  next
                                    ? prev.includes(c)
                                      ? prev
                                      : [...prev, c]
                                    : prev.filter((v) => v !== c),
                                );
                              }}
                              onSelect={(e) => e.preventDefault()}
                              className="text-xs"
                            >
                              {countryLabel(c)}
                            </DropdownMenuCheckboxItem>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant={ycFilter ? "default" : "outline"}
            size="sm"
            onClick={() => setYcFilter((prev) => !prev)}
            className="gap-1.5 text-xs"
          >
            <span className="inline-flex size-4 items-center justify-center rounded-sm bg-orange-500 text-xs font-bold leading-none text-white">
              Y
            </span>
            YC Companies
          </Button>

          {(categoryFilter !== "all" ||
            experienceFilter !== "all" ||
            workplaceFilter !== "all" ||
            ycFilter ||
            selectedCountries.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCategoryFilter("all");
                setExperienceFilter("all");
                setWorkplaceFilter("all");
                setYcFilter(false);
                setSelectedCountries([]);
              }}
              className="text-xs text-muted-foreground"
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Job Grid */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <Briefcase className="size-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-foreground">No jobs found</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try adjusting your filters or search query
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t bg-card/35 backdrop-blur-sm px-4 py-3 sm:px-6 shrink-0">
          {/* Mobile view */}
          <div className="flex flex-1 justify-between sm:hidden">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="select-none text-xs"
            >
              Previous
            </Button>
            <span className="flex items-center text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="select-none text-xs"
            >
              Next
            </Button>
          </div>

          {/* Desktop view */}
          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-medium text-foreground">{((page - 1) * limit) + 1}</span> to{" "}
                <span className="font-medium text-foreground">
                  {Math.min(totalCount, page * limit)}
                </span>{" "}
                of <span className="font-medium text-foreground">{totalCount}</span> results
              </p>
            </div>
            <div>
              <nav className="isolate inline-flex -space-x-px rounded-md shadow-xs gap-1" aria-label="Pagination">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="size-8 p-0"
                >
                  <span className="sr-only">Previous</span>
                  <ChevronLeft className="size-4" />
                </Button>

                {getPageNumbers().map((p, idx) => {
                  if (p === "...") {
                    return (
                      <span
                        key={`ellipsis-${idx}`}
                        className="inline-flex size-8 items-center justify-center text-xs text-muted-foreground"
                      >
                        ...
                      </span>
                    );
                  }

                  const pageNum = p as number;
                  return (
                    <Button
                      key={`page-${pageNum}`}
                      variant={pageNum === page ? "default" : "outline"}
                      size="icon"
                      onClick={() => setPage(pageNum)}
                      className={cn(
                        "size-8 text-xs font-medium",
                        pageNum === page
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      {pageNum}
                    </Button>
                  );
                })}

                <Button
                  variant="outline"
                  size="icon"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="size-8 p-0"
                >
                  <span className="sr-only">Next</span>
                  <ChevronRight className="size-4" />
                </Button>
              </nav>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
