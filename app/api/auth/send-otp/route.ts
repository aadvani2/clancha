import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User } from "@/lib/db/models";
import {
  normalizePhone,
  isValidE164,
  sendVerificationWithTwilioVerify,
} from "@/lib/auth/twilio-verify";
import { logOtpFailure } from "@/lib/services/otpFailureLog";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, mode } = body;

    if (!phone || typeof phone !== "string") {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    const normalized = normalizePhone(phone);
    if (!normalized || !isValidE164(normalized)) {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 }
      );
    }

    const toE164 = normalized.startsWith("+") ? normalized : `+${normalized}`;

    await connectDB();

    // Check user existence based on mode
    if (mode === "login") {
      const userExists = await User.findOne({
        phone: { $regex: new RegExp(`^\\+?${normalized}$`) },
      });
      if (!userExists) {
        return NextResponse.json(
          { error: "No account found with this phone number. Please sign up instead." },
          { status: 404 }
        );
      }
    } else if (mode === "signup") {
      const userExists = await User.findOne({
        phone: { $regex: new RegExp(`^\\+?${normalized}$`) },
      });
      if (userExists) {
        return NextResponse.json(
          { error: "An account with this phone number already exists. Please login instead." },
          { status: 400 }
        );
      }
    }

    try {
      await sendVerificationWithTwilioVerify(toE164);
    } catch (sendErr) {
      // OTP send hit a real Twilio/transport error — surface it on the
      // Failures page instead of failing silently (#59).
      await logOtpFailure("otp_send", toE164, sendErr, { mode });
      return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "OTP sent successfully",
    });
  } catch (error) {
    console.error("send-otp error:", error);
    return NextResponse.json(
      { error: "Failed to send OTP" },
      { status: 500 }
    );
  }
}
