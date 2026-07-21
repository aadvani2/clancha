import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { JoinToken, User } from "@/lib/db/models";
import { hashJoinToken } from "@/lib/auth/joinToken";
import { sendVerificationWithTwilioVerify } from "@/lib/auth/twilio-verify";
import { logOtpFailure } from "@/lib/services/otpFailureLog";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = body ?? {};
    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    await connectDB();

    const record = await JoinToken.findOne({ tokenHash: hashJoinToken(token) }).lean();
    if (!record) {
      return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    }
    if (record.consumedAt) {
      return NextResponse.json({ error: "This invitation has already been claimed" }, { status: 410 });
    }

    const user = await User.findById(record.userId).select("phone").lean();
    if (!user?.phone) {
      return NextResponse.json({ error: "Recipient phone not on record" }, { status: 500 });
    }

    const toE164 = user.phone.startsWith("+") ? user.phone : `+${user.phone}`;
    try {
      await sendVerificationWithTwilioVerify(toE164);
    } catch (sendErr) {
      await logOtpFailure("otp_send", toE164, sendErr, { flow: "join" });
      return NextResponse.json({ error: "Failed to send code" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[join/send-otp]", err);
    return NextResponse.json({ error: "Failed to send code" }, { status: 500 });
  }
}
