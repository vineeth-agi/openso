/**
 * POST /api/cron/parse-nl
 *
 * Converts a natural-language scheduling description into a 5-field cron
 * expression using AI — the same approach OpenClaw uses in its
 * casual-cron skill (AI-driven, not regex-driven).
 *
 * Requires user session auth.
 */
import { generateObject } from "ai";
import { z } from "zod";

import { google } from "@/lib/ai/google-provider";
import { getAuthUser } from "@/lib/insforge/server";

export const runtime = "nodejs";
export const maxDuration = 15;

const ResponseSchema = z.object({
  cronExpression: z
    .string()
    .nullable()
    .describe("5-field cron expression in UTC, or null if no schedule found"),
  humanReadable: z
    .string()
    .nullable()
    .describe("Human-readable description of the schedule, e.g. 'Daily at 09:00 UTC'"),
  timezone: z
    .string()
    .nullable()
    .describe("IANA timezone detected in the text, e.g. 'Asia/Kolkata', or null"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score 0-1 of the parsed schedule"),
});

const SYSTEM_PROMPT = `You are a cron expression expert. Convert natural language scheduling descriptions into standard 5-field cron expressions (minute hour dom month dow) in UTC.

Timezone conversion rules:
- IST / India Standard Time = UTC+5:30 → subtract 5h30m (330 min)
- PST / Pacific Standard = UTC-8 → add 8h
- PDT / Pacific Daylight = UTC-7 → add 7h
- EST / Eastern Standard = UTC-5 → add 5h
- EDT / Eastern Daylight = UTC-4 → add 4h
- CST / Central Standard = UTC-6 → add 6h
- GMT / UTC = no change
- BST / British Summer = UTC+1 → subtract 1h
- CET = UTC+1 → subtract 1h
- JST / Japan = UTC+9 → subtract 9h
- AEST / Australian Eastern = UTC+10 → subtract 10h
- SGT / HKT = UTC+8 → subtract 8h

If no timezone is mentioned in the text but a userTimezone is provided in the prompt, treat times as being in that timezone and convert to UTC. If neither is provided, keep the time as-is.

Cron field order: MINUTE HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK
- Day of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
- Use * for "any", */N for "every N"

Examples (assume UTC unless userTimezone context says otherwise):
- "everyday at 6:00am" (with userTimezone=Asia/Kolkata) → 6am IST = 0:30 UTC → "30 0 * * *"
- "everyday at 6:00am" (no userTimezone) → "0 6 * * *"
- "check mails everyday 6:00am" (with userTimezone=America/New_York) → 6am EST = 11:00 UTC → "0 11 * * *"
- "every weekday at 9:55am IST" → 9:55am IST = 4:25am UTC → "25 4 * * 1-5"
- "every Monday at 9am IST" → 9am IST = 3:30am UTC → "30 3 * * 1"
- "daily at 10pm" → "0 22 * * *"
- "every 30 minutes" → "*/30 * * * *"
- "every hour" → "0 * * * *"
- "every Sunday at midnight" → "0 0 * * 0"
- "weekdays at noon" → "0 12 * * 1-5"
- "every Saturday morning" → "0 9 * * 6"
- "twice a day at 9am and 6pm" → use the first time only: "0 9 * * *"

Return cronExpression as null if the text has no clear schedule intent.`;

export async function POST(req: Request) {
  // Auth check
  const auth = await getAuthUser();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let description: string;
  let userTimezone: string | null = null;
  try {
    const body = await req.json();
    description = String(body.description ?? "").trim();
    userTimezone = body.userTimezone ? String(body.userTimezone) : null;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!description || description.length < 5) {
    return Response.json({
      cronExpression: null,
      humanReadable: null,
      timezone: null,
      confidence: 0,
    });
  }

  try {
    // Always use DeepSeek V4 Flash for cron parsing — fast and cost-efficient.
    const model = google();

    const { object } = await generateObject({
      model,
      schema: ResponseSchema,
      system: SYSTEM_PROMPT,
      prompt: `Convert this to a cron expression: "${description}"${
        userTimezone ? `\n\nThe user's local timezone is ${userTimezone}. If no explicit timezone is mentioned in the text, assume times are in ${userTimezone} and convert to UTC.` : ""
      }`,
      maxOutputTokens: 1024,
    });

    return Response.json(object);
  } catch (e) {
    console.error("[cron/parse-nl] Error:", e);
    return Response.json(
      { error: "Failed to parse schedule" },
      { status: 500 },
    );
  }
}
