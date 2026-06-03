"use client";

import { useEffect, useMemo, useState } from "react";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  Clock,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cronToHuman } from "@/lib/cron";
import { formatRelativeTime } from "@/lib/format";

// ── Display cron times in the user's browser local timezone ──
// Storage is always UTC; this converts for human display only.
function cronToHumanLocal(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return cronToHuman(expr);
  const [minStr, hourStr, , , dow] = parts;

  // Interval expressions — no time conversion needed
  if (minStr === "*" && hourStr === "*") return "Every minute";
  if (minStr.startsWith("*/") && hourStr === "*")
    return `Every ${minStr.slice(2)} min`;
  if (minStr === "0" && hourStr.startsWith("*/"))
    return `Every ${hourStr.slice(2)} hours`;
  if (minStr.startsWith("*/") || hourStr.startsWith("*/") || hourStr === "*")
    return cronToHuman(expr); // step/wildcard — no local conversion possible

  const utcMin = parseInt(minStr, 10);
  const utcHour = parseInt(hourStr, 10);
  if (isNaN(utcMin) || isNaN(utcHour)) return cronToHuman(expr);

  // Convert UTC time → local wall-clock time using the browser's timezone
  const d = new Date();
  d.setUTCHours(utcHour, utcMin, 0, 0);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const mm = m.toString().padStart(2, "0");
  const timeStr = `${h12}:${mm} ${period}`;

  // Short timezone abbreviation (e.g. "IST", "PST")
  const tzShort =
    new Intl.DateTimeFormat("en", { timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "";

  const label = `${timeStr}${tzShort ? ` ${tzShort}` : ""}`;

  if (dow === "*") return `Daily at ${label}`;
  if (dow === "1-5") return `Weekdays at ${label}`;
  if (dow === "0,6" || dow === "6,0") return `Weekends at ${label}`;
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = dow
    .split(",")
    .map((n) => DAY[parseInt(n, 10)] ?? n)
    .join(", ");
  return `${days} at ${label}`;
}

type CronJob = {
  id: string;
  name: string;
  description: string;
  cron_expression: string;
  function_id: string;
  enabled: boolean;
  run_count: number;
  last_run_at: string | null;
  last_result: string | null;
  next_run_at: string | null;
  created_at: string;
};



function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        enabled
          ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
          : "border-muted-foreground/30 bg-muted text-muted-foreground"
      }
    >
      <span
        className={`mr-1.5 inline-block size-1.5 rounded-full ${enabled ? "bg-green-500" : "bg-muted-foreground/60"}`}
      />
      {enabled ? "Active" : "Paused"}
    </Badge>
  );
}

