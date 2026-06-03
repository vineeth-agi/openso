"use client";

// AI Chat Page — Vercel-style chatbot with full email tool support
// Rebuilt following Vercel AI chatbot template patterns (AI SDK v6)

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";


import NextLink from "next/link";
import { useRouter } from "next/navigation";

import { useChat } from "@ai-sdk/react";
import { Renderer } from "@openuidev/react-lang";
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import type { UIMessage } from "ai";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  Copy,
  Mail,
  Archive,
  Search,
  Star,
  Tag,
  Trash2,
  MailOpen,
  Clock,
  FileEdit,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Square,
  Sparkles,
  Globe,
  GitBranch,
  GitPullRequest,
  Bug,
  FolderGit2,
  Github,
  Play,
  Shield,
  MessageSquare,
  Bell,
  Building2,
  LayoutDashboard,
  BookOpen,
  Users,
  Code2,
  Bookmark,
  Plus,
  Link as LinkIcon,
  Unlink,
  Briefcase,
  MapPin,
  DollarSign,
  ExternalLink,
  Paperclip,
  FileText,
  X,
  Loader2,
  Network,
  Rocket,
  Plug,
  BarChart3,
  Download,
  FileDown,
 Image as ImageIcon,
  FolderGit2 as FolderRepo,
  Lock,
  GitFork,
  Zap,
  ChevronDown } from "lucide-react";


import { Shimmer } from "@/components/ai/shimmer";
import { Markdown } from "@/components/markdown";
import { ProcessPanel } from "@/components/process-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import { useVirtualKeyboard } from "@/hooks/use-virtual-keyboard";
import { uploadChatAttachment, type ChatAttachment } from "@/lib/attachments";
import { cn } from "@/lib/utils";

import "@openuidev/react-ui/components.css";

import { TOOL_META, formatToolName, getToolMeta, CHAT_MODEL_OPTIONS } from "./chat-tool-meta";
// Chat history is now in the main dashboard sidebar
import { EmptyState } from "./chat-empty-state";

type ChatModelId = (typeof CHAT_MODEL_OPTIONS)[number]["value"];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Result Components
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Resume Download Card
// ─────────────────────────────────────────────────────────────────────────────

interface DownloadButtonProps {
  label: string;
  format: "pdf" | "docx";
  type: "resume" | "cover_letter";
  payload: Record<string, unknown>;
  filename: string;
}

