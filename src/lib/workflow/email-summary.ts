/**
 * Email summary helper used by the task-runner workflow.
 *
 * Stand-alone helper so the workflow handler doesn't need to reach into
 * other route files. Used by `/api/workflow/task-runner` and the
 * `/api/cron/task-runner` fallback route.
 */

import { generateText } from "ai";

import { google } from "@/lib/ai/google-provider";
import { getGmailClient } from "@/lib/email/gmail";

/**
 * Fetch recent unread emails from Gmail and use AI to produce a summary.
 * Returns a human-readable summary string.
 */
export async function fetchAndSummarizeEmails(userId: string): Promise<string> {
  try {
    const gmail = await getGmailClient(userId);

    const res = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread newer_than:1d",
      maxResults: 15,
    });

    const messageIds = res.data.messages ?? [];
    if (messageIds.length === 0) {
      return "No unread emails in the last 24 hours. Your inbox is clear!";
    }

    const emailResults = await Promise.all(
      messageIds.slice(0, 10).map(async (msg) => {
        try {
          const full = await gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date"],
          });
          const headers = full.data.payload?.headers ?? [];
          return {
            subject:
              headers.find((h) => h.name === "Subject")?.value ?? "(No Subject)",
            from: headers.find((h) => h.name === "From")?.value ?? "Unknown",
            snippet: full.data.snippet ?? "",
            date: headers.find((h) => h.name === "Date")?.value ?? "",
          };
        } catch {
          return null;
        }
      }),
    );
    const emails = emailResults.filter(
      (e): e is NonNullable<typeof e> => e !== null,
    );

    if (emails.length === 0) {
      return "Found unread emails but couldn't fetch their details. Please check manually.";
    }

    const emailList = emails
      .map(
        (e, i) =>
          `${i + 1}. Subject: ${e.subject}\n   From: ${e.from}\n   Preview: ${e.snippet}`,
      )
      .join("\n\n");

    const prompt = `You are an email assistant. Summarize the following ${emails.length} unread emails concisely. Group by priority/topic if relevant. Highlight any action items or urgent messages. Keep it brief but informative.

Emails:
${emailList}

Summary:`;

    try {
      const { text } = await generateText({
        model: google(),
        prompt,
        maxOutputTokens: 512,
      });
      return `📧 Email Summary (${emails.length} unread):\n\n${text}`;
    } catch {
      return `${emails.length} unread email(s) in the last 24 hours:\n\n${emails
        .map((e, i) => `${i + 1}. **${e.subject}** — from ${e.from}`)
        .join("\n")}`;
    }
  } catch (err) {
    console.error("[fetchAndSummarizeEmails] Error:", err);
    return `Failed to fetch email summary: ${err instanceof Error ? err.message : "Unknown error"}. The task will retry at the next scheduled time.`;
  }
}
