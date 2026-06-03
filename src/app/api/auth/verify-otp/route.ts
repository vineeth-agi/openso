/**
 * POST /api/auth/verify-otp
 *
 * Recovery flow only:
 *   `{ email, token, type: "recovery" }` — verifies the OTP that was emailed
 *   via /api/auth/send-otp and issues a short-lived reset token to be
 *   exchanged at /api/auth/reset-password.
 *
 * Signup is handled exclusively through Google OAuth on /signin, so there is
 * no email/OTP signup path anymore.
 */
import { NextRequest, NextResponse } from "next/server";

import { verifyOtp, generateResetToken } from "@/lib/otp-store";
import { safeErrorResponse } from "@/lib/security/safe-error";

export async function POST(req: NextRequest) {
  try {
    const { email, token, type } = await req.json();

    if (!email || !token || !type) {
      return NextResponse.json(
        { error: "email, token, and type are required." },
        { status: 400 },
      );
    }
    if (typeof email !== "string" || typeof token !== "string" || typeof type !== "string") {
      return NextResponse.json({ error: "Invalid input." }, { status: 400 });
    }
    if (type !== "recovery") {
      return NextResponse.json({ error: "Invalid OTP type." }, { status: 400 });
    }

    // ── Verify the OTP ──────────────────────────────────────────────────
    const result = verifyOtp(email, token, "recovery");
    if (result !== true) {
      return NextResponse.json({ error: result }, { status: 400 });
    }

    const lowerEmail = email.toLowerCase();
    const resetToken = generateResetToken(lowerEmail);
    return NextResponse.json({ success: true, resetToken });
  } catch (err) {
    return safeErrorResponse(err, { scope: "/api/auth/verify-otp", status: 500 });
  }
}
