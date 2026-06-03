import { tool } from "ai";
import { z } from "zod";

import { auditLog } from "./dream-cycle";
import type { ExtractedFact } from "./extractor";
import { getProfile } from "./profile";
import { addFact , searchFacts, deleteFact } from "./store";

import { computeNextRunAt, cronToHuman } from "@/lib/cron";
import { createAdminClient } from "@/lib/insforge/admin";
import { createJobSchedule } from "@/lib/workflow/task-runner-schedule";

// ── Safety Guardrails ──
// Block facts that could be dangerous if stored as "memory" (medical/legal/identity claims)
const UNSAFE_FACT_PATTERNS = [
  /\b(take|prescrib|dos(?:age|e)|inject|overdos|suicid|self.?harm)\b/i,
  /\b(kill|murder|bomb|weapon|explos|terror)\b/i,
  /\b(social security|ssn|credit card|bank account|routing number|passport)\b/i,
  /\b(password|api.?key|secret.?key|private.?key|token)\b/i,
];

// Block prompt injection attempts in fact content
const INJECTION_PATTERNS = [
  /ignore (previous|all|prior|above) instructions/i,
  /you are now/i,
  /new instructions:/i,
  /system prompt:/i,
  /\bDAN\b/,
  /<\/?(?:system|assistant|user)>/i,
];

function isUnsafeFact(fact: string): { blocked: boolean; reason?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(fact)) {
      return { blocked: true, reason: "Content appears to contain prompt injection." };
    }
  }
  for (const pattern of UNSAFE_FACT_PATTERNS) {
    if (pattern.test(fact)) {
      return { blocked: true, reason: "Content contains sensitive information (medical/legal/credential). Not stored for safety." };
    }
  }
  if (fact.length > 500) {
    return { blocked: true, reason: "Fact too long. Keep it to 1-2 sentences." };
  }
  return { blocked: false };
}

/**
 * Build memory tools that the AI can call during chat to manage user memory.
 */
