/**
 * Internal API: Schedule Reminder.
 *
 * Called from the chat agent when a user asks to be reminded about something.
 *
 * Behaviour:
 *  - With `scheduledFor`: triggers the Upstash Workflow `user-reminder` route
 *    which uses durable `context.sleepUntil()` and fires the notification
 *    at the exact scheduled time.
 *  - Without `scheduledFor`: fires the notification immediately.
 *
 * Authenticated via CRON_SECRET (for cron callers) or user session.
 */
import { NextRequest, NextResponse } from "next/server";

import { getAuthUser } from "@/lib/insforge/server";
import { sendNotification } from "@/lib/memory/notifications";
import { timingSafeEqualStr } from "@/lib/security/timing-safe";
import { workflowClient, workflowUrl } from "@/lib/workflow/client";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Allow cron auth or user session
  let userId: string;
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  const body = await req.json();

  if (cronSecret && auth && timingSafeEqualStr(auth, `Bearer ${cronSecret}`)) {
    userId = body.userId;
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
  } else {
    const session = await getAuthUser();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = session.user.id;
  }

  const {
    title,
    body: reminderBody,
    scheduledFor,
  } = body as {
    title: string;
    body: string;
    scheduledFor?: string;
  };

  if (!title || !reminderBody) {
    return NextResponse.json(
      { error: "title and body required" },
      { status: 400 },
    );
  }

  if (scheduledFor) {
    // Hand off to the durable workflow so the SDK sleeps until the exact
    // scheduled time and then fires the notification.
    try {
      const { workflowRunId } = await workflowClient.trigger({
        url: workflowUrl("user-reminder"),
        body: { userId, title, body: reminderBody, scheduledFor },
        retries: 3,
      });
      return NextResponse.json({
        scheduled: true,
        title,
        userId,
        scheduledFor,
        workflowRunId,
      });
    } catch (err) {
      console.error("[cron/user-reminder] Workflow trigger failed:", err);
      return NextResponse.json(
        { error: "Failed to schedule reminder" },
        { status: 500 },
      );
    }
  }

  // No scheduledFor — fire immediately
  await sendNotification({
    userId,
    title,
    body: reminderBody,
    channel: "in_app",
    priority: "high",
    activityType: "reminder_fired",
    metadata: { scheduledFor: null },
  });

  return NextResponse.json({
    scheduled: true,
    title,
    userId,
    scheduledFor: "now",
  });
}
