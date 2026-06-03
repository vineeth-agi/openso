/**
 * GitHub Webhook Handler
 *
 * Receives webhook events from a GitHub App installation.
 *
 * Security: Validates the X-Hub-Signature-256 header using the webhook
 * secret before processing any event. Rejects requests with invalid or
 * missing signatures.
 */

import { NextRequest, NextResponse } from "next/server";

import crypto from "crypto";

import { createAdminClient } from "@/lib/insforge/admin";

// ── Signature verification ──────────────────────────────────────────────────
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

function verifySignature(payload: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = "sha256=" + crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");
  // `timingSafeEqual` requires equal-length buffers and throws on mismatch.
  // Length-check first so a hostile / malformed signature can't crash the
  // route — the length check itself is fine to leak via timing because the
  // expected length is fixed (`sha256=` + 64 hex chars = 71 bytes).
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

// ── Route handler ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const eventType = req.headers.get("x-github-event");
  const deliveryId = req.headers.get("x-github-delivery");

  // 1. Verify webhook signature — fail-closed (audit CSE-02).
  // If the secret is missing in the deployment env we refuse the
  // request rather than silently accept it. Operators must set
  // `GITHUB_WEBHOOK_SECRET` before this route can do anything.
  if (!WEBHOOK_SECRET) {
    console.error(
      "[webhook] GITHUB_WEBHOOK_SECRET is not set — rejecting request.",
    );
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }
  if (!signature) {
    console.warn("[webhook] Missing signature for delivery:", deliveryId);
    return NextResponse.json(
      { error: "Missing signature" },
      { status: 401 },
    );
  }
  if (!verifySignature(body, signature)) {
    console.warn("[webhook] Invalid signature for delivery:", deliveryId);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = payload.action;
  const repo = payload.repository;

  console.log(`[webhook] Received ${eventType}.${action} for ${repo?.full_name} (delivery: ${deliveryId})`);

  // 2. Route based on event type
  try {
    // ── issues.opened ─────────────────────────────────────────────────
    if (eventType === "issues" && action === "opened") {
      return NextResponse.json({ status: "acknowledged" });
    }

    // ── issue_comment.created ──────────────────────────────────────────
    if (eventType === "issue_comment" && action === "created") {
      return NextResponse.json({ status: "acknowledged" });
    }

    // ── pull_request.opened → AI PR Review (future) ─────────────────────
    if (eventType === "pull_request" && (action === "opened" || action === "synchronize")) {
      // Placeholder for the PR review agent (Workflow A from the blueprint)
      // Will dispatch to a dedicated Upstash Workflow handler for AI review
      console.log(`[webhook] PR ${action}: ${repo.full_name}#${payload.pull_request.number} — PR review agent not yet implemented`);
      return NextResponse.json({
        status: "acknowledged",
        note: "PR review agent coming soon",
      });
    }

    // ── push ──────────────────────────────────────────────────────────
    if (eventType === "push") {
      const installationId = payload.installation?.id;

      // Look up user by installation_id
      const db = createAdminClient();
      const { data: connection } = await db.database.from("connected_apps")
        .select("user_id")
        .eq("provider", "github")
        .eq("installation_id", String(installationId))
        .eq("status", "active")
        .single();

      if (!connection) {
        console.warn(`[webhook] No user found for installation ${installationId}`);
        return NextResponse.json({ status: "ignored", reason: "unknown_installation" });
      }

      return NextResponse.json({ status: "ignored", reason: "indexing_disabled" });
    }

    return NextResponse.json({ status: "ignored", event: `${eventType}.${action}` });
  } catch (error) {
    console.error("[webhook] Error processing event:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
