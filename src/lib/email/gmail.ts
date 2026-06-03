/**
 * Gmail client — creates authenticated Gmail API clients for users.
 *
 * Uses the user's stored Google OAuth tokens from the connections table.
 */

import { google as googleapis } from "googleapis";
import type { gmail_v1 } from "googleapis";

import { getConnectionAdmin, refreshConnectionTokens } from "@/lib/connections";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

/**
 * Get an authenticated Gmail client for a user.
 * Automatically refreshes the token if expired.
 */
export async function getGmailClient(userId: string): Promise<gmail_v1.Gmail> {
  const connection = await getConnectionAdmin(userId, "gmail");
  if (!connection) {
    throw new Error("No Gmail connection found. Please connect your Gmail account first.");
  }

  const oauth2Client = new googleapis.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    access_token: connection.access_token,
    refresh_token: connection.refresh_token,
  });

  // Auto-refresh if token is expired
  if (connection.expiry_date) {
    if (Date.now() > connection.expiry_date - 60_000) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);

        // Persist refreshed token via the encrypted-write helper
        // (DB-HIGH-01). `refreshConnectionTokens` runs `encryptToken`
        // before the DB write so the column is never plaintext at rest.
        await refreshConnectionTokens(userId, "gmail", {
          access_token: credentials.access_token ?? null,
          expiry_date: credentials.expiry_date ?? connection.expiry_date,
        });
      } catch (err) {
        console.error("[gmail] Token refresh failed:", err);
        // Continue with existing token — it may still work
      }
    }
  }

  return googleapis.gmail({ version: "v1", auth: oauth2Client });
}
