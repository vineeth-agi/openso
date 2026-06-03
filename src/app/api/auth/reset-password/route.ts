import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { verifyResetToken } from "@/lib/otp-store";

export async function POST(req: NextRequest) {
  try {
    const { email, password, resetToken } = await req.json();

    if (!email || !password || !resetToken) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }

    // Validate password requirements
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }
    if (
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      return NextResponse.json(
        { error: "Password must contain uppercase, lowercase, and a number." },
        { status: 400 },
      );
    }

    // Verify reset token (single-use, auto-deleted after verification)
    const tokenValid = verifyResetToken(resetToken, email);
    if (!tokenValid) {
      return NextResponse.json(
        { error: "Invalid or expired reset token. Please start over." },
        { status: 400 },
      );
    }

    // Find user by email
    const db = createAdminClient();
    const { data: profile } = await db
      .database.from("profiles")
      .select("id")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (!profile) {
      return NextResponse.json(
        { error: "User not found." },
        { status: 404 },
      );
    }

    // Note: InsForge has no admin password-update API. Password resets
    // must go through the user-flow: sendResetPasswordEmail → user
    // receives email → exchangeResetPasswordToken → resetPassword.
    // Returning 501 here so calling code surfaces a clear error
    // instead of a confusing runtime crash.
    return NextResponse.json(
      {
        error:
          "Admin password reset is unavailable on InsForge. Use sendResetPasswordEmail flow instead.",
      },
      { status: 501 },
    );
  } catch (err: unknown) {
    console.error("[reset-password]", err);
    return NextResponse.json(
      { error: "Password reset failed." },
      { status: 500 },
    );
  }
}
