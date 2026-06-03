import { createAdminClient } from "@/lib/insforge/admin";
import { sendTelegramMessageToUser } from "@/lib/tools/telegram";

export type NotificationChannel = "in_app" | "telegram" | "email";
export type NotificationPriority = "low" | "medium" | "high" | "urgent";

interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  activityType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Send a notification through the specified channel.
 * Logs the activity to agent_activities table.
 */
export async function sendNotification(
  payload: NotificationPayload,
): Promise<{ activityId: string }> {
  const db = createAdminClient();

  // Log the activity
  const { data: activity } = await db.database.from("agent_activities")
    .insert({
      user_id: payload.userId,
      activity_type: payload.activityType,
      title: payload.title,
      description: payload.body,
      status: "pending",
      priority: payload.priority,
      notification_channel: payload.channel,
      metadata: payload.metadata ?? {},
    })
    .select("id")
    .single();

  const activityId = activity?.id ?? "";

  try {
    switch (payload.channel) {
      case "telegram":
        await sendTelegram(payload.userId, payload.title, payload.body);
        break;
      case "in_app":
        // In-app notifications are just the activity log entry
        break;
      case "email":
        // TODO: implement email notifications
        break;
    }

    // Mark as completed
    await db.database.from("agent_activities")
      .update({ status: "completed" })
      .eq("id", activityId);
  } catch (error) {
    // Mark as failed
    await db.database.from("agent_activities")
      .update({
        status: "failed",
        metadata: {
          ...(payload.metadata ?? {}),
          error: error instanceof Error ? error.message : "Unknown error",
        },
      })
      .eq("id", activityId);
  }

  return { activityId };
}

/**
 * Send a message via the user's own Telegram bot.
 * Uses telegram_bot_token + telegram_chat_id from their profile.
 */
async function sendTelegram(
  userId: string,
  title: string,
  body: string,
): Promise<void> {
  const message = `🤖 <b>${title}</b>\n\n${body}`;
  await sendTelegramMessageToUser(userId, message, "HTML");
}

/**
 * Get recent agent activities for a user (for the calendar page).
 */
export async function getAgentActivities(
  userId: string,
  options?: {
    limit?: number;
    startDate?: string;
    endDate?: string;
    activityType?: string;
  },
): Promise<AgentActivity[]> {
  const db = createAdminClient();

  let query = db.database.from("agent_activities")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.startDate) {
    query = query.gte("created_at", options.startDate);
  }
  if (options?.endDate) {
    query = query.lte("created_at", options.endDate);
  }
  if (options?.activityType) {
    query = query.eq("activity_type", options.activityType);
  }

  const { data } = await query;
  return (data ?? []).map(mapActivityRow);
}


export interface AgentActivity {
  id: string;
  userId: string;
  activityType: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  notificationChannel: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapActivityRow(row: any): AgentActivity {
  return {
    id: row.id,
    userId: row.user_id,
    activityType: row.activity_type,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    notificationChannel: row.notification_channel,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}
