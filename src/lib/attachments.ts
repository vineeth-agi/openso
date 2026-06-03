export interface ChatAttachment {
  url: string;
  name: string;
  contentType: string;
}

/**
 * Upload a chat attachment via our same-origin server endpoint.
 *
 * The browser cannot read the httpOnly `insforge_access_token`
 * cookie (XSS protection), so calling the InsForge SDK directly
 * from here would be unauthenticated. The server endpoint reads
 * the cookie, attaches the bearer, and forwards the upload to
 * InsForge.
 */
export async function uploadChatAttachment(file: File): Promise<ChatAttachment> {
  const form = new FormData();
  form.append("file", file, file.name);

  const r = await fetch("/api/chat/attachments/upload", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });

  if (!r.ok) {
    let message = `Upload failed (${r.status})`;
    try {
      const body = (await r.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON; fall through with generic message */
    }
    throw new Error(message);
  }

  const body = (await r.json()) as ChatAttachment;
  return body;
}
