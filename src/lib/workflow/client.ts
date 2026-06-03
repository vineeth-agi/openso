/**
 * Upstash Workflow / QStash client setup
 *
 * All workflow runs are POSTed over HTTPS to the workflow endpoint, so we
 * need a publicly reachable base URL. In production we use NEXT_PUBLIC_APP_URL
 * (or VERCEL_URL); in dev we expect a tunnel URL via UPSTASH_WORKFLOW_URL
 * or NEXT_PUBLIC_APP_URL (ngrok).
 *
 * Hard-fails in production when no public origin is configured (audit
 * Finding 7.6). Without this, schedules silently target `http://localhost:3000`
 * which QStash cannot reach.
 */

import { Client as QstashClient } from "@upstash/qstash";
import { Client } from "@upstash/workflow";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

if (!QSTASH_TOKEN && process.env.NODE_ENV !== "test") {
  // Fail loud during build / boot but not during unit tests
  console.warn("[workflow] QSTASH_TOKEN is not set — workflow triggers will fail.");
}

/**
 * Public base URL the QStash service can reach to call our workflow handlers.
 *
 * Resolution order:
 *   1. UPSTASH_WORKFLOW_URL — explicit override (e.g. ngrok in dev).
 *   2. NEXT_PUBLIC_APP_URL — canonical production origin.
 *   3. VERCEL_URL — Vercel auto-injects this on deployments.
 *   4. localhost:3000 — dev only. In production we throw.
 */
export function workflowBaseUrl(): string {
  const explicit = process.env.UPSTASH_WORKFLOW_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");

  // Vercel auto-injects this on deployments
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[workflow] No public origin configured. Set NEXT_PUBLIC_APP_URL " +
        "(or UPSTASH_WORKFLOW_URL / VERCEL_URL) before deploying — " +
        "QStash cannot call back to localhost.",
    );
  }

  return "http://localhost:3000";
}

/**
 * Build the absolute URL for a workflow route, e.g.
 *   workflowUrl("scanner") -> "https://app.example.com/api/workflow/scanner"
 */
export function workflowUrl(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, "");
  return `${workflowBaseUrl()}/api/workflow/${clean}`;
}

/** Workflow client used to start runs from API routes / server actions. */
export const workflowClient = new Client({
  token: QSTASH_TOKEN ?? "missing-qstash-token",
  baseUrl: process.env.QSTASH_URL,
});

/** Raw QStash client used to manage Schedules (cron) and direct publishes. */
export const qstashClient = new QstashClient({
  token: QSTASH_TOKEN ?? "missing-qstash-token",
  baseUrl: process.env.QSTASH_URL,
});
