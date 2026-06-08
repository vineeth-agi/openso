"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";

import { useSearchParams } from "next/navigation";

import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Unplug,
  RefreshCw,
  Send,
  ExternalLink,
  Shield,
  Plug,
  Circle,
  FileText,
  Upload,
} from "lucide-react";
import { useTheme } from "next-themes";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── App Definitions ──

type ProviderSlug = "github";

interface AppDef {
  provider: ProviderSlug;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  color: string;
  gradient: string;
  oauthHref: string;
  scopes: string[];
  invertInLight?: boolean;
}

const APPS: AppDef[] = [
  {
    provider: "github",
    name: "GitHub",
    tagline: "Code, issues & pull requests",
    description: "Access repos, issues and PRs. Create issues, review code and open pull requests.",
    icon: "/connectors/github-dark.svg",
    color: "#24292e",
    gradient: "from-neutral-500/20 to-slate-500/10",
    oauthHref: "/api/auth/github",
    scopes: ["Repos", "Issues", "Pull Requests"],
    invertInLight: true,
  },
];

interface ConnectionStatus {
  provider: string;
  account_email: string | null;
  account_name: string | null;
  account_avatar: string | null;
  github_username: string | null;
  connected: boolean;
  jobStatus?: string | null;
}

interface TelegramStatus {
  connected: boolean;
  botUsername: string | null;
  chatLinked: boolean;
}

// ── Connector Card ──

function ConnectorCard({
  app,
  connection,
  onConnect,
  onDisconnect,
  disconnecting,
}: {
  app: AppDef;
  connection: ConnectionStatus | null;
  onConnect: () => void;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const isConnected = !!connection?.connected;
  const shouldInvert = app.invertInLight && resolvedTheme === "light";

  const getGitHubStatus = () => {
    if (app.provider !== "github" || !isConnected) return null;
    const status = connection?.jobStatus;
    if (!status || ["queued", "scanning", "retrying", "rate_limited"].includes(status)) {
      return (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
          <Loader2 className="size-3 animate-spin text-amber-500" />
          <span>Indexing skills...</span>
        </div>
      );
    }
    if (status === "completed") {
      return (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
          <CheckCircle2 className="size-3 text-emerald-500" />
          <span>Indexing completed</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 text-xs text-destructive font-medium bg-destructive/10 border border-destructive/20 px-2 py-0.5 rounded-full">
        <AlertTriangle className="size-3 text-destructive" />
        <span>Indexing failed</span>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card p-5 transition-all",
        isConnected
          ? "border-emerald-500/30 shadow-sm shadow-emerald-500/5"
          : "border-border hover:border-border/80 hover:shadow-sm",
      )}
    >
      {/* Status indicator */}
      <div className="absolute right-4 top-4">
        {isConnected ? (
          app.provider === "github" ? (
            getGitHubStatus()
          ) : (
            <div className="flex items-center gap-1.5">
              <Circle className="size-2 fill-emerald-500 text-emerald-500" />
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Connected</span>
            </div>
          )
        ) : (
          <div className="flex items-center gap-1.5">
            <Circle className="size-2 fill-muted-foreground/30 text-muted-foreground/30" />
            <span className="text-xs text-muted-foreground">Not connected</span>
          </div>
        )}
      </div>

      {/* Icon + Name */}
      <div className="flex items-start gap-3.5">
        <div className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br",
          app.gradient,
        )}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={app.icon}
            alt={app.name}
            className={cn("size-6", shouldInvert && "invert")}
          />
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-sm font-semibold text-foreground">{app.name}</h3>
          <p className="text-xs text-muted-foreground">{app.tagline}</p>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground line-clamp-2">
        {app.description}
      </p>

      {/* Scopes */}
      <div className="mt-3 flex flex-wrap gap-1">
        {app.scopes.map((scope) => (
          <Badge
            key={scope}
            variant="secondary"
            className="text-xs px-1.5 py-0 font-normal"
          >
            {scope}
          </Badge>
        ))}
      </div>

      {/* Connected account info */}
      {isConnected && connection && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
          {connection.account_avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={connection.account_avatar}
              alt=""
              className="size-5 rounded-full"
            />
          )}
          <span className="truncate text-xs text-foreground">
            {connection.account_name || connection.account_email || connection.github_username || "Connected"}
          </span>
        </div>
      )}

      {/* Action button */}
      <div className="mt-auto pt-4">
        {isConnected ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50"
            onClick={onDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Unplug className="size-3.5" />
            )}
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full gap-1.5 text-xs"
            onClick={onConnect}
          >
            <Plug className="size-3.5" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Telegram Card (special case) ──