export function buildMemoryTools(userId: string, userTimezone?: string) {
  return {
    rememberFact: tool({
      description:
        "Save an important fact about the user to long-term memory. Use this when the user shares something worth remembering — preferences, plans, goals, or personal details.",
      inputSchema: z.object({
        fact: z.string().describe("The fact to remember about the user"),
        category: z
          .enum([
            "personal",
            "professional",
            "technical",
            "preference",
            "behavioral",
            "goal",
            "outcome",
          ])
          .describe("Category of the fact"),
        importance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("How important is this fact (0-1, default 0.7)"),
      }),
      execute: async ({ fact, category, importance }) => {
        // Safety guardrail: block dangerous/injection content
        const safety = isUnsafeFact(fact);
        if (safety.blocked) {
          await auditLog(userId, "remember_blocked", "memory_facts", undefined, { fact, reason: safety.reason });
          return { status: "blocked", message: safety.reason ?? "Fact blocked by safety filter." };
        }

        try {
          const extracted: ExtractedFact = {
            fact,
            category,
            memoryType: "fact",
            confidence: 0.95,
            importance: importance ?? 0.7,
          };
          const result = await addFact(userId, extracted, "chat");

          await auditLog(userId, "remember_fact", "memory_facts", result.factId, { fact, category, action: result.action });

          return {
            status: result.action,
            message:
              result.action === "inserted"
                ? `Remembered: "${fact}"`
                : result.action === "updated"
                  ? `Updated existing memory with: "${fact}"`
                  : `Already known: "${fact}"`,
          };
        } catch (e) {
          console.error("[memory] rememberFact failed:", e);
          return { status: "error", message: `Failed to save: ${e instanceof Error ? e.message : "Unknown error"}` };
        }
      },
    }),

    recallMemory: tool({
      description:
        "Search user's memory for relevant facts. Use this when you need to recall something about the user that isn't in the current conversation context.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("What to search for in the user's memory"),
        limit: z
          .number()
          .optional()
          .describe("Max results to return (default 5)"),
      }),
      execute: async ({ query, limit }) => {
        const facts = await searchFacts(userId, query, limit ?? 5);
        if (facts.length === 0) {
          return { found: false, message: "No relevant memories found." };
        }
        return {
          found: true,
          facts: facts.map((f) => ({
            fact: f.fact,
            category: f.category,
            source: f.source,
            confidence: f.confidence,
            createdAt: f.createdAt,
          })),
        };
      },
    }),

    getUserProfile: tool({
      description:
        "Get the user's full memory profile — who they are, what they're working on, their skills and preferences.",
      inputSchema: z.object({
        _: z.string().optional().describe("Dummy parameter - not used")
      }),
      execute: async () => {
        const profile = await getProfile(userId);
        if (!profile) {
          return { hasProfile: false, message: "No profile built yet." };
        }
        return {
          hasProfile: true,
          summary: profile.summary,
          staticFacts: profile.staticFacts,
          dynamicFacts: profile.dynamicFacts,
          version: profile.version,
        };
      },
    }),

    forgetFact: tool({
      description:
        "Delete a specific fact from user's memory. Use when the user asks you to forget something or when information is incorrect.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Search term to find the fact to delete"),
      }),
      execute: async ({ query }) => {
        // Find the fact first
        const facts = await searchFacts(userId, query, 1);
        if (facts.length === 0) {
          return { deleted: false, message: "No matching memory found." };
        }
        const fact = facts[0];
        await deleteFact(fact.id, userId);

        await auditLog(userId, "forget_fact", "memory_facts", fact.id, { fact: fact.fact, category: fact.category });

        return {
          deleted: true,
          message: `Forgot: "${fact.fact}"`,
        };
      },
    }),

    setReminder: tool({
      description:
        "Set a one-time reminder for the user at a specific date/time. Use when the user says things like 'remind me tomorrow at 9am to check emails' or 'alert me on Friday about my meeting'.",
      inputSchema: z.object({
        title: z.string().describe("Short title for the reminder (e.g. 'Check emails')"),
        body: z.string().describe("Full reminder message to deliver to the user"),
        scheduledFor: z
          .string()
          .describe("ISO 8601 timestamp when to fire the reminder (e.g. '2026-04-11T09:00:00')"),
      }),
      execute: async ({ title, body, scheduledFor }) => {
        try {
          const db = createAdminClient();

          // Store as a one-time task that task-runner will pick up at the scheduled time
          await db.database.from("agent_cron_jobs").insert({
            user_id: userId,
            name: `Reminder: ${title}`,
            description: body,
            cron_expression: "0 0 31 2 *", // Feb 31 = never recurs
            function_id: "reminder",
            config: { title, body, oneTime: true },
            enabled: true,
            next_run_at: new Date(scheduledFor).toISOString(),
          });

          // Log intent to agent_activities
          await db.database.from("agent_activities").insert({
            user_id: userId,
            activity_type: "reminder_scheduled",
            title: `Reminder scheduled: ${title}`,
            description: `Will fire at ${new Date(scheduledFor).toLocaleString()}. Message: ${body}`,
            status: "pending",
            priority: "medium",
            notification_channel: "in_app",
            metadata: { scheduledFor, reminderTitle: title, reminderBody: body },
          });

          return {
            scheduled: true,
            message: `Reminder set: "${title}" at ${new Date(scheduledFor).toLocaleString()}`,
          };
        } catch (e) {
          return {
            scheduled: false,
            message: `Failed to schedule reminder: ${e instanceof Error ? e.message : "Unknown error"}`,
          };
        }
      },
    }),

    scheduleRecurringTask: tool({
      description:
        "Schedule a recurring task or cron job. Use when the user says things like 'every morning remind me to exercise' or 'check my GitHub every Monday'. The cronExpression MUST be in UTC — convert from the user's local timezone before creating it.",
      inputSchema: z.object({
        taskName: z.string().describe("Short name for the task (e.g. 'Morning exercise reminder')"),
        description: z.string().describe("What this task should do / message to send"),
        cronExpression: z
          .string()
          .describe(
            "Standard 5-field cron expression IN UTC (e.g. '17 22 * * *' for 3:47 AM IST daily, which is 22:17 UTC). Always convert user's local time to UTC. IST=UTC-5:30, PST=UTC+8, etc.",
          ),
        nextRunAt: z
          .string()
          .optional()
          .describe("ISO timestamp of the next expected run in UTC (for display purposes)"),
      }),
      execute: async ({ taskName, description, cronExpression }) => {
        const db = createAdminClient();
        // Always compute from cron — never trust the AI's nextRunAt guess
        const nextRun = computeNextRunAt(cronExpression);

        // ── 1. Write directly to agent_cron_jobs ──
        const { data: cronJob, error: cronError } = await db.database.from("agent_cron_jobs")
          .insert({
            user_id: userId,
            name: taskName,
            description: `${description} | Schedule: ${cronExpression}`,
            cron_expression: cronExpression,
            function_id: "task-runner",
            config: { description },
            enabled: true,
            next_run_at: nextRun.toISOString(),
          })
          .select("id")
          .single();

        if (cronError) {
          console.error("[scheduleRecurringTask] Failed to insert cron job:", cronError.message);
        }

        // ── 2. Register with QStash so the job actually fires on schedule ──
        if (cronJob?.id && !cronError) {
          try {
            await createJobSchedule(cronJob.id, cronExpression);
          } catch (qstashErr) {
            console.error("[scheduleRecurringTask] QStash schedule creation failed:", qstashErr);
            // Roll back the DB row so we don't have a zombie job
            await db.database.from("agent_cron_jobs").delete().eq("id", cronJob.id);
            return {
              scheduled: false,
              message: `Failed to create schedule: ${qstashErr instanceof Error ? qstashErr.message : "Unknown error"}. Please try again.`,
            };
          }
        }

        // ── 3. Log a pending activity entry so it shows on the agent activity page ──
        const { error: actError } = await db.database.from("agent_activities").insert({
          user_id: userId,
          activity_type: "recurring_task_created",
          title: `Scheduled: ${taskName}`,
          description: `${description} | Runs: ${cronExpression} | Next run: ${nextRun.toLocaleString("en-US", { timeZone: "UTC" })} UTC`,
          status: "pending",
          priority: "medium",
          notification_channel: "in_app",
          metadata: {
            taskName,
            cronExpression,
            nextRunAt: nextRun.toISOString(),
            ...(cronJob?.id ? { cronJobId: cronJob.id } : {}),
          },
        });

        if (actError) {
          console.error("[scheduleRecurringTask] Failed to log activity:", actError.message);
        }

        const humanSchedule = cronToHuman(cronExpression);
        const successMsg = cronError
          ? `Task "${taskName}" partially saved (DB error: ${cronError.message}). Check agent activity page.`
          : `Recurring task "${taskName}" scheduled! Runs: ${humanSchedule} UTC (cron: ${cronExpression}). Next run: ${nextRun.toLocaleString("en-US", { timeZone: "UTC" })} UTC. You can see it on the Agent Activity page and use "Run Now" to test it immediately.`;

        return { scheduled: !cronError, message: successMsg };
      },
    }),

    listScheduledTasks: tool({
      description:
        "Show the user what cron jobs and scheduled tasks are currently active. Returns both user-defined tasks and system cron jobs.",
      inputSchema: z.object({
        _: z.string().optional().describe("Dummy parameter - not used")
      }),
      execute: async () => {
        try {
          const db = createAdminClient();
          const { data: userTasks, error } = await db.database.from("agent_cron_jobs")
            .select("id, name, description, cron_expression, enabled, next_run_at, last_run_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

          if (error) console.error("[listScheduledTasks] DB error:", error.message);

          return {
            userDefinedTasks: (userTasks ?? []).map((t) => ({
              name: t.name,
              schedule: t.cron_expression,
              humanSchedule: cronToHuman(t.cron_expression),
              description: t.description,
              enabled: t.enabled,
              nextRun: t.next_run_at,
              lastRun: t.last_run_at,
            })),
            systemCronJobs: [
              { id: "daily-digest", schedule: "0 8 * * *", description: "Daily digest: priorities and memory context (8 AM UTC daily)" },
              { id: "github-insight", schedule: "0 9 * * 1", description: "GitHub insight: refreshes your GitHub stats into memory (9 AM UTC Mondays)" },
            ],
          };
        } catch (e) {
          return { error: `Failed to fetch tasks: ${e instanceof Error ? e.message : "Unknown error"}` };
        }
      },
    }),
  };
}