// TODO: Implement /api/job-search/resume/download endpoint for PDF/DOCX generation
function DownloadButton({ label, format }: DownloadButtonProps) {
  const Icon = format === "pdf" ? FileDown : FileText;

  return (
    <button
      type="button"
      disabled
      title="Download coming soon"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium",
        "border-border bg-card text-muted-foreground cursor-not-allowed opacity-50",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}



function ToolError({ toolName }: { toolName: string }) {
  const meta = getToolMeta(toolName);

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
      <AlertTriangle className="h-3.5 w-3.5" />
      <span>{meta.label} failed</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Actions (Copy)
// ─────────────────────────────────────────────────────────────────────────────

function MessageActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  if (!content.trim()) return null;

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100">
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(content);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {copied ? "Copied!" : "Copy message"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Thinking Indicator
// ─────────────────────────────────────────────────────────────────────────────

function ThinkingMessage() {
  return (
    <div
      className="flex items-start gap-3"
      data-testid="thinking-message"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-border">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <div className="flex items-center pt-2">
        <Shimmer as="span" className="text-sm text-muted-foreground">
          Thinking...
        </Shimmer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Message
// ─────────────────────────────────────────────────────────────────────────────

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-");
}

interface NormalizedToolPart {
  toolCallId: string;
  approvalId: string;
  toolName: string;
  state: string;
  output?: unknown;
  input?: unknown;
}

function normalizeToolPart(part: Record<string, unknown>): NormalizedToolPart {
  const approval = part.approval as Record<string, unknown> | undefined;
  const invocation = part.toolInvocation as Record<string, unknown> | undefined;

  return {
    toolCallId: (part.toolCallId as string) || (invocation?.toolCallId as string) || "",
    approvalId: (approval?.id as string) || "",
    toolName:
      (part.toolName as string) || (invocation?.toolName as string) || String(part.type).replace(/^tool-/, ""),
    state: (part.state as string) || (invocation?.state as string) || "",
    output: part.output || part.result || invocation?.result,
    input: part.input || invocation?.args,
  };
}

const PurePreviewMessage = memo(function PreviewMessage({
  message,
  isLoading,
  addToolApprovalResponse,
  fileAttachments,
}: {
  message: UIMessage;
  isLoading: boolean;
  addToolApprovalResponse: (args: { id: string; approved: boolean; reason?: string }) => void;
  fileAttachments?: ChatAttachment[];
}) {
  const isUser = message.role === "user";

  const fullText = (message.parts || [])
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("")
    .trim();

  if (isUser) {
    const hasAttachments = fileAttachments && fileAttachments.length > 0;
    return (
      <div className="group/message flex w-full justify-end" data-role="user">
        <div className="max-w-[80%] sm:max-w-[70%] flex flex-col items-end gap-2">
          {hasAttachments && (
            <div className="flex flex-wrap justify-end gap-2">
              {fileAttachments.map((att, i) => {
                const isImage = att.contentType?.startsWith("image/");
                return (
                  <div key={i} className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 border border-primary/20">
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={att.url} alt={att.name} className="h-8 w-8 rounded-md object-cover" />
                    ) : (
                      <FileText className="h-5 w-5 text-primary" />
                    )}
                    <span className="max-w-[150px] truncate text-xs font-medium text-foreground">
                      {att.name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {fullText && (
            <div className="rounded-3xl bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
              {fullText}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Derive a single shimmer status label from all tool parts
  const parts = message.parts ?? [];
  const toolParts = parts
    .filter((p) => isToolPart(p))
    .map((p) => normalizeToolPart(p as unknown as Record<string, unknown>));

  // Find tools that errored
  const erroredTools = toolParts.filter((t) => t.state === "output-error");

  // Find tools awaiting approval
  const approvalTools = toolParts.filter(
    (t) => t.state === "approval-requested"
  );

  // Find the latest actively-running tool for the shimmer label
  const activeTools = toolParts.filter(
    (t) =>
      t.state === "input-streaming" ||
      t.state === "input-available"
  );

  const allToolsDone =
    toolParts.length > 0 &&
    activeTools.length === 0 &&
    approvalTools.length === 0 &&
    toolParts.every(
      (t) => t.state === "output-available" || t.state === "output-error" || t.state === "output-denied" || t.state === "approval-responded"
    );

  // Determine what shimmer text to show
  // Priority: active tool > last completed tool (while still loading) > "Thinking..." (no tools yet)
  let shimmerLabel: string | null = null;
  if (activeTools.length > 0) {
    // Show the last active tool's label
    const last = activeTools[activeTools.length - 1];
    shimmerLabel =
      getToolMeta(last.toolName).activeLabel ??
      `${last.toolName.replace(/([A-Z])/g, " $1").trim()}...`;
  } else if (isLoading && !fullText && allToolsDone) {
    // Tools finished but no answer yet — keep showing last tool's label, not "Thinking..."
    const lastTool = toolParts[toolParts.length - 1];
    const meta = getToolMeta(lastTool.toolName);
    shimmerLabel = meta.activeLabel ?? `${lastTool.toolName.replace(/([A-Z])/g, " $1").trim()}...`;
  } else if (isLoading && !fullText && toolParts.length === 0) {
    shimmerLabel = "Thinking...";
  }

  // Collect text and reasoning content
  const textParts = parts.filter(
    (p) => p.type === "text" && (p as { text: string }).text?.trim()
  );
  const reasoningParts = parts.filter(
    (p) => p.type === "reasoning" && (p as { text: string }).text?.trim()
  );

  return (
    <div
      className="group/message flex w-full items-start gap-3"
      data-role="assistant"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-border">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* Unified shimmer status line — same position/size always */}
        {shimmerLabel && (
          <div className="flex items-center pt-2">
            <Shimmer as="span" className="text-sm text-muted-foreground">
              {shimmerLabel}
            </Shimmer>
          </div>
        )}

        {/* Approval cards (sendEmail, bulkDelete, deleteLabel, etc.) */}
        {approvalTools.map((t, i) => {
          const input = t.input as Record<string, unknown> | undefined;
          const meta = getToolMeta(t.toolName);
          const Icon = meta.icon;
          const isSendEmail = t.toolName === "sendEmail";
          const isBulkDelete = t.toolName === "bulkDelete";
          const isDeleteLabel = t.toolName === "deleteLabel";

          // Build description lines based on tool type
          const descLines: Array<{ label: string; value: string }> = [];
          if (isSendEmail) {
            const recipients = Array.isArray(input?.to)
              ? (input.to as Array<{ name?: string; email: string }>)
                  .map((r) => r.name || r.email)
                  .join(", ")
              : "";
            if (recipients) descLines.push({ label: "To", value: recipients });
            descLines.push({ label: "Subject", value: (input?.subject as string) || "(no subject)" });
          } else if (isBulkDelete) {
            const count = Array.isArray(input?.threadIds) ? (input.threadIds as string[]).length : 0;
            descLines.push({ label: "Threads", value: `${count} thread${count !== 1 ? "s" : ""} will be trashed` });
          } else if (isDeleteLabel) {
            descLines.push({ label: "Label", value: (input?.labelId as string) || "unknown" });
          }

          const confirmLabel = isSendEmail ? "Send" : "Confirm";
          const headerLabel = isSendEmail ? "Ready to send" : `Confirm: ${meta.label}`;

          return (
            <div
              key={`approval-${message.id}-${i}`}
              className="rounded-lg border border-border bg-card p-3 text-sm"
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {headerLabel}
              </div>
              {descLines.map((d, di) => (
                <div key={di} className="mb-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{d.label}:</span> {d.value}
                </div>
              ))}
              <div className={cn("flex items-center gap-2", descLines.length > 0 && "mt-3")}>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() =>
                    addToolApprovalResponse({
                      id: t.approvalId,
                      approved: true,
                    })
                  }
                >
                  <Check className="h-3 w-3" />
                  {confirmLabel}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() =>
                    addToolApprovalResponse({
                      id: t.approvalId,
                      approved: false,
                      reason: "User cancelled",
                    })
                  }
                >
                  <Square className="h-3 w-3" />
                  Cancel
                </Button>
              </div>
            </div>
          );
        })}

        {/* Job search results */}
        {toolParts
          .filter((t) => t.toolName === "searchJobs" && t.state === "output-available" && t.output)
          .map((t, i) => {
            const result = t.output as { jobs?: Array<{ title: string; company: string; location: string; locationType: string; salary: string; jobUrl: string; source: string; matchScore: number; matchReason: string; matchSkills: string[]; description: string }>; total?: number; message?: string };
            const jobs = result?.jobs;
            if (!jobs || jobs.length === 0) return null;
            return (
              <div key={`jobs-${message.id}-${i}`} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Found {result.total ?? jobs.length} jobs — showing top {jobs.length}
                </p>
                <div className="grid gap-2">
                  {jobs.slice(0, 10).map((job, ji) => (
                    <div
                      key={`job-${ji}`}
                      className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="truncate text-sm font-semibold text-foreground">{job.title}</h4>
                            {job.matchScore > 0 && (
                              <span className={cn(
                                "shrink-0 rounded-full px-1.5 py-0.5 text-xs font-bold",
                                job.matchScore >= 80 ? "bg-green-500/10 text-green-600" :
                                job.matchScore >= 60 ? "bg-yellow-500/10 text-yellow-600" :
                                "bg-muted text-muted-foreground"
                              )}>
                                {job.matchScore}%
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {job.company}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {job.location}
                              {job.locationType === "Remote" && (
                                <span className="rounded bg-blue-500/10 px-1 py-px text-xs text-blue-600">Remote</span>
                              )}
                            </span>
                            {job.salary && (
                              <span className="flex items-center gap-1">
                                <DollarSign className="h-3 w-3" />
                                {job.salary}
                              </span>
                            )}
                            <span className="capitalize text-muted-foreground/60">{job.source}</span>
                          </div>
                          {job.matchReason && (
                            <p className="mt-1.5 text-xs text-muted-foreground/80">{job.matchReason}</p>
                          )}
                          {job.matchSkills?.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {job.matchSkills.slice(0, 5).map((s) => (
                                <span key={s} className="rounded bg-primary/5 px-1.5 py-0.5 text-xs text-primary">{s}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {job.jobUrl && (
                          <a
                            href={job.jobUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                          >
                            <ExternalLink className="mr-1 inline h-3 w-3" />
                            Apply
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

        {/* Application package download cards */}
        {toolParts
          .filter((t) => t.toolName === "generateApplicationPackage" && t.state === "output-available" && t.output)
          .map((t, i) => {
            type AppPackageResult = {
              targetRole?: string;
              targetCompany?: string;
              resume?: { downloadPayload?: Record<string, unknown>; keywordMatchRate?: number } | null;
              coverLetter?: { text?: string; wordCount?: number; downloadPayload?: Record<string, unknown> } | null;
            };
            const out = t.output as AppPackageResult;
            if (!out || (!out.resume && !out.coverLetter)) return null;
            const role = out.targetRole ?? "role";
            const company = out.targetCompany ?? "company";
            const safeSlug = `${role}-${company}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
            return (
              <div key={`appkg-${message.id}-${i}`} className="rounded-lg border border-border bg-card p-3">
                <div className="mb-2.5 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
                    <Download className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{role} @ {company}</p>
                    {out.resume?.keywordMatchRate != null && (
                      <p className="text-xs text-muted-foreground">
                        {Math.round(out.resume.keywordMatchRate * 100)}% keyword match
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {out.resume?.downloadPayload && (
                    <>
                      <DownloadButton
                        label="Resume PDF"
                        format="pdf"
                        type="resume"
                        payload={out.resume.downloadPayload}
                        filename={`resume-${safeSlug}.pdf`}
                      />
                      <DownloadButton
                        label="Resume DOCX"
                        format="docx"
                        type="resume"
                        payload={out.resume.downloadPayload}
                        filename={`resume-${safeSlug}.docx`}
                      />
                    </>
                  )}
                  {out.coverLetter?.downloadPayload && (
                    <>
                      <DownloadButton
                        label="Cover Letter PDF"
                        format="pdf"
                        type="cover_letter"
                        payload={out.coverLetter.downloadPayload}
                        filename={`cover-letter-${safeSlug}.pdf`}
                      />
                      <DownloadButton
                        label="Cover Letter DOCX"
                        format="docx"
                        type="cover_letter"
                        payload={out.coverLetter.downloadPayload}
                        filename={`cover-letter-${safeSlug}.docx`}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}

        {/* Draw.io diagram results */}
        {toolParts
          .filter((t) => t.toolName === "create_diagram" && t.state === "output-available")
          .map((t, i) => {
            const out = t.output as { xml?: string; title?: string; drawioUrl?: string; error?: string } | null;
            if (!out || out.error || !out.xml) return null;
            const xml = out.xml;
            const editUrl = out.drawioUrl ?? "https://app.diagrams.net/";
            // Build self-contained HTML using the official draw.io viewer library.
            // We set data-mxgraph via JS (not HTML attribute) to avoid HTML entity decoding corrupting XML.
            const configJson = JSON.stringify(JSON.stringify({
              xml,
              lightbox: false,
              nav: true,
              resize: true,
              fit: true,
              border: 10,
              page: 0,
              layers: true,
              "toolbar-nohide": true,
              "check-visible-state": false,
            }));
            const srcDoc = [
              `<!DOCTYPE html><html><head><meta charset="utf-8">`,
              `<style>*{margin:0;padding:0;box-sizing:border-box}`,
              `html,body{width:100%;height:100%;overflow:auto;background:#fff}`,
              `.mxgraph{min-width:200px;width:100%;min-height:200px}</style></head>`,
              `<body><div class="mxgraph" id="d"></div>`,
              `<script>document.getElementById("d").setAttribute("data-mxgraph",${configJson});<\/script>`,
              `<script src="https://viewer.diagrams.net/js/viewer-static.min.js"><\/script>`,
              `</body></html>`,
            ].join("");
            return (
              <div key={`diagram-${message.id}-${i}`} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Network className="h-3.5 w-3.5 text-primary" />
                    {out.title ?? "Diagram"}
                  </div>
                  <a
                    href={editUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Edit in draw.io
                  </a>
                </div>
                <iframe
                  srcDoc={srcDoc}
                  className="h-96 w-full bg-white"
                  sandbox="allow-scripts allow-same-origin"
                  title={out.title ?? "draw.io diagram"}
                />
              </div>
            );
          })}

        {/* OpenUI Visual Report results */}
        {toolParts
          .filter((t) => t.toolName === "generate_visual_report" && t.state === "output-available" && t.output)
          .map((t, i) => {
            const out = t.output as { openui_lang?: string; error?: string };
            if (!out || out.error || !out.openui_lang) return null;
            return (
              <div
                key={`openui-${message.id}-${i}`}
                className="mt-3 w-full max-w-2xl rounded-xl border border-border/60 bg-sidebar/30 backdrop-blur-md overflow-hidden shadow-2xl"
              >
                <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <BarChart3 className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-widest text-foreground">Interactive Report</span>
                </div>
                <div className="p-1">
                  <Renderer
                    response={out.openui_lang}
                    library={openuiChatLibrary}
                    isStreaming={false}
                  />
                </div>
              </div>
            );
          })}

        {/* Tool errors */}
        {erroredTools.map((t, i) => (
          <ToolError key={`err-${message.id}-${i}`} toolName={t.toolName} />
        ))}

        {/* Reasoning blocks */}
        {reasoningParts.map((part, i) => {
          const rp = part as { type: "reasoning"; text: string };
          return (
            <div key={`reasoning-${message.id}-${i}`} className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-muted-foreground/70">Reasoning</div>
              <div className="whitespace-pre-wrap">{rp.text}</div>
            </div>
          );
        })}

        {/* Text content */}
        {textParts.map((part, i) => {
          const tp = part as { type: "text"; text: string };
          return (
            <div key={`text-${message.id}-${i}`}>
              <Markdown content={tp.text} />
            </div>
          );
        })}

        {fullText && <MessageActions content={fullText} />}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Connection Menu (+ button)
// ─────────────────────────────────────────────────────────────────────────────

function useGitHubConnection() {
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    async function checkConnection() {
      try {
        const res = await fetch("/api/connections");
        if (res.ok) {
          const data = await res.json();
          const gh = data.connections?.find((c: any) => c.provider === "github");
          setGithubUsername(gh?.github_username || gh?.account_name || "Connected");
        }
      } catch (err) {
        console.error("Failed to fetch connections", err);
      }
    }
    checkConnection();
    window.addEventListener("focus", checkConnection);
    return () => window.removeEventListener("focus", checkConnection);
  }, []);

  const connect = useCallback(() => {
    window.location.href = "/api/auth/github";
  }, []);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/auth/github/disconnect", { method: "POST" });
      setGithubUsername(null);
    } catch (err) {
      console.error("Failed to disconnect GitHub:", err);
    } finally {
      setDisconnecting(false);
    }
  }, []);

  return { githubUsername, connect, disconnect, disconnecting };
}

function ConnectionMenu({
  activeSkills,
  onToggleSkill,
  onSelectRepo,
  selectedRepo,
  isIndexing,
  indexingStep,
  onAttachClick,
}: {
  activeSkills: string[];
  onToggleSkill: (skill: string) => void;
  onSelectRepo?: (repoFullName: string) => void;
  selectedRepo?: string | null;
  isIndexing?: boolean;
  indexingStep?: string;
  onAttachClick?: () => void;
}) {
  const { githubUsername, connect } = useGitHubConnection();
  const [repos, setRepos] = useState<Array<{ fullName: string; name: string; description: string | null; language: string | null; stars: number; isPrivate: boolean; isFork: boolean }>>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");

  useEffect(() => {
    if (githubUsername && repos.length === 0) {
      setReposLoading(true);
      fetch("/api/repo-agent/repos")
        .then((r) => r.json())
        .then((data) => {
          setRepos(data.repos ?? []);
          setReposLoading(false);
        })
        .catch(() => setReposLoading(false));
    }
  }, [githubUsername, repos.length]);

  const anyActive = !!githubUsername;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          suppressHydrationWarning
          aria-label="Modes and connections"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            anyActive && "text-primary hover:text-primary/80"
          )}
        >
          <Plus className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56 p-1">
        {/* Attach files */}
        <DropdownMenuItem
          onClick={onAttachClick}
          className="flex items-center gap-2 px-2.5 py-2 cursor-pointer text-sm"
        >
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span>Attach files</span>
        </DropdownMenuItem>

        {/* Your Repos — connected GitHub repos as a submenu */}
        {githubUsername ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="flex items-center justify-between px-2.5 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <FolderRepo className="h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col text-left">
                  <span>Your repos</span>
                  <span className="text-[9px] text-muted-foreground/80 font-medium leading-tight">
                    {selectedRepo ? selectedRepo.split("/")[1] : "Select repo"}
                  </span>
                </div>
              </div>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                className="w-72 p-1 max-h-[60vh] overflow-y-auto"
                sideOffset={4}
              >
                {/* Search input */}
                <div className="px-2 py-1.5">
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search repos…"
                    className="w-full rounded-md border border-border/40 bg-background px-2 py-1 text-xs outline-none focus:border-primary/40"
                  />
                </div>

                {reposLoading && repos.length === 0 ? (
                  <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading repos…
                  </div>
                ) : repos.length === 0 ? (
                  <div className="px-2.5 py-2 text-xs text-muted-foreground">
                    No repos found.
                  </div>
                ) : (
                  repos
                    .filter((r) => {
                      if (!repoSearch.trim()) return true;
                      const q = repoSearch.toLowerCase();
                      return (
                        r.name.toLowerCase().includes(q) ||
                        r.fullName.toLowerCase().includes(q)
                      );
                    })
                    .slice(0, 50)
                    .map((repo) => {
                      const active = selectedRepo === repo.fullName;
                      return (
                        <DropdownMenuItem
                          key={repo.fullName}
                          onSelect={(e) => {
                            e.preventDefault();
                            onSelectRepo?.(repo.fullName);
                          }}
                          className={cn(
                            "flex items-start justify-between gap-2 px-2.5 py-2 text-xs cursor-pointer",
                            active && "bg-primary/10"
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            {repo.isFork ? (
                              <GitFork className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : repo.isPrivate ? (
                              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <FolderRepo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate font-medium">
                                {repo.name}
                              </span>
                              {repo.description && (
                                <span className="truncate text-[10px] text-muted-foreground">
                                  {repo.description}
                                </span>
                              )}
                            </div>
                          </div>
                          {active && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                          )}
                        </DropdownMenuItem>
                      );
                    })
                )}

                {selectedRepo && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        onSelectRepo?.("");
                      }}
                      className="flex items-center gap-2 px-2.5 py-2 text-xs cursor-pointer text-muted-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Clear selection</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem
            disabled={true}
            onSelect={(e) => {
              e.preventDefault();
            }}
            className="flex items-center justify-between px-2.5 py-2 text-sm opacity-50 cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              <Github className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-col text-left">
                <span>Connect GitHub</span>
                <span className="text-[9px] text-muted-foreground/80 font-medium leading-tight">
                  Disabled
                </span>
              </div>
            </div>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Input
// ─────────────────────────────────────────────────────────────────────────────

function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isLoading,
  selectedModel,
  onModelChange,
  activeSkills,
  onToggleSkill,
  attachments,
  onFileUpload,
  onRemoveAttachment,
  isUploading,
  onSelectRepo,
  selectedRepo,
  isIndexingRepo,
  indexingStep,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  isLoading: boolean;
  status?: string;
  selectedModel: ChatModelId;
  onModelChange: (model: ChatModelId) => void;
  activeSkills: string[];
  onToggleSkill: (skill: string) => void;
  attachments?: ChatAttachment[];
  onFileUpload?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  isUploading?: boolean;
  onSelectRepo?: (repoFullName: string) => void;
  selectedRepo?: string | null;
  isIndexingRepo?: boolean;
  indexingStep?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedModelOption =
    CHAT_MODEL_OPTIONS.find((option) => option.value === selectedModel) ??
    CHAT_MODEL_OPTIONS[0];

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if ((value.trim() || (attachments && attachments.length > 0)) && !isLoading) {
        onSend();
      }
    }
  };

  return (
    <div className="relative rounded-xl border border-border/60 bg-card shadow-sm transition-colors focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10">
      {/* Repo badge and Attachment pills */}
      {((attachments && attachments.length > 0) || isUploading || selectedRepo) && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1">
          {/* Repo Badge */}
          {selectedRepo && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/5 px-2.5 py-1.5 text-xs text-blue-600 dark:text-blue-400">
              <FolderRepo className="h-3.5 w-3.5" />
              <span className="font-semibold">{selectedRepo.split("/")[1] || selectedRepo}</span>
              {isIndexingRepo && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground ml-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  <span>indexing...</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => onSelectRepo?.("")}
                className="ml-1 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {isUploading && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1.5 text-xs">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span className="text-muted-foreground">Uploading...</span>
            </div>
          )}
          {attachments?.map((att, i) => {
            const isImage = att.contentType.startsWith("image/");
            return (
              <div
                key={i}
                className="group inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1.5 text-xs transition-colors hover:border-primary/30"
              >
                {isImage ? (
                  <ImageIcon className="h-3 w-3 text-emerald-500" />
                ) : (
                  <FileText className="h-3 w-3 text-blue-500" />
                )}
                <span className="max-w-[120px] truncate font-medium text-foreground">{att.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(i)}
                  className="ml-0.5 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden file input — multi-file support */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.pptx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,.gif"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0 && onFileUpload) {
            onFileUpload(files);
          }
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={selectedRepo ? `Ask about ${selectedRepo.split("/")[1] || selectedRepo}` : "Ask anything — emails, GitHub repos, issues, code docs..."}
        rows={1}
        className={cn(
          "block w-full resize-none bg-transparent px-4 pb-11 pt-3 text-base sm:text-sm sm:pt-3.5 text-foreground",
          "placeholder:text-muted-foreground/40",
          "focus:outline-none",
          "transition-all duration-200"
        )}
        style={{ minHeight: "52px", maxHeight: "200px" }}
      />

      {/* Bottom bar inside the input box */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-1.5 px-2.5 pb-2 sm:px-3 sm:pb-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <ConnectionMenu
            activeSkills={activeSkills}
            onToggleSkill={onToggleSkill}
            onSelectRepo={onSelectRepo}
            selectedRepo={selectedRepo}
            isIndexing={isIndexingRepo}
            indexingStep={indexingStep}
            onAttachClick={() => fileInputRef.current?.click()}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                suppressHydrationWarning
                className="inline-flex max-w-[140px] items-center gap-1 truncate rounded-full border border-border/60 bg-sidebar px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground sm:max-w-none"
              >
                <Sparkles className="h-3 w-3 shrink-0" />
                <span className="truncate">{selectedModelOption.label}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Model
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {CHAT_MODEL_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => onModelChange(option.value)}
                  className="gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{option.label}</p>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </div>
                  {selectedModel === option.value && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Keyboard hint — desktop only to avoid crowding the mobile bar */}
          <p className="hidden text-xs text-muted-foreground/30 select-none md:block">
            Enter to send, Shift+Enter for new line
          </p>
        </div>

        {isLoading ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            aria-label="Stop generating"
            className="h-7 w-7 rounded-lg"
            onClick={onStop}
          >
            <Square className="h-3 w-3" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            aria-label="Send message"
            className={cn(
              "h-7 w-7 rounded-lg transition-all duration-200",
              value.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted/60 text-muted-foreground cursor-not-allowed"
            )}
            disabled={!value.trim()}
            onClick={onSend}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggestion Cards
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

function ScrollToBottomButton({
  isAtBottom,
  scrollToBottom,
}: {
  isAtBottom: boolean;
  scrollToBottom: () => void;
}) {
  if (isAtBottom) return null;

  return (
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pb-1 animate-in fade-in slide-in-from-bottom-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full shadow-lg"
        onClick={scrollToBottom}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat History Sidebar
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// Main Chat Page
// ─────────────────────────────────────────────────────────────────────────────

export function ChatPage({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState("");
  const [selectedModel, setSelectedModel] = useState<ChatModelId>("pioneer-default");
  const selectedModelRef = useRef<ChatModelId>(selectedModel);
  selectedModelRef.current = selectedModel;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const activeSkillsRef = useRef<string[]>(activeSkills);
  activeSkillsRef.current = activeSkills;
  const toggleSkill = useCallback((skill: string) => {
    setActiveSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]
    );
  }, []);

  // ── Repo Agent State ──
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [repoSandboxId, setRepoSandboxId] = useState<string | null>(null);
  const selectedRepoRef = useRef<string | null>(null);
  const repoSandboxIdRef = useRef<string | null>(null);
  selectedRepoRef.current = selectedRepo;
  repoSandboxIdRef.current = repoSandboxId;
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingStep, setIndexingStep] = useState<string>("");

  const handleSelectRepo = useCallback(async (repoFullName: string) => {
    // Helper to delete previous sandbox in the background
    const cleanupSandbox = (id: string) => {
      console.log(`[repo-agent] Proactively cleaning up sandbox: ${id}`);
      fetch("/api/repo-agent/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: id }),
      }).catch((e) => console.error("Failed to delete sandbox:", e));
    };

    // If deselecting (empty string / clicked X button)
    if (!repoFullName) {
      if (repoSandboxId) {
        cleanupSandbox(repoSandboxId);
      }
      setSelectedRepo(null);
      setRepoSandboxId(null);
      setIsIndexing(false);
      setIndexingStep("");
      return;
    }

    // If same repo is clicked again, deselect and clean up
    if (selectedRepo === repoFullName) {
      if (repoSandboxId) {
        cleanupSandbox(repoSandboxId);
      }
      setSelectedRepo(null);
      setRepoSandboxId(null);
      setIsIndexing(false);
      setIndexingStep("");
      return;
    }

    // If switching to a different repository, clean up the previous active sandbox
    if (repoSandboxId) {
      cleanupSandbox(repoSandboxId);
    }

    setSelectedRepo(repoFullName);
    setRepoSandboxId(null);
    setIsIndexing(true);
    setIndexingStep("Creating sandbox...");

    try {
      setIndexingStep("Cloning & indexing...");
      const res = await fetch("/api/repo-agent/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to initialize");

      // Check if user changed or deselected repo during initialization
      if (selectedRepoRef.current !== repoFullName) {
        console.log(`[repo-agent] User changed or deselected repo during initialization. Cleaning up newly created sandbox: ${data.sandboxId}`);
        cleanupSandbox(data.sandboxId);
        return;
      }

      setRepoSandboxId(data.sandboxId);
      setIndexingStep(`Indexed ${data.indexSummary?.embeddedChunks ?? "?"} chunks`);
      // Clear step after a brief display
      setTimeout(() => {
        if (selectedRepoRef.current === repoFullName) {
          setIndexingStep("");
        }
      }, 3000);
    } catch (err) {
      console.error("Repo agent init error:", err);
      if (selectedRepoRef.current === repoFullName) {
        setSelectedRepo(null);
        setIndexingStep(`Error: ${err instanceof Error ? err.message : "Failed"}`);
        setTimeout(() => {
          if (selectedRepoRef.current === repoFullName) {
            setIndexingStep("");
          }
        }, 5000);
      }
    } finally {
      if (selectedRepoRef.current === repoFullName) {
        setIsIndexing(false);
      }
    }
  }, [selectedRepo, repoSandboxId]);

  const [isProcessPanelOpen, setIsProcessPanelOpen] = useState(false);

  // File attachments state (multi-modal uploads)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Track attachments per message ID so they survive the server round-trip
  const [messageAttachments, setMessageAttachments] = useState<Record<string, ChatAttachment[]>>({});
  const pendingAttachmentsRef = useRef<ChatAttachment[] | null>(null);

  const handleFileUpload = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setIsUploading(true);
    try {
      const uploaded: ChatAttachment[] = [];
      for (const file of files) {
        try {
          const att = await uploadChatAttachment(file);
          uploaded.push(att);
        } catch (e) {
          console.error(`[upload] Failed to upload ${file.name}:`, e);
        }
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);



  const { containerRef, endRef, scrollToBottom, isAtBottom } =
    useScrollToBottom<HTMLDivElement>();

  // Ref for the mobile chat input container (virtual keyboard handling)
  const chatInputContainerRef = useRef<HTMLDivElement>(null);
  useVirtualKeyboard(chatInputContainerRef);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          conversationId: conversationIdRef.current,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          model: selectedModelRef.current === "pioneer-default" ? undefined : selectedModelRef.current,
          mode: activeSkillsRef.current.includes("Jobs Mode") ? "jobs" : "normal",

          selectedRepo: selectedRepoRef.current ?? undefined,
          repoSandboxId: repoSandboxIdRef.current ?? undefined,
        }),
      }),
    []
  );

  const {
    messages,
    sendMessage,
    setMessages,
    stop,
    status,
    error,
    regenerate,
    addToolApprovalResponse,
  } = useChat({
    transport,
    experimental_throttle: 50,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => {
      queryClient.invalidateQueries({ queryKey: ["mail", "threads"] });
      queryClient.invalidateQueries({ queryKey: ["mail", "labels"] });
    },
    onError: (err) => {
      console.error("Chat error:", err);
    },
  });

  // Load existing messages for this conversation on mount
  useEffect(() => {
    fetch(`/api/conversations/${encodeURIComponent(conversationId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Array<{ id: string; role: string; parts: UIMessage["parts"] }>) => {
        if (Array.isArray(data) && data.length > 0) {
          setMessages(
            data.map((m) => ({
              id: m.id,
              role: m.role as UIMessage["role"],
              parts: m.parts,
            }))
          );
        }
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLoading = status === "streaming" || status === "submitted";
  // rerender-derived-state-no-effect: derive sandbox tool presence with useMemo instead of useEffect+setState
  const DAYTONA_TOOLS = useMemo(() => ["create_sandbox", "execute_command", "code_run", "write_file", "read_file", "delete_sandbox"], []);
  const hasSandboxTool = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") return false;
    const lastInvocations = (lastMessage.parts || [])
      .map(p => (p as any).toolInvocation || (p.type === 'tool-invocation' ? p : null))
      .filter(Boolean);
    return lastInvocations.some(inv => {
      if (!inv) return false;
      const invAny = inv as any;
      const toolName = invAny.toolName || invAny.type?.replace(/^tool-/, "");
      return DAYTONA_TOOLS.includes(toolName);
    });
  }, [messages, DAYTONA_TOOLS]);

  useEffect(() => {
    if (hasSandboxTool && !isProcessPanelOpen) {
      setIsProcessPanelOpen(true);
    }
  }, [hasSandboxTool, isProcessPanelOpen]);

  const hasMessages = messages.length > 0;

  const handleSend = useCallback(() => {
    if ((!inputValue.trim() && attachments.length === 0) || isLoading) return;
    const text = inputValue.trim() || "Analyze these files";
    setInputValue("");

    const sendPayload: any = { text };
    if (attachments.length > 0) {
      // Stash attachments so useEffect can assign them to the message ID
      pendingAttachmentsRef.current = [...attachments];
      sendPayload.files = attachments.map((a) => ({
        type: "file" as const,
        url: a.url,
        filename: a.name,
        mediaType: a.contentType,
      }));
      setAttachments([]);
    }
    sendMessage(sendPayload);
    // Always scroll to the bottom when the user sends a new message
    setTimeout(() => scrollToBottom(), 100);
  }, [inputValue, isLoading, sendMessage, attachments, scrollToBottom]);

  // Assign pending attachments to the latest user message as soon as it appears
  // rerender-dependencies: use messages.length to avoid firing on every array reference change
  const messagesLength = messages.length;
  useEffect(() => {
    if (!pendingAttachmentsRef.current) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg && !messageAttachments[lastUserMsg.id]) {
      const pending = pendingAttachmentsRef.current;
      pendingAttachmentsRef.current = null;
      setMessageAttachments((prev) => ({ ...prev, [lastUserMsg.id]: pending }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesLength]);

  const handleSuggestionSend = useCallback(
    (prompt: string) => {
      sendMessage({ text: prompt });
      setTimeout(() => scrollToBottom(), 100);
    },
    [sendMessage, scrollToBottom]
  );

  return (
    <TooltipProvider delayDuration={0}>
    <div className="flex h-dvh w-full overflow-hidden bg-sidebar md:h-full">

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">


      {/* Messages Area */}
      <div className="relative flex-1 overflow-hidden">
        {/* Show EmptyState only when no messages */}
        {!hasMessages ? (
          <EmptyState onSend={handleSuggestionSend} />
        ) : (
          <>
            <div ref={containerRef} className="h-full overflow-y-auto">
              <div className="mx-auto max-w-3xl space-y-6 px-3 py-4 pb-28 sm:px-4 sm:py-6 md:px-6 md:pb-6">

                {messages.map((message) => (
                  <PurePreviewMessage
                    key={message.id}
                    message={message}
                    isLoading={isLoading}
                    addToolApprovalResponse={addToolApprovalResponse}
                    fileAttachments={messageAttachments[message.id]}
                  />
                ))}

                {/* Thinking indicator */}
                {status === "submitted" &&
                  messages.length > 0 &&
                  messages[messages.length - 1].role === "user" && (
                    <ThinkingMessage />
                  )}

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-destructive/30">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-destructive">
                        Something went wrong. Please try again.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-fit gap-1.5 text-xs"
                        onClick={() => regenerate()}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Retry
                      </Button>
                    </div>
                  </div>
                )}

                {/* Scroll anchor */}
                <div ref={endRef} className="h-px" />
              </div>
            </div>

            <ScrollToBottomButton
              isAtBottom={isAtBottom}
              scrollToBottom={scrollToBottom}
            />
          </>
        )}
      </div>

      {/* Input Area */}
      <div
        ref={chatInputContainerRef}
        className={cn(
          "bg-sidebar/95 backdrop-blur-sm px-3 pt-2 sm:px-4 sm:pt-3 md:px-6",
          "pb-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]",
          "fixed bottom-0 left-0 right-0 z-30 md:static md:z-auto"
        )}
      >
        <div className="mx-auto max-w-3xl">
          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            onStop={() => stop()}
            isLoading={isLoading}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            activeSkills={activeSkills}
            onToggleSkill={toggleSkill}
            attachments={attachments}
            onFileUpload={handleFileUpload}
            onRemoveAttachment={handleRemoveAttachment}
            isUploading={isUploading}
            onSelectRepo={handleSelectRepo}
            selectedRepo={selectedRepo}
            isIndexingRepo={isIndexing}
            indexingStep={indexingStep}
          />
        </div>
      </div>
    </div>
    <ProcessPanel 
      messages={messages} 
      isOpen={isProcessPanelOpen} 
      onClose={() => setIsProcessPanelOpen(false)} 
    />
  </div>
  </TooltipProvider>
  );
}

