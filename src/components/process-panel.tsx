"use client";

import React, { useEffect, useRef, useMemo, useState, useCallback } from "react";

import type { UIMessage } from "ai";
import { 
  Terminal, 
  Play, 
  Loader2, 
  X, 
  Box, 
  FileText, 
  Trash2, 
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Copy,
  Check,
  Clock,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { BundledLanguage } from "shiki";

import { CodeBlock } from "@/components/ai/code-block";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Tool Metadata
// ─────────────────────────────────────────────────────────────────────────────
const SANDBOX_TOOLS = ["create_sandbox", "execute_command", "code_run", "write_file", "read_file", "delete_sandbox"];

const TOOL_META: Record<string, { icon: React.ElementType; label: string; runningLabel: string }> = {
  create_sandbox:  { icon: Box,       label: "Sandbox created",     runningLabel: "Provisioning sandbox…" },
  execute_command: { icon: Terminal,  label: "Command executed",    runningLabel: "Running command…" },
  code_run:        { icon: Play,      label: "Code executed",       runningLabel: "Executing code…" },
  write_file:      { icon: FileText,  label: "File written",        runningLabel: "Writing file…" },
  read_file:       { icon: FileText,  label: "File read",           runningLabel: "Reading file…" },
  delete_sandbox:  { icon: Trash2,    label: "Sandbox removed",     runningLabel: "Cleaning up…" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Normalize — supports both flat and nested SDK shapes
// ─────────────────────────────────────────────────────────────────────────────
interface NormalizedStep {
  toolCallId: string;
  toolName: string;
  state: string;
  output?: unknown;
  input?: Record<string, any>;
}

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "tool-invocation";
}

function normalizePart(part: Record<string, unknown>): NormalizedStep {
  const inv = part.toolInvocation as Record<string, unknown> | undefined;
  return {
    toolCallId: (part.toolCallId as string) || (inv?.toolCallId as string) || "",
    toolName: (part.toolName as string) || (inv?.toolName as string) || String(part.type).replace(/^tool-/, ""),
    state: (part.state as string) || (inv?.state as string) || "",
    output: part.output ?? inv?.result ?? part.result,
    input: (part.input as Record<string, any>) || (inv?.args as Record<string, any>) || (part.args as Record<string, any>),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy button hook
// ─────────────────────────────────────────────────────────────────────────────
function useCopyToClipboard(text: string, timeout = 1500) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
    });
  }, [text, timeout]);
  return { copied, copy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────────────────────
function isRunning(state: string) {
  return state === "input-streaming" || state === "input-available" || state === "call" || state === "partial-call";
}
function isError(state: string, output: any) {
  return state === "output-error" || (state === "result" && output?.error);
}
function isComplete(state: string) {
  return state === "output-available" || state === "result" || state === "output-denied";
}
function getOutputText(output: unknown): string | null {
  if (!output) return null;
  if (typeof output === "string") return output;
  const o = output as Record<string, any>;
  return o.result || o.content || o.message || o.error || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export function ProcessPanel({ messages, isOpen, onClose }: {
  messages: UIMessage[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const steps = useMemo(() => {
    const result: NormalizedStep[] = [];
    for (const m of messages) {
      for (const p of (m.parts ?? [])) {
        if (!isToolPart(p)) continue;
        const norm = normalizePart(p as unknown as Record<string, unknown>);
        if (SANDBOX_TOOLS.includes(norm.toolName)) result.push(norm);
      }
    }
    return result;
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [steps.length, isOpen]);

  const sandboxId = useMemo(() => {
    const c = steps.find((s) => s.toolName === "create_sandbox");
    return (c?.output as any)?.sandboxId ?? null;
  }, [steps]);

  const activeCount = steps.filter(s => isRunning(s.state)).length;
  const doneCount = steps.filter(s => isComplete(s.state)).length;
  const errorCount = steps.filter(s => isError(s.state, s.output)).length;

  if (!isOpen && steps.length === 0) return null;

  return (
    <div
      className={cn(
        "h-full flex flex-col shrink-0 transition-all duration-300 ease-in-out",
        "absolute top-0 right-0 md:relative z-30",
        "bg-background border-l border-border",
        isOpen
          ? "w-full md:w-[420px] lg:w-[460px] translate-x-0 opacity-100"
          : "w-0 translate-x-full opacity-0 overflow-hidden border-l-0"
      )}
    >
      {/* ── Header ── */}
      <div className="flex h-11 shrink-0 items-center justify-between px-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Sandbox</span>
          {sandboxId && (
            <code className="text-xs font-mono text-muted-foreground/50 bg-muted/50 px-1.5 py-0.5 rounded">
              {sandboxId.slice(0, 8)}
            </code>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Status pills */}
          {steps.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60 mr-1">
              {activeCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-pulse" />
                  {activeCount}
                </span>
              )}
              {doneCount > 0 && (
                <span className="flex items-center gap-1 text-success/60">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  {doneCount}
                </span>
              )}
              {errorCount > 0 && (
                <span className="flex items-center gap-1 text-destructive/60">
                  <AlertCircle className="h-2.5 w-2.5" />
                  {errorCount}
                </span>
              )}
            </div>
          )}
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── Timeline ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-2 px-4">
            <Clock className="h-4 w-4" />
            <span className="text-xs">Waiting for activity…</span>
          </div>
        ) : (
          <div className="py-1">
            <AnimatePresence initial={false}>
              {steps.map((step, i) => (
                <StepAccordion
                  key={step.toolCallId || `s-${i}`}
                  step={step}
                  index={i}
                  isLast={i === steps.length - 1}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Accordion (Cursor-style collapsible tool call)
// ─────────────────────────────────────────────────────────────────────────────
function StepAccordion({ step, index, isLast }: { step: NormalizedStep; index: number; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[step.toolName] ?? { icon: Terminal, label: step.toolName, runningLabel: "Running…" };
  const Icon = meta.icon;

  const running = isRunning(step.state);
  const errored = isError(step.state, step.output);
  const done = isComplete(step.state);

  const outputText = getOutputText(step.output);
  const args = step.input || {};
  const hasCode = (step.toolName === "code_run" || step.toolName === "write_file") && args?.code;
  const hasExpandableContent = !!(outputText || hasCode);

  // Auto-expand the currently-running step
  useEffect(() => {
    if (running) setExpanded(true);
  }, [running]);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <div className="relative">
        {/* Vertical timeline connector */}
        {!isLast && (
          <div className="absolute left-[19px] top-8 bottom-0 w-px bg-border" />
        )}

        {/* ── Header row (clickable) ── */}
        <button
          onClick={() => hasExpandableContent && setExpanded(v => !v)}
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
            hasExpandableContent && "hover:bg-muted/30 cursor-pointer",
            !hasExpandableContent && "cursor-default"
          )}
        >
          {/* Status dot */}
          <div className="flex h-[22px] w-[22px] items-center justify-center shrink-0 relative z-10">
            <div className={cn(
              "flex h-[22px] w-[22px] items-center justify-center rounded-full border bg-background",
              running && "border-foreground/30",
              done && !errored && "border-success/40",
              errored && "border-destructive/40",
              !running && !done && !errored && "border-border"
            )}>
              {running ? (
                <Loader2 className="h-3 w-3 text-foreground/60 animate-spin" />
              ) : errored ? (
                <AlertCircle className="h-3 w-3 text-destructive/70" />
              ) : done ? (
                <CheckCircle2 className="h-3 w-3 text-success/70" />
              ) : (
                <Icon className="h-3 w-3 text-muted-foreground/50" />
              )}
            </div>
          </div>

          {/* Label */}
          <div className="flex-1 min-w-0">
            <span className={cn(
              "text-[12px] font-medium",
              running ? "text-foreground" : "text-foreground/70"
            )}>
              {running ? meta.runningLabel : meta.label}
            </span>

            {/* Inline command preview for simple tools */}
            {step.toolName === "execute_command" && args?.command && (
              <span className="ml-2 text-xs font-mono text-muted-foreground/50 truncate">
                {args.command.length > 40 ? args.command.slice(0, 40) + "…" : args.command}
              </span>
            )}
          </div>

          {/* Expand chevron */}
          {hasExpandableContent && (
            <ChevronRight className={cn(
              "h-3 w-3 text-muted-foreground/30 transition-transform shrink-0",
              expanded && "rotate-90"
            )} />
          )}
        </button>

        {/* ── Expandable content ── */}
        <AnimatePresence>
          {expanded && hasExpandableContent && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="pl-10 pr-3 pb-2.5 space-y-2">
                {/* Command block */}
                {step.toolName === "execute_command" && args?.command && (
                  <TerminalBlock content={`$ ${args.command}`} />
                )}

                {/* Code block */}
                {hasCode && (
                  <CodePane
                    code={args.code}
                    filename={step.toolName === "write_file" ? args?.filePath : undefined}
                  />
                )}

                {/* Output */}
                {outputText && (
                  <OutputBlock text={outputText} isError={errored} />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminal Block — shows a command
// ─────────────────────────────────────────────────────────────────────────────
function TerminalBlock({ content }: { content: string }) {
  const { copied, copy } = useCopyToClipboard(content);
  return (
    <div className="group relative rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/60">
        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/40">terminal</span>
        <button onClick={copy} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-muted-foreground">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <div className="text-xs [&_pre]:!bg-transparent [&_pre]:!p-3">
        <CodeBlock code={content} language="bash" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code Pane — shows source code with filename tab
// ─────────────────────────────────────────────────────────────────────────────
function CodePane({ code, filename }: { code: string; filename?: string }) {
  const { copied, copy } = useCopyToClipboard(code);
  const displayName = filename?.split("/").pop() || "script.py";
  const lineCount = code.split("\n").length;

  return (
    <div className="group relative rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/60">
        <div className="flex items-center gap-2">
          <FileText className="h-3 w-3 text-muted-foreground/40" />
          <span className="text-xs font-mono text-muted-foreground/60">{displayName}</span>
          <span className="text-[9px] text-muted-foreground/30">{lineCount} lines</span>
        </div>
        <button onClick={copy} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-muted-foreground">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <div className="max-h-[200px] overflow-y-auto text-xs [&_pre]:!bg-transparent [&_pre]:!p-3">
        <CodeBlock code={code} language="python" showLineNumbers />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Output Block — shows stdout/stderr
// ─────────────────────────────────────────────────────────────────────────────
function OutputBlock({ text, isError: errored }: { text: string; isError: boolean }) {
  const { copied, copy } = useCopyToClipboard(text);
  const trimmed = text.trim();

  return (
    <div className={cn(
      "group relative rounded-md border overflow-hidden",
      errored ? "border-destructive/20 bg-destructive/5" : "border-border bg-card"
    )}>
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/60">
        <span className={cn(
          "text-[9px] font-mono uppercase tracking-wider",
          errored ? "text-destructive/40" : "text-muted-foreground/40"
        )}>
          {errored ? "stderr" : "stdout"}
        </span>
        <button onClick={copy} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-muted-foreground">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <div className="text-xs [&_pre]:!bg-transparent [&_pre]:!p-3">
        <CodeBlock code={trimmed} language={(errored ? "plaintext" : "bash") as BundledLanguage} />
      </div>
    </div>
  );
}
