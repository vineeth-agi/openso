import { NextRequest, NextResponse } from "next/server";

import { sendEmail } from "@/lib/email/sender";
import { otpEmailHtml } from "@/lib/email/templates";
import { generateOtp } from "@/lib/otp-store";

// Simple rate-limit: max 3 sends per email per 15 min
const sendRateLimit = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(email: string): boolean {
  const now = Date.now();
  const entry = sendRateLimit.get(email);
  if (!entry || now > entry.resetAt) {
    sendRateLimit.set(email, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 3) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const { email, type, name } = await req.json();

    if (!email || !type) {
      return NextResponse.json({ error: "email and type are required." }, { status: 400 });
    }
    if (type !== "recovery") {
      return NextResponse.json({ error: "Invalid type." }, { status: 400 });
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
    }

    // Rate limit
    if (!checkRateLimit(email)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait 15 minutes before requesting a new code." },
        { status: 429 },
      );
    }

    const code = generateOtp(email, "recovery");
    const subject = "Reset your password";

    await sendEmail({
      to: email,
      subject,
      html: otpEmailHtml({ code, name }),
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error("[send-otp]", err);
    const message = err instanceof Error ? err.message : "Failed to send code.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