// ── Add Cron Job Dialog ──
function AddCronDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time dialog opens
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const canSubmit = name.trim().length > 0 && description.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      // Step 1: Ask AI to parse the cron expression from the description
      const parseRes = await fetch("/api/cron/parse-nl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const parsed = parseRes.ok
        ? (await parseRes.json() as { cronExpression?: string | null; confidence?: number })
        : null;
      const cronExpression =
        parsed?.cronExpression && (parsed.confidence ?? 0) > 0.3
          ? parsed.cronExpression
          : null;
      if (!cronExpression) {
        setError("Could not detect a schedule from your description. Try adding a time like \"at 9am IST\" or \"every weekday\".");
        setSaving(false);
        return;
      }

      // Step 2: Schedule the task
      const res = await fetch("/api/cron/schedule-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskName: name.trim(), description: description.trim(), cronExpression }),
      });
      if (!res.ok) {
        // Try to parse a structured error so we can show a useful
        // message (notably the QStash quota case — see API route).
        let serverMessage = "Failed to schedule task";
        try {
          const body = (await res.json()) as { error?: string; code?: string };
          if (body?.error) serverMessage = body.error;
        } catch {
          /* fall through to generic message */
        }
        throw new Error(serverMessage);
      }
      setName("");
      setDescription("");
      onAdded();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Cron Job</DialogTitle>
          <DialogDescription>Schedule a recurring agent task.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="cron-name">Task Name</Label>
            <Input
              id="cron-name"
              placeholder="e.g. Daily email digest"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cron-desc">
              Description
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                — include time &amp; frequency
              </span>
            </Label>
            <Textarea
              id="cron-desc"
              placeholder="e.g. check my mails every weekday at 9am IST and summarize"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Include when it should run, e.g. “at 9am IST” or “every weekday”
            </p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">Cancel</Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
          >
            {saving ? "Saving..." : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail Dialog ──
function DetailDialog({
  job,
  open,
  onOpenChange,
}: {
  job: CronJob | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!job) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{job.name}</DialogTitle>
          <DialogDescription className="text-xs">{job.cron_expression}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <p className="text-sm leading-relaxed text-muted-foreground">{job.description}</p>

          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <StatusBadge enabled={job.enabled} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Run Count</p>
              <p className="font-medium tabular-nums">{job.run_count}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last Run</p>
              <p className="font-medium">{formatRelativeTime(job.last_run_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Next Run</p>
              <p className="font-medium">{formatRelativeTime(job.next_run_at)}</p>
            </div>
          </div>

          {job.last_result && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Last Result</p>
              <div className="max-h-28 overflow-y-auto rounded-md bg-muted p-2.5 text-xs leading-relaxed prose prose-sm dark:prose-invert max-w-none [&_p]:text-xs [&_li]:text-xs [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_strong]:text-foreground">
                <Markdown content={job.last_result} />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Schedule</p>
            <Badge variant="outline" className="gap-1.5" suppressHydrationWarning>
              <Clock className="size-3" />
              <span suppressHydrationWarning>{cronToHumanLocal(job.cron_expression)}</span>
            </Badge>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Actions Cell ──
function ActionsCell({
  job,
  onToggle,
  onDelete,
}: {
  job: CronJob;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setDetailOpen(true)}>
            View Details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onToggle(job.id, !job.enabled)}
            className="flex items-center gap-2"
          >
            {job.enabled ? (
              <>
                <RotateCcw className="size-3.5" />
                Pause Job
              </>
            ) : (
              <>
                <Play className="size-3.5" />
                Resume Job
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDelete(job.id)}
            className="flex items-center gap-2 text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DetailDialog job={job} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
}

// ── Main View ──
export function CronJobsView() {
  const pageSize = 10;
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [fixingSchedules, setFixingSchedules] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const [sorting, setSorting] = useState<SortingState>([]);

  const fetchJobs = async () => {
    try {
      // Same-origin endpoint reads the httpOnly cookie and forwards
      // the bearer to InsForge. Browser-direct SDK calls fail to
      // authenticate cross-origin.
      const r = await fetch("/api/cron/jobs", {
        method: "GET",
        credentials: "same-origin",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${r.status})`);
      }
      const body = (await r.json()) as { data: typeof jobs };
      setJobs(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cron jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, []);

  const recalculateNextRuns = async () => {
    setFixingSchedules(true);
    try {
      await fetch("/api/cron/recalculate-next-run", { method: "POST" });
      await fetchJobs();
    } finally {
      setFixingSchedules(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch("/api/cron/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", jobId: id, enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, enabled } : j)));
    } catch (err) {
      toast.error(`Failed to ${enabled ? "enable" : "pause"} job: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch("/api/cron/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", jobId: id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (err) {
      toast.error(`Failed to delete job: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const filteredData = useMemo(
    () =>
      jobs.filter((j) => {
        if (statusFilter === "active" && !j.enabled) return false;
        if (statusFilter === "paused" && j.enabled) return false;
        return true;
      }),
    [jobs, statusFilter],
  );

  const columns: ColumnDef<CronJob>[] = useMemo(
    () => [
      {
        id: "select",
        size: 28,
        enableSorting: false,
        header: ({ table }) => {
          const isAllSelected = table.getIsAllPageRowsSelected();
          const isSomeSelected = table.getIsSomePageRowsSelected();
          return (
            <Checkbox
              aria-label="Select all rows"
              checked={isAllSelected ? true : isSomeSelected ? "indeterminate" : false}
              onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            />
          );
        },
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
          />
        ),
      },
      {
        accessorKey: "name",
        header: "Task",
        size: 220,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.description}</p>
          </div>
        ),
      },
      {
        accessorKey: "cron_expression",
        header: "Schedule",
        size: 180,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <Badge variant="outline" className="w-fit gap-1.5 text-xs" suppressHydrationWarning>
              <Clock className="size-3" />
              <span suppressHydrationWarning>{cronToHumanLocal(row.original.cron_expression)}</span>
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">{row.original.cron_expression}</span>
          </div>
        ),
      },
      {
        accessorKey: "enabled",
        header: "Status",
        size: 100,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={row.original.enabled}
              onCheckedChange={(v) => handleToggle(row.original.id, v)}
              onClick={(e) => e.stopPropagation()}
            />
            <StatusBadge enabled={row.original.enabled} />
          </div>
        ),
      },
      {
        accessorKey: "run_count",
        header: "Runs",
        size: 70,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">{row.original.run_count}</span>
        ),
      },
      {
        accessorKey: "last_run_at",
        header: "Last Run",
        size: 110,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground text-sm">
            {formatRelativeTime(row.original.last_run_at)}
          </span>
        ),
      },
      {
        accessorKey: "next_run_at",
        header: "Next Run",
        size: 110,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground text-sm">
            {formatRelativeTime(row.original.next_run_at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 50,
        enableSorting: false,
        cell: ({ row }) => (
          <ActionsCell
            job={row.original}
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
        ),
      },
    ],
     
    [],
  );

  const globalFilterFn = (row: { original: CronJob }, _: string, filterValue: string) => {
    const s = filterValue.toLowerCase();
    return (
      row.original.name.toLowerCase().includes(s) ||
      row.original.description.toLowerCase().includes(s) ||
      row.original.cron_expression.toLowerCase().includes(s)
    );
  };

  const coreRowModel = useMemo(() => getCoreRowModel<CronJob>(), []);
  const filteredRowModel = useMemo(() => getFilteredRowModel<CronJob>(), []);
  const paginationRowModel = useMemo(() => getPaginationRowModel<CronJob>(), []);
  const sortedRowModel = useMemo(() => getSortedRowModel<CronJob>(), []);

  const table = useReactTable({
    columns,
    data: filteredData,
    enableSortingRemoval: false,
    getCoreRowModel: coreRowModel,
    getFilteredRowModel: filteredRowModel,
    getPaginationRowModel: paginationRowModel,
    getSortedRowModel: sortedRowModel,
    globalFilterFn,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    state: { globalFilter, pagination, sorting },
  });

  const activeCount = jobs.filter((j) => j.enabled).length;
  const totalRuns = jobs.reduce((s, j) => s + j.run_count, 0);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading cron jobs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-destructive">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <h1 className="text-base font-semibold">Cron Jobs</h1>
            <p className="text-xs text-muted-foreground">
              {activeCount} active &middot;{" "}
              <span className="inline-flex items-center gap-1">
                <Timer className="inline size-3" />
                {totalRuns.toLocaleString()} total runs
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-full sm:w-auto">
              <input
                type="text"
                placeholder="Search jobs..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="h-8 w-full sm:w-52 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={recalculateNextRuns}
              disabled={fixingSchedules}
              title="Recalculate Next Run times for all jobs (UTC fix)"
            >
              <RotateCcw className={`size-3.5 ${fixingSchedules ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{fixingSchedules ? "Fixing…" : "Fix Schedule"}</span>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" />
              New Job
            </Button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as "all" | "active" | "paused");
              setPagination((prev) => ({ ...prev, pageIndex: 0 }));
            }}
          >
            <SelectTrigger className="w-36" size="sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>

          {statusFilter !== "all" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter("all");
                setPagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
              className="text-xs text-muted-foreground"
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-[640px]">
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow className="hover:bg-transparent" key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const columnSize = header.column.getSize();
                  return (
                    <TableHead
                      key={header.id}
                      style={columnSize ? { width: `${columnSize}px` } : undefined}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <div
                          className="flex h-full cursor-pointer select-none items-center justify-between gap-2"
                          onClick={header.column.getToggleSortingHandler()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              header.column.getToggleSortingHandler()?.(e);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {{
                            asc: <ChevronUpIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />,
                            desc: <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />,
                          }[header.column.getIsSorted() as string] ?? null}
                        </div>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  key={row.id}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell className="h-24 text-center" colSpan={columns.length}>
                  {jobs.length === 0
                    ? "No cron jobs yet. Click \"New Job\" to schedule one."
                    : "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Footer with pagination */}
      <div className="flex flex-col gap-2 border-t px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <p className="text-muted-foreground text-sm">Viewing</p>
          <Select
            onValueChange={(value) => table.setPageIndex(Number(value) - 1)}
            value={String(table.getState().pagination.pageIndex + 1)}
          >
            <SelectTrigger aria-label="Select result range" className="w-fit" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: Math.max(1, table.getPageCount()) }, (_, i) => {
                const start = i * table.getState().pagination.pageSize + 1;
                const end = Math.min(
                  (i + 1) * table.getState().pagination.pageSize,
                  table.getFilteredRowModel().rows.length,
                );
                return (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {`${start}-${end}`}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            of{" "}
            <strong className="font-medium text-foreground">
              {table.getFilteredRowModel().rows.length}
            </strong>{" "}
            results
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            size="sm"
            variant="outline"
          >
            <ChevronLeftIcon className="size-4" />
            <span className="hidden sm:inline">Previous</span>
          </Button>
          <Button
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            size="sm"
            variant="outline"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>

      <AddCronDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => { setLoading(true); fetchJobs(); }}
      />
    </div>
  );
}
