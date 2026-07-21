import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User, PendingChannelInvite } from "@/lib/db/models";
import { signToken } from "@/lib/auth/jwt";
import {
  normalizePhone,
  checkVerificationWithTwilioVerify,
} from "@/lib/auth/twilio-verify";
import { logOtpFailure } from "@/lib/services/otpFailureLog";
import { createChannelBetweenUsers } from "@/lib/services/createChannelBetweenUsers";
import mongoose from "mongoose";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, code, email, name, mode } = body;

    if (!phone || typeof phone !== "string") {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { error: "Verification code is required" },
        { status: 400 }
      );
    }

    const normalized = normalizePhone(phone);
    if (!normalized) {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 }
      );
    }

    const toE164 = normalized.startsWith("+") ? normalized : `+${normalized}`;

    let valid: boolean;
    try {
      valid = await checkVerificationWithTwilioVerify(toE164, code);
    } catch (verifyErr) {
      // A thrown error here is a Twilio Verify transport/API failure (not a
      // wrong code, which returns false). Log it so it isn't silent (#59).
      await connectDB();
      await logOtpFailure("otp_verify", toE164, verifyErr, { mode });
      return NextResponse.json({ error: "Verification failed" }, { status: 500 });
    }
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid or expired verification code" },
        { status: 400 }
      );
    }

    await connectDB();

    // Look up user by phone in exactly two forms: with + and without +.
    // No regex — exact match only — so a truncated/wrong number cannot match another user.
    const withPlus = `+${normalized}`;
    let user = await User.findOne({
      $or: [{ phone: withPlus }, { phone: normalized }],
    });

    const emailTrimmed =
      email && typeof email === "string" && email.trim()
        ? email.trim().toLowerCase()
        : undefined;

    if (!user) {
      // Only create a user when they are in the signup flow. For login, we
      // require an existing account and do not auto-create.
      const isSignup = mode === "signup";
      if (!isSignup) {
        return NextResponse.json(
          { error: "No account found with this phone number. Please sign up instead." },
          { status: 404 }
        );
      }
      const createPayload: Record<string, unknown> = {
        phone: normalized.startsWith("+") ? normalized : `+${normalized}`,
        role: "user",
      };
      if (emailTrimmed) createPayload.email = emailTrimmed;
      if (typeof name === "string" && name.trim()) createPayload.name = name.trim();
      user = await User.create(createPayload);
    } else {
      if ((user as { suspended?: boolean }).suspended) {
        return NextResponse.json(
          { error: "This account has been suspended. Contact support if you need help." },
          { status: 403 }
        );
      }

      let needsSave = false;

      if (emailTrimmed) {
        if (user.email !== emailTrimmed) {
          const existingEmail = await User.findOne({ email: emailTrimmed });
          if (existingEmail && existingEmail._id.toString() !== user._id.toString()) {
            return NextResponse.json(
              { error: "This email is already in use" },
              { status: 400 }
            );
          }
          user.email = emailTrimmed;
          needsSave = true;
        }
      }

      if (name && typeof name === "string" && name.trim() && !user.name) {
        user.name = name.trim();
        needsSave = true;
      }

      if (needsSave) {
        await user.save();
      }
    }

    // Fulfil pending channel invites for this phone by creating channels now that the user exists.
    const pendingInvites = await PendingChannelInvite.find({
      inviteePhone: normalized,
      status: "pending",
      expiresAt: { $gt: new Date() },
    }).lean();

    for (const invite of pendingInvites) {
      const channel = await createChannelBetweenUsers(
        invite.inviterUserId.toString(),
        user!._id.toString()
      );
      if (channel) {
        await PendingChannelInvite.updateOne(
          { _id: invite._id },
          {
            $set: {
              status: "accepted",
              acceptedAt: new Date(),
              channelId: new mongoose.Types.ObjectId(channel.id),
            },
          }
        );
      }
    }

    const token = signToken({
      userId: user._id.toString(),
      phone: user.phone,
      role: user.role,
    });

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user._id.toString(),
        phone: user.phone,
        ...(user.email != null && { email: user.email }),
        role: user.role,
        name: user.name ?? "",
        isSubscribed: !!user.stripeCustomerId,
        subscriptionQuantity: 0, // Will be updated by users/me sync or keep 0 for new
        isPictureAddonEnabled: !!user.isPictureAddonEnabled,
      },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("verify-otp error:", error);
    return NextResponse.json(
      { error: "Verification failed" },
      { status: 500 }
    );
  }
}