function TelegramCard({
  status,
  onSetup,
  onDisconnect,
  loading,
  disconnecting,
}: {
  status: TelegramStatus | null;
  onSetup: () => void;
  onDisconnect: () => void;
  loading: boolean;
  disconnecting: boolean;
}) {
  const isConnected = !!status?.connected;

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card p-5 transition-all",
        isConnected
          ? "border-emerald-500/30 shadow-sm shadow-emerald-500/5"
          : "border-border hover:border-border/80 hover:shadow-sm",
      )}
    >
      {/* Status */}
      <div className="absolute right-4 top-4">
        {isConnected ? (
          <div className="flex items-center gap-1.5">
            <Circle className="size-2 fill-emerald-500 text-emerald-500" />
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Connected</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Circle className="size-2 fill-muted-foreground/30 text-muted-foreground/30" />
            <span className="text-xs text-muted-foreground">Not connected</span>
          </div>
        )}
      </div>

      {/* Icon + Name */}
      <div className="flex items-start gap-3.5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-sky-500/20 to-blue-500/10">
          <Send className="size-5 text-sky-500" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-sm font-semibold text-foreground">Telegram</h3>
          <p className="text-xs text-muted-foreground">Chat with Jarvis on mobile</p>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground line-clamp-2">
        Send messages, get notifications and use all tools directly from Telegram.
      </p>

      {/* Scopes */}
      <div className="mt-3 flex flex-wrap gap-1">
        <Badge variant="secondary" className="text-xs px-1.5 py-0 font-normal">Messages</Badge>
        <Badge variant="secondary" className="text-xs px-1.5 py-0 font-normal">Notifications</Badge>
        <Badge variant="secondary" className="text-xs px-1.5 py-0 font-normal">Tools</Badge>
      </div>

      {/* Connected info */}
      {isConnected && status?.botUsername && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
            <Send className="size-3.5 text-sky-500" />
            <span className="truncate text-xs text-foreground">@{status.botUsername}</span>
          </div>
          {!status.chatLinked && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Send <code className="rounded bg-muted px-1">/start</code> to your bot on Telegram to link the chat.
            </p>
          )}
        </div>
      )}

      {/* Action */}
      <div className="mt-auto pt-4">
        {isConnected ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs"
              asChild
            >
              <a href={`https://t.me/${status?.botUsername}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
                Open in Telegram
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50"
              onClick={onDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? <Loader2 className="size-3.5 animate-spin" /> : <Unplug className="size-3.5" />}
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="w-full gap-1.5 text-xs"
            onClick={onSetup}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Setup Telegram Bot
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Resume Card ──

function ResumeCard({
  hasResume,
  uploading,
  onUpload,
  uploadError,
}: {
  hasResume: boolean;
  uploading: boolean;
  onUpload: (file: File) => void;
  uploadError: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card p-5 transition-all",
        hasResume
          ? "border-emerald-500/30 shadow-sm shadow-emerald-500/5"
          : "border-border hover:border-border/80 hover:shadow-sm",
      )}
    >
      {/* Status */}
      <div className="absolute right-4 top-4">
        {hasResume ? (
          <div className="flex items-center gap-1.5">
            <Circle className="size-2 fill-emerald-500 text-emerald-500" />
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Uploaded</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Circle className="size-2 fill-muted-foreground/30 text-muted-foreground/30" />
            <span className="text-xs text-muted-foreground">Not uploaded</span>
          </div>
        )}
      </div>

      {/* Icon + Name */}
      <div className="flex items-start gap-3.5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-500/20 to-purple-500/10">
          <FileText className="size-5 text-violet-500" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-sm font-semibold text-foreground">Resume</h3>
          <p className="text-xs text-muted-foreground">Upload your resume</p>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground line-clamp-2">
        Upload your resume (PDF, DOCX, or TXT) so our AI can extract your experience, skills, and projects for your portfolio.
      </p>

      {/* Scopes */}
      <div className="mt-3 flex flex-wrap gap-1">
        <Badge variant="secondary" className="text-xs px-1.5 py-0 font-normal">PDF</Badge>
        <Badge variant="secondary" className="text-xs px-1.5 py-0 font-normal">DOCX</Badge>
        <Badge variant="secondary" className="text-xs px-1.5 py-0 font-normal">TXT</Badge>
      </div>

      {/* Error */}
      {uploadError && (
        <p className="mt-2 text-xs text-destructive">{uploadError}</p>
      )}

      {/* Action */}
      <div className="mt-auto pt-4">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.doc,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          className="w-full gap-1.5 text-xs"
          variant={hasResume ? "outline" : "default"}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          {hasResume ? "Re-upload Resume" : "Upload Resume"}
        </Button>
      </div>
    </div>
  );
}

// ── Skeleton Card ──

function SkeletonCard() {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5 animate-pulse">
      <div className="flex items-start gap-3.5">
        <div className="size-11 rounded-xl bg-muted" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-3 w-32 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-3/4 rounded bg-muted" />
      </div>
      <div className="mt-3 flex gap-1">
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-4 w-12 rounded bg-muted" />
        <div className="h-4 w-14 rounded bg-muted" />
      </div>
      <div className="mt-auto pt-4">
        <div className="h-8 w-full rounded-md bg-muted" />
      </div>
    </div>
  );
}

// ── Main Page ──

function ConnectorsContent() {
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<AppDef | null>(null);
  const [telegramDialog, setTelegramDialog] = useState(false);
  const [telegramSetupLoading, setTelegramSetupLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Resume upload state
  const [hasResume, setHasResume] = useState(false);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Fetch connections
  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setConnections(data.connections || []);
    } catch {
      // Silently fail — user will see "not connected" state
    }
  }, []);

  // Fetch telegram status
  const fetchTelegram = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/connect");
      if (res.ok) {
        const data = await res.json();
        setTelegramStatus(data);
      }
    } catch {
      // Telegram not configured — that's fine
    }
  }, []);

  // Fetch resume status
  const fetchResumeStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/status");
      if (res.ok) {
        const data = await res.json();
        setHasResume(!!data.hasResume);
      }
    } catch {}
  }, []);

  useEffect(() => {
    Promise.all([fetchConnections(), fetchTelegram(), fetchResumeStatus()]).finally(() => setLoading(false));
  }, [fetchConnections, fetchTelegram, fetchResumeStatus]);

  // Smart polling when GitHub indexing is active
  useEffect(() => {
    const justConnected = searchParams.get("connected") === "github";
    const hasRunningJob = connections.some(
      (c) =>
        c.provider === "github" &&
        (c.jobStatus === "queued" ||
          c.jobStatus === "scanning" ||
          c.jobStatus === "retrying" ||
          c.jobStatus === "rate_limited" ||
          (justConnected && !c.jobStatus))
    );

    if (hasRunningJob) {
      const interval = setInterval(() => {
        fetchConnections();
      }, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [connections, fetchConnections, searchParams]);

  // Resume upload handler
  const handleResumeUpload = async (file: File) => {
    setResumeUploading(true);
    setResumeError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setHasResume(true);
      setToast({ type: "success", message: `Resume uploaded — ${data.resume?.name || "processed"} (${data.factsAdded} facts extracted)` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Resume upload failed";
      setResumeError(msg);
      setToast({ type: "error", message: msg });
    } finally {
      setResumeUploading(false);
    }
  };

  // Handle OAuth callback success
  useEffect(() => {
    const success = searchParams.get("connected");
    if (success) {
      setToast({ type: "success", message: `${success} connected successfully!` });
      fetchConnections();
      // Clean URL
      window.history.replaceState({}, "", "/connectors");
    }
    const error = searchParams.get("error");
    if (error) {
      setToast({ type: "error", message: error });
      window.history.replaceState({}, "", "/connectors");
    }
  }, [searchParams, fetchConnections]);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const handleConnect = (app: AppDef) => {
    window.location.href = app.oauthHref;
  };

  const handleDisconnect = async (app: AppDef) => {
    setDisconnecting(app.provider);
    setConfirmDisconnect(null);
    try {
      const res = await fetch(`/api/connections?provider=${app.provider}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to disconnect");
      setConnections((prev) => prev.filter((c) => c.provider !== app.provider));
      setToast({ type: "success", message: `${app.name} disconnected` });
    } catch {
      setToast({ type: "error", message: `Failed to disconnect ${app.name}` });
    } finally {
      setDisconnecting(null);
    }
  };

  const handleTelegramSetup = async () => {
    setTelegramDialog(true);
  };

  const handleTelegramConnect = async (botToken: string) => {
    setTelegramSetupLoading(true);
    try {
      const res = await fetch("/api/telegram/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Setup failed");
      }
      const data = await res.json();
      setTelegramDialog(false);
      setToast({ type: "success", message: `Telegram bot @${data.botUsername} connected!` });
      fetchTelegram();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to setup Telegram bot";
      setToast({ type: "error", message: msg });
    } finally {
      setTelegramSetupLoading(false);
    }
  };

  const [telegramDisconnecting, setTelegramDisconnecting] = useState(false);

  const handleTelegramDisconnect = async () => {
    setTelegramDisconnecting(true);
    try {
      const res = await fetch("/api/telegram/connect", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to disconnect");
      setTelegramStatus(null);
      setToast({ type: "success", message: "Telegram disconnected" });
    } catch {
      setToast({ type: "error", message: "Failed to disconnect Telegram" });
    } finally {
      setTelegramDisconnecting(false);
    }
  };

  const getConnection = (provider: string) =>
    connections.find((c) => c.provider === provider) || null;

  const connectedCount = connections.length + (hasResume ? 1 : 0) + (telegramStatus?.connected ? 1 : 0);
  const totalApps = APPS.length + 2; // +1 for Telegram, +1 for Resume

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-lg animate-in slide-in-from-top-2",
          toast.type === "success"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-destructive/30 bg-destructive/10 text-destructive",
        )}>
          {toast.type === "success" ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="text-base font-semibold">Connectors</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {connectedCount} of {totalApps} apps connected &middot; Grant Jarvis access to your tools
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              setLoading(true);
              Promise.all([fetchConnections(), fetchTelegram(), fetchResumeStatus()]).finally(() => setLoading(false));
            }}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Security note */}
      <div className="mx-4 mt-4 flex items-start gap-2.5 rounded-lg border border-border/50 bg-muted/30 px-4 py-3 sm:mx-6">
        <Shield className="size-4 shrink-0 text-muted-foreground mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Connections use OAuth 2.0 — we never store your passwords. Tokens are encrypted at rest and you can revoke access anytime.
        </p>
      </div>

      {/* Card Grid */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {APPS.map((app) => (
              <ConnectorCard
                key={app.provider}
                app={app}
                connection={getConnection(app.provider)}
                onConnect={() => handleConnect(app)}
                onDisconnect={() => setConfirmDisconnect(app)}
                disconnecting={disconnecting === app.provider}
              />
            ))}
            <ResumeCard
              hasResume={hasResume}
              uploading={resumeUploading}
              onUpload={handleResumeUpload}
              uploadError={resumeError}
            />
            <TelegramCard
              status={telegramStatus}
              onSetup={handleTelegramSetup}
              onDisconnect={handleTelegramDisconnect}
              loading={telegramSetupLoading}
              disconnecting={telegramDisconnecting}
            />
          </div>
        )}
      </div>

      {/* Disconnect Confirmation */}
      <AlertDialog open={!!confirmDisconnect} onOpenChange={() => setConfirmDisconnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirmDisconnect?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Jarvis will lose access to your {confirmDisconnect?.name} account. You can reconnect anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDisconnect && handleDisconnect(confirmDisconnect)}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Telegram Setup Dialog */}
      <Dialog open={telegramDialog} onOpenChange={setTelegramDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Setup Telegram Bot</DialogTitle>
            <DialogDescription>
              Create a bot with{" "}
              <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="underline text-foreground">
                @BotFather
              </a>{" "}
              on Telegram, then paste the bot token below.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const input = form.elements.namedItem("botToken") as HTMLInputElement;
              if (input.value.trim()) handleTelegramConnect(input.value.trim());
            }}
            className="space-y-4 py-2"
          >
            <div>
              <label htmlFor="botToken" className="text-xs font-medium text-muted-foreground">
                Bot Token
              </label>
              <input
                id="botToken"
                name="botToken"
                type="text"
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" type="button" onClick={() => setTelegramDialog(false)}>
                Cancel
              </Button>
              <Button size="sm" type="submit" disabled={telegramSetupLoading}>
                {telegramSetupLoading ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Send className="size-3.5 mr-1.5" />}
                Connect
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ConnectorsPage() {
  return (
    <Suspense>
      <ConnectorsContent />
    </Suspense>
  );
}
