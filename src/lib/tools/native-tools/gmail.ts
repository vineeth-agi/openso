import { tool } from "ai";
import { google } from "googleapis";
import { z } from "zod";

/**
 * Builds Exhaustive Native Vercel AI Tools for Gmail.
 * Mirrors the full capabilities of:
 *  - GongRzhe/Gmail-MCP-Server (1.1k⭐)
 *  - MarkusPfundstein/mcp-gsuite (486⭐)
 *  - Official Gmail REST API (Messages, Threads, Drafts, Labels)
 */
export function buildGmailTools(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  // ── Utility: Parse MIME message into readable fields ──
  function parseMessage(m: any) {
    const headers = m.payload?.headers ?? [];
    const get = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

    let body = "";
    const parts = m.payload?.parts ?? [];
    const textPart = parts.find((p: any) => p.mimeType === "text/plain") ?? parts[0];
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
    } else if (m.payload?.body?.data) {
      body = Buffer.from(m.payload.body.data, "base64url").toString("utf-8");
    }

    // Collect attachments
    const attachments: any[] = [];
    function collectAttachments(parts: any[]) {
      for (const part of parts ?? []) {
        if (part.filename && part.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size,
            attachmentId: part.body.attachmentId,
          });
        }
        if (part.parts) collectAttachments(part.parts);
      }
    }
    collectAttachments(m.payload?.parts ?? []);

    return {
      id: m.id,
      threadId: m.threadId,
      from: get("from"),
      to: get("to"),
      cc: get("cc"),
      subject: get("subject"),
      date: get("date"),
      snippet: m.snippet,
      body: body || null,
      attachments,
      labelIds: m.labelIds,
    };
  }

  // ── Utility: Build base64url MIME message ──
  function buildRawMessage({
    to, from, cc, bcc, subject, body, htmlBody, inReplyTo, mimeType = "text/plain",
  }: {
    to: string[]; from?: string; cc?: string[]; bcc?: string[];
    subject: string; body: string; htmlBody?: string;
    inReplyTo?: string; mimeType?: string;
  }) {
    const encSubject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const lines: string[] = [
      `To: ${to.join(", ")}`,
      ...(cc?.length ? [`Cc: ${cc.join(", ")}`] : []),
      ...(bcc?.length ? [`Bcc: ${bcc.join(", ")}`] : []),
      ...(from ? [`From: ${from}`] : []),
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
      `Subject: ${encSubject}`,
      "MIME-Version: 1.0",
    ];

    if (mimeType === "multipart/alternative" && htmlBody) {
      const boundary = `boundary_${Date.now()}`;
      lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, "");
      lines.push(`--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", body, "");
      lines.push(`--${boundary}`, "Content-Type: text/html; charset=utf-8", "", htmlBody, "");
      lines.push(`--${boundary}--`);
    } else if (mimeType === "text/html") {
      lines.push("Content-Type: text/html; charset=utf-8", "", body);
    } else {
      lines.push("Content-Type: text/plain; charset=utf-8", "", body);
    }

    return Buffer.from(lines.join("\r\n")).toString("base64url");
  }

  return {
    // ──────────────────────────────────────────────────────────────
    // 1. MESSAGES
    // ──────────────────────────────────────────────────────────────

    gmail_search_messages: tool({
      description: "Search Gmail messages using Gmail search syntax. Returns IDs + snippets. Use `read_message` to get full content.",
      inputSchema: z.object({
        query: z.string().describe("Gmail search query. Examples: 'is:unread', 'from:boss@co.com', 'subject:invoice', 'has:attachment', 'after:2024/01/01'"),
        limit: z.number().optional().describe("Max results (default 10)"),
        includeSpamTrash: z.boolean().optional().describe("Include spam/trash in search"),
      }),
      execute: async ({ query, limit = 10, includeSpamTrash = false }) => {
        try {
          const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults: limit, includeSpamTrash });
          if (!res.data.messages?.length) return [];
          return res.data.messages.map(m => ({ id: m.id, threadId: m.threadId }));
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_get_message: tool({
      description: "Read the full content of a specific email message by its ID. Returns headers, body, and attachment info.",
      inputSchema: z.object({
        messageId: z.string().describe("The ID of the message (from search results)"),
      }),
      execute: async ({ messageId }) => {
        try {
          const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
          return parseMessage(res.data);
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_get_messages_batch: tool({
      description: "Retrieve multiple email messages at once by their IDs (up to 10).",
      inputSchema: z.object({
        messageIds: z.array(z.string()).max(10).describe("Array of message IDs to fetch"),
      }),
      execute: async ({ messageIds }) => {
        try {
          const results = await Promise.all(
            messageIds.map(id => gmail.users.messages.get({ userId: "me", id, format: "full" }))
          );
          return results.map(r => parseMessage(r.data));
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_send_email: tool({
      description: "Send a new email immediately. Supports plain text, HTML, and multipart (HTML+plain) formats.",
      inputSchema: z.object({
        to: z.array(z.string()).describe("Recipient email addresses"),
        subject: z.string(),
        body: z.string().describe("Email body (plain text)"),
        htmlBody: z.string().optional().describe("Optional HTML body. If provided with mimeType='multipart/alternative', sends both."),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        mimeType: z.enum(["text/plain", "text/html", "multipart/alternative"]).optional().default("text/plain"),
      }),
      execute: async ({ to, subject, body, htmlBody, cc, bcc, mimeType }) => {
        try {
          const raw = buildRawMessage({ to, cc, bcc, subject, body, htmlBody, mimeType });
          const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
          return { success: true, messageId: res.data.id, threadId: res.data.threadId };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_reply_to_email: tool({
      description: "Reply to an existing email thread.",
      inputSchema: z.object({
        threadId: z.string().describe("The thread ID to reply to"),
        messageId: z.string().describe("The message ID you are replying to (for In-Reply-To header)"),
        to: z.array(z.string()).describe("Recipients of the reply"),
        subject: z.string().describe("Reply subject (usually Re: original subject)"),
        body: z.string().describe("Reply body text"),
        cc: z.array(z.string()).optional(),
        sendImmediately: z.boolean().default(true).describe("If false, saves as draft instead of sending"),
      }),
      execute: async ({ threadId, messageId, to, subject, body, cc, sendImmediately }) => {
        try {
          const raw = buildRawMessage({ to, cc, subject, body, inReplyTo: messageId });
          const requestBody = { raw, threadId };
          if (sendImmediately) {
            const res = await gmail.users.messages.send({ userId: "me", requestBody });
            return { success: true, sent: true, messageId: res.data.id };
          } else {
            const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message: requestBody } });
            return { success: true, sent: false, draftId: res.data.id };
          }
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_modify_message: tool({
      description: "Add or remove labels from a message. Use this to mark as read, archive, star, move to trash, etc.",
      inputSchema: z.object({
        messageId: z.string(),
        addLabelIds: z.array(z.string()).optional().describe("Label IDs to add. Use 'UNREAD' to mark unread, 'STARRED' to star."),
        removeLabelIds: z.array(z.string()).optional().describe("Label IDs to remove. Use 'UNREAD' to mark as read, 'INBOX' to archive."),
      }),
      execute: async ({ messageId, addLabelIds, removeLabelIds }) => {
        try {
          await gmail.users.messages.modify({ userId: "me", id: messageId, requestBody: { addLabelIds, removeLabelIds } });
          return { success: true };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_batch_modify_messages: tool({
      description: "Apply label changes to multiple messages at once (e.g., mark 10 emails as read).",
      inputSchema: z.object({
        messageIds: z.array(z.string()).describe("List of message IDs to modify"),
        addLabelIds: z.array(z.string()).optional(),
        removeLabelIds: z.array(z.string()).optional(),
      }),
      execute: async ({ messageIds, addLabelIds, removeLabelIds }) => {
        try {
          await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids: messageIds, addLabelIds, removeLabelIds } });
          return { success: true, modified: messageIds.length };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_trash_message: tool({
      description: "Move a message to the trash.",
      inputSchema: z.object({ messageId: z.string() }),
      execute: async ({ messageId }) => {
        try {
          await gmail.users.messages.trash({ userId: "me", id: messageId });
          return { success: true };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_delete_message: tool({
      description: "Permanently delete a message. WARNING: This cannot be undone.",
      inputSchema: z.object({ messageId: z.string() }),
      execute: async ({ messageId }) => {
        try {
          await gmail.users.messages.delete({ userId: "me", id: messageId });
          return { success: true };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    // ──────────────────────────────────────────────────────────────
    // 2. THREADS
    // ──────────────────────────────────────────────────────────────

    gmail_list_threads: tool({
      description: "List email threads in the mailbox.",
      inputSchema: z.object({
        query: z.string().optional().describe("Gmail search query to filter threads"),
        limit: z.number().optional().describe("Max threads to return (default 10)"),
        labelIds: z.array(z.string()).optional().describe("Filter by label IDs (e.g., ['INBOX', 'UNREAD'])"),
      }),
      execute: async ({ query, limit = 10, labelIds }) => {
        try {
          const res = await gmail.users.threads.list({ userId: "me", q: query, maxResults: limit, labelIds });
          return (res.data.threads ?? []).map(t => ({ id: t.id, snippet: t.snippet }));
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_get_thread: tool({
      description: "Get the full conversation of an email thread (all messages in the chain).",
      inputSchema: z.object({ threadId: z.string() }),
      execute: async ({ threadId }) => {
        try {
          const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
          return {
            id: res.data.id,
            messages: (res.data.messages ?? []).map(parseMessage),
          };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_modify_thread: tool({
      description: "Add or remove labels from an entire thread (all its messages at once).",
      inputSchema: z.object({
        threadId: z.string(),
        addLabelIds: z.array(z.string()).optional(),
        removeLabelIds: z.array(z.string()).optional(),
      }),
      execute: async ({ threadId, addLabelIds, removeLabelIds }) => {
        try {
          await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { addLabelIds, removeLabelIds } });
          return { success: true };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_trash_thread: tool({
      description: "Move an entire email thread to trash.",
      inputSchema: z.object({ threadId: z.string() }),
      execute: async ({ threadId }) => {
        try {
          await gmail.users.threads.trash({ userId: "me", id: threadId });
          return { success: true };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    // ──────────────────────────────────────────────────────────────
    // 3. DRAFTS
    // ──────────────────────────────────────────────────────────────

    gmail_create_draft: tool({
      description: "Create a new draft email without sending it.",
      inputSchema: z.object({
        to: z.array(z.string()),
        subject: z.string(),
        body: z.string(),
        htmlBody: z.string().optional(),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        mimeType: z.enum(["text/plain", "text/html", "multipart/alternative"]).optional().default("text/plain"),
      }),
      execute: async ({ to, subject, body, htmlBody, cc, bcc, mimeType }) => {
        try {
          const raw = buildRawMessage({ to, cc, bcc, subject, body, htmlBody, mimeType });
          const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
          return { success: true, draftId: res.data.id };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_list_drafts: tool({
      description: "List all email drafts in the mailbox.",
      inputSchema: z.object({ limit: z.number().optional() }),
      execute: async ({ limit = 10 }) => {
        try {
          const res = await gmail.users.drafts.list({ userId: "me", maxResults: limit });
          return (res.data.drafts ?? []).map(d => ({ id: d.id, snippet: (d.message as any)?.snippet }));
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_send_draft: tool({
      description: "Send an existing draft email.",
      inputSchema: z.object({ draftId: z.string() }),
      execute: async ({ draftId }) => {
        try {
          const res = await gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
          return { success: true, messageId: res.data.id };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_delete_draft: tool({
      description: "Permanently delete a draft.",
      inputSchema: z.object({ draftId: z.string() }),
      execute: async ({ draftId }) => {
        try {
          await gmail.users.drafts.delete({ userId: "me", id: draftId });
          return { success: true };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    // ──────────────────────────────────────────────────────────────
    // 4. LABELS
    // ──────────────────────────────────────────────────────────────

    gmail_list_labels: tool({
      description: "List all Gmail labels (both system labels like INBOX, UNREAD, and user-created labels).",
      inputSchema: z.object({
        _: z.string().optional().describe("Dummy parameter - not used")
      }),
      execute: async () => {
        try {
          const res = await gmail.users.labels.list({ userId: "me" });
          return (res.data.labels ?? []).map(l => ({ id: l.id, name: l.name, type: l.type }));
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_create_label: tool({
      description: "Create a new custom Gmail label/folder.",
      inputSchema: z.object({
        name: z.string().describe("Name of the new label"),
        labelListVisibility: z.enum(["labelShow", "labelHide", "labelShowIfUnread"]).optional(),
        messageListVisibility: z.enum(["show", "hide"]).optional(),
      }),
      execute: async ({ name, labelListVisibility, messageListVisibility }) => {
        try {
          const res = await gmail.users.labels.create({ userId: "me", requestBody: { name, labelListVisibility, messageListVisibility } });
          return { success: true, id: res.data.id, name: res.data.name };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_delete_label: tool({
      description: "Delete a Gmail label. Messages with this label will not be deleted.",
      inputSchema: z.object({ labelId: z.string() }),
      execute: async ({ labelId }) => {
        try {
          await gmail.users.labels.delete({ userId: "me", id: labelId });
          return { success: true };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    // ──────────────────────────────────────────────────────────────
    // 5. ACCOUNT & PROFILE
    // ──────────────────────────────────────────────────────────────

    gmail_get_profile: tool({
      description: "Get the authenticated user's Gmail profile (email address, total messages, threads counts).",
      inputSchema: z.object({
        _: z.string().optional().describe("Dummy parameter - not used")
      }),
      execute: async () => {
        try {
          const res = await gmail.users.getProfile({ userId: "me" });
          return { emailAddress: res.data.emailAddress, messagesTotal: res.data.messagesTotal, threadsTotal: res.data.threadsTotal };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    // ──────────────────────────────────────────────────────────────
    // 6. ATTACHMENT & FORWARDING
    // ──────────────────────────────────────────────────────────────

    gmail_download_attachment: tool({
      description: "Download the content of an email attachment. Returns the base64-encoded data and metadata.",
      inputSchema: z.object({
        messageId: z.string().describe("The message ID containing the attachment"),
        attachmentId: z.string().describe("The attachment ID from the message parts"),
      }),
      execute: async ({ messageId, attachmentId }) => {
        try {
          const res = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId,
            id: attachmentId,
          });
          return {
            data: res.data.data, // base64url encoded
            size: res.data.size,
          };
        } catch (e: any) { return { error: e.message }; }
      },
    }),

    gmail_forward_message: tool({
      description: "Forward an email to another recipient. Fetches the original message and sends it as a forward.",
      inputSchema: z.object({
        messageId: z.string().describe("The ID of the message to forward"),
        to: z.string().describe("Recipient email address"),
        additionalNote: z.string().optional().describe("Optional note to add above the forwarded content"),
      }),
      execute: async ({ messageId, to, additionalNote }) => {
        try {
          // Fetch original message
          const original = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
          const headers = original.data.payload?.headers || [];
          const getHeader = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

          const origFrom = getHeader("From");
          const origDate = getHeader("Date");
          const origSubject = getHeader("Subject");
          const origTo = getHeader("To");

          // Extract body text
          const parts = original.data.payload?.parts || [];
          let bodyText = "";
          const textPart = parts.find((p: any) => p.mimeType === "text/plain");
          if (textPart?.body?.data) {
            bodyText = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
          } else if (original.data.payload?.body?.data) {
            bodyText = Buffer.from(original.data.payload.body.data, "base64url").toString("utf-8");
          }

          const fwdSubject = origSubject.startsWith("Fwd:") ? origSubject : `Fwd: ${origSubject}`;
          const note = additionalNote ? `${additionalNote}\n\n` : "";
          const fwdBody = `${note}---------- Forwarded message ---------\nFrom: ${origFrom}\nDate: ${origDate}\nSubject: ${origSubject}\nTo: ${origTo}\n\n${bodyText}`;

          const raw = [
            `To: ${to}`,
            `Subject: ${fwdSubject}`,
            `Content-Type: text/plain; charset="UTF-8"`,
            "",
            fwdBody,
          ].join("\r\n");

          const encoded = Buffer.from(raw).toString("base64url");
          const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw: encoded } });
          return { success: true, messageId: res.data.id };
        } catch (e: any) { return { error: e.message }; }
      },
    }),
  };
}
