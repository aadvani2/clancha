import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/db/connect";
import { User, Invite, ChannelViewer, AuditLog, Channel } from "@/lib/db/models";
import { hashInviteToken, isInviteExpired } from "@/lib/auth/invite";
import { signToken } from "@/lib/auth/jwt";
import { sendSmsWithRetry } from "@/lib/services/twilio";
import { a11ViewerAdded } from "@/lib/messaging/appendixA";
import { storeSystemMessage } from "@/lib/messaging/storeSystemMessage";
import type { Types } from "mongoose";

const VIEWER_PHONE_PREFIX = "viewer:";
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

function placeholderPhoneFor(email: string): string {
  const hash = crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
  return `${VIEWER_PHONE_PREFIX}${hash}`;
}

/**
 * Viewer invitation acceptance. Per Craig 2026-05-22: viewers authenticate
 * with email + password, not SMS OTP. The email is the username, the
 * password is set on first acceptance, and subsequent invitations across
 * channels reuse the same password-protected account.
 *
 * - First acceptance for an email: requires `fullName` + `password`.
 * - Returning viewer: requires `password` only; verified via bcrypt against
 *   the stored hash.
 * - Email is always taken from the invite record so a client can't fake
 *   identity by changing the form value.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, channelId, password, fullName } = body as {
      token?: string;
      channelId?: string;
      password?: string;
      fullName?: string;
    };

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }
    if (!channelId || typeof channelId !== "string") {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    await connectDB();

    const tokenHash = hashInviteToken(token);
    const invite = await Invite.findOne({
      tokenHash,
      channelId,
      status: "pending",
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Invalid or expired invitation" },
        { status: 404 }
      );
    }

    if (isInviteExpired(invite.expiresAt)) {
      invite.status = "expired";
      await invite.save();

      await AuditLog.create({
        action: "invite_expired",
        channelId,
        inviteId: invite._id,
        metadata: { email: invite.email },
        ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });

      return NextResponse.json(
        { error: "This invitation has expired" },
        { status: 410 }
      );
    }

    // Email is taken from the invite — never accept it from the client. A
    // client controlling the form value would otherwise be able to forge a
    // viewer identity just by knowing the invited address shape.
    const inviteEmail = invite.email;

    let user = await User.findOne({ email: inviteEmail }).select("+password");
    let createdNewUser = false;

    if (!user) {
      // First-time viewer — must include a name and choose a password.
      if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
        return NextResponse.json(
          { error: "Your name is required to create your viewer account" },
          { status: 400 }
        );
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json(
          { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
          { status: 400 }
        );
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      user = await User.create({
        email: inviteEmail,
        phone: placeholderPhoneFor(inviteEmail),
        password: passwordHash,
        name: fullName.trim(),
        role: "viewer",
      });
      createdNewUser = true;
    } else {
      // Returning viewer — must supply the password they set previously.
      if (!user.password) {
        return NextResponse.json(
          {
            error:
              "Your viewer account exists but doesn't have a password yet. Please contact the channel member who invited you.",
          },
          { status: 409 }
        );
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        await AuditLog.create({
          action: "invite_password_failed",
          channelId,
          inviteId: invite._id,
          metadata: { email: invite.email },
          ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        }).catch(() => {});
        return NextResponse.json(
          { error: "Incorrect password for this email." },
          { status: 401 }
        );
      }
      // Solicitors / mediators may carry a "viewer" role across many channels;
      // keep the role correct if it ever drifts.
      if (user.role !== "viewer") {
        await User.updateOne({ _id: user._id }, { $set: { role: "viewer" } });
        user.role = "viewer";
      }
    }

    const existingViewer = await ChannelViewer.findOne({
      channelId,
      userId: user._id,
    });

    if (existingViewer) {
      if (existingViewer.status === "active") {
        return NextResponse.json(
          { error: "You already have access to this channel" },
          { status: 409 }
        );
      }
      existingViewer.status = "active";
      existingViewer.inviteId = invite._id;
      existingViewer.accessLevel = invite.accessLevel;
      existingViewer.visibility = invite.visibility ?? "rewrites_only";
      existingViewer.grantedByUserId = invite.invitedByUserId;
      existingViewer.revokedAt = undefined;
      existingViewer.revokedByUserId = undefined;
      await existingViewer.save();
    } else {
      await ChannelViewer.create({
        channelId,
        userId: user._id,
        inviteId: invite._id,
        accessLevel: invite.accessLevel,
        visibility: invite.visibility ?? "rewrites_only",
        status: "active",
        grantedByUserId: invite.invitedByUserId,
      });
    }

    invite.status = "accepted";
    invite.acceptedAt = new Date();
    invite.acceptedByUserId = user._id;
    await invite.save();

    await AuditLog.create({
      action: "invite_accepted",
      channelId,
      actorUserId: user._id,
      inviteId: invite._id,
      metadata: {
        email: invite.email,
        accessLevel: invite.accessLevel,
        visibility: invite.visibility ?? "rewrites_only",
        newAccount: createdNewUser,
      },
      ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    await AuditLog.create({
      action: "viewer_access_granted",
      channelId,
      actorUserId: invite.invitedByUserId,
      targetUserId: user._id,
      inviteId: invite._id,
      metadata: { email: invite.email, accessLevel: invite.accessLevel, visibility: invite.visibility ?? "rewrites_only" },
      ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    // ── A11 viewer-added notification ────────────────────────────────────────
    try {
      const channel = await Channel.findById(channelId)
        .select("users clanchaNumber")
        .lean();
      if (channel) {
        const viewerDisplayName =
          (typeof user.name === "string" && user.name.trim()) ||
          (typeof user.email === "string" && user.email.trim()) ||
          "A new viewer";
        const a11Body = a11ViewerAdded({ viewerName: viewerDisplayName });
        const memberIds = (channel.users as Types.ObjectId[]) ?? [];
        const members = await User.find({ _id: { $in: memberIds } })
          .select("phone")
          .lean();
        for (const m of members) {
          const phone = (m as { phone?: string }).phone;
          // Skip synthetic viewer-style phones so we don't try to SMS an
          // un-routable placeholder string.
          if (phone && !phone.startsWith(VIEWER_PHONE_PREFIX)) {
            await sendSmsWithRetry(phone, a11Body, channel.clanchaNumber ?? undefined);
          }
        }
        // A11 "viewer added" concerns BOTH parents equally → genuinely shared
        // notice (systemRecipientUserId = null).
        await storeSystemMessage(channelId, a11Body, undefined, null);
      }
    } catch (notifyError) {
      console.error("[invites/accept] A11 notification failed:", notifyError);
    }

    const jwtToken = signToken({
      userId: user._id.toString(),
      phone: user.phone,
      role: user.role,
    });

    const response = NextResponse.json({
      success: true,
      message: "Invitation accepted successfully",
      channelId,
      accessLevel: invite.accessLevel,
      userId: user._id.toString(),
      createdNewAccount: createdNewUser,
    });

    response.cookies.set("token", jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("invites/accept error:", error);
    return NextResponse.json(
      { error: "Failed to accept invitation" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const channelId = searchParams.get("channelId");

  if (!token || !channelId) {
    return NextResponse.json(
      { error: "Token and channel ID are required" },
      { status: 400 }
    );
  }

  try {
    await connectDB();

    const tokenHash = hashInviteToken(token);
    const invite = await Invite.findOne({
      tokenHash,
      channelId,
      status: "pending",
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Invalid or expired invitation", valid: false },
        { status: 404 }
      );
    }

    if (isInviteExpired(invite.expiresAt)) {
      invite.status = "expired";
      await invite.save();
      return NextResponse.json(
        { error: "This invitation has expired", valid: false },
        { status: 410 }
      );
    }

    // Tell the client whether to show "create password" vs "log in" UI.
    const existingUser = await User.findOne({ email: invite.email })
      .select("_id name password")
      .lean();
    const hasAccount = !!existingUser;
    const hasPassword = !!(existingUser && (existingUser as { password?: string }).password);

    return NextResponse.json({
      valid: true,
      email: invite.email,
      accessLevel: invite.accessLevel,
      expiresAt: invite.expiresAt,
      existingAccount: hasAccount,
      passwordSet: hasPassword,
    });
  } catch (error) {
    console.error("invites/accept GET error:", error);
    return NextResponse.json(
      { error: "Failed to validate invitation" },
      { status: 500 }
    );
  }
}
