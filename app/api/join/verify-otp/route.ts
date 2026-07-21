import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { JoinToken, User, Channel } from "@/lib/db/models";
import { hashJoinToken } from "@/lib/auth/joinToken";
import { checkVerificationWithTwilioVerify } from "@/lib/auth/twilio-verify";
import { logOtpFailure } from "@/lib/services/otpFailureLog";
import { signToken } from "@/lib/auth/jwt";

// Second-parent default settings per Craig 2026-05-27 (tracker #79):
// wider receiving window than the legacy 08:00-21:00 to err on the side of
// genuine school-morning / evening-pickup messages getting through.
const JOINER_DEFAULTS = {
  receivingHoursStart: "06:00",
  receivingHoursEnd: "23:00",
  timezone: "Europe/London",
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, code } = body ?? {};
    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Verification code is required" }, { status: 400 });
    }

    await connectDB();

    const tokenHash = hashJoinToken(token);
    const record = await JoinToken.findOne({ tokenHash });
    if (!record) {
      return NextResponse.json({ error: "Invalid invitation" }, { status: 404 });
    }
    if (record.consumedAt) {
      return NextResponse.json(
        { error: "This invitation has already been claimed. Please sign in instead." },
        { status: 410 }
      );
    }

    const user = await User.findById(record.userId);
    if (!user?.phone) {
      return NextResponse.json({ error: "Recipient phone not on record" }, { status: 500 });
    }
    if ((user as { suspended?: boolean }).suspended) {
      return NextResponse.json(
        { error: "This account has been suspended. Contact support if you need help." },
        { status: 403 }
      );
    }

    const toE164 = user.phone.startsWith("+") ? user.phone : `+${user.phone}`;
    let valid: boolean;
    try {
      valid = await checkVerificationWithTwilioVerify(toE164, code);
    } catch (verifyErr) {
      await logOtpFailure("otp_verify", toE164, verifyErr, { flow: "join" });
      return NextResponse.json({ error: "Verification failed" }, { status: 500 });
    }
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid or expired verification code" },
        { status: 400 }
      );
    }

    // Confirm the channel still exists and the user is still a participant
    // before consuming the token. If the channel was closed in the gap
    // between A1 and join, surface a clear message rather than landing the
    // joiner in a broken state.
    const channel = await Channel.findById(record.channelId).select("state users").lean();
    if (!channel) {
      return NextResponse.json({ error: "This channel no longer exists" }, { status: 404 });
    }
    if (channel.state === "closed") {
      return NextResponse.json({ error: "This channel has been closed" }, { status: 410 });
    }

    // Seed joiner defaults. Only fill empty fields so a returning joiner
    // (token re-claim shouldn't happen because of consumedAt, but be safe)
    // doesn't have their personalised settings clobbered.
    let needsSave = false;
    if (!user.receivingHoursStart) {
      user.receivingHoursStart = JOINER_DEFAULTS.receivingHoursStart;
      needsSave = true;
    }
    if (!user.receivingHoursEnd) {
      user.receivingHoursEnd = JOINER_DEFAULTS.receivingHoursEnd;
      needsSave = true;
    }
    if (!user.timezone) {
      user.timezone = JOINER_DEFAULTS.timezone;
      needsSave = true;
    }
    if (needsSave) await user.save();

    // Consume the token atomically — single-use. A second verify with the
    // same token will hit the consumedAt branch above and 410.
    await JoinToken.updateOne(
      { _id: record._id, consumedAt: null },
      { $set: { consumedAt: new Date() } }
    );

    const sessionJwt = signToken({
      userId: user._id.toString(),
      phone: user.phone,
      role: user.role,
    });

    const response = NextResponse.json({
      success: true,
      channelId: record.channelId.toString(),
      user: {
        id: user._id.toString(),
        phone: user.phone,
        role: user.role,
        name: user.name ?? "",
        email: user.email ?? null,
      },
    });

    response.cookies.set("token", sessionJwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("[join/verify-otp]", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
