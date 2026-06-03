/**
 * User Reminder Workflow — fires a one-time reminder at a scheduled time.
 *
 * Triggered from chat via:
 *   workflowClient.trigger({
 *     url: workflowUrl("user-reminder"),
 *     body: { userId, title, body, scheduledFor }
 *   })
 *
 * Uses context.sleepUntil() so the runtime stays idle until the scheduled
 * time, then fires the in-app notification.
 */

import { serve } from "@upstash/workflow/nextjs";

import { createAdminClient } from "@/lib/insforge/admin";
import { sendNotification } from "@/lib/memory/notifications";

type UserReminderPayload = {
  userId: string;
  title: string;
  body: string;
  /** ISO date string. */
  scheduledFor?: string;
};

export const { POST } = serve<UserReminderPayload>(async (context) => {
  const { userId, title, body, scheduledFor } = context.requestPayload;

  // Persist scheduled intent immediately so agent-activity page shows it
  await context.run("save-scheduled-intent", async () => {
    const db = createAdminClient();
    const { error } = await db.database.from("agent_activities").insert({
      user_id: userId,
      activity_type: "reminder_scheduled",
      title: `Reminder scheduled: ${title}`,
      description: `Will fire at ${scheduledFor ? new Date(scheduledFor).toLocaleString() : "immediately"}. Message: ${body}`,
      status: "pending",
      priority: "medium",
      notification_channel: "in_app",
      metadata: { scheduledFor, reminderTitle: title, reminderBody: body },
    });
    if (error) {
      console.error(
        "[user-reminder] Failed to save intent:",
        error.message,
        error.details,
      );
    }
    return null;
  });

  if (scheduledFor) {
    await context.sleepUntil(
      "wait-for-scheduled-time",
      new Date(scheduledFor),
    );
  }

  await context.run("send-reminder", async () => {
    await sendNotification({
      userId,
      title,
      body,
      channel: "in_app",
      priority: "high",
      activityType: "reminder_fired",
      metadata: { scheduledFor },
    });
    return null;
  });

  return { sent: true, title, userId, firedAt: new Date().toISOString() };
});
