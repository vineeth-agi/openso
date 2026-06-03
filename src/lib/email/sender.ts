/**
 * Transactional email sender.
 *
 * Uses Resend API to send HTML emails.
 * Env: RESEND_API_KEY
 */

const API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_ADDRESS = process.env.EMAIL_FROM ?? "noreply@openso.dev";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

/**
 * Send a transactional email.
 */
export async function sendEmail({
  to,
  subject,
  html,
  from = FROM_ADDRESS,
}: SendEmailOptions): Promise<void> {
  if (!API_KEY) {
    console.warn("[resend] No API key configured — skipping email to", to);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[resend] Failed to send email: ${res.status} ${body}`);
  }
}
