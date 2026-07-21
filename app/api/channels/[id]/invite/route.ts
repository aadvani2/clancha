import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, Invite, AuditLog, User } from "@/lib/db/models";
import type { AccessLevel, ViewerVisibility } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import {
  generateInviteToken,
  hashInviteToken,
  getInviteExpiry,
  generateInviteLink,
} from "@/lib/auth/invite";
import { sendInviteEmail, isEmailConfigured } from "@/lib/services/email";
import type { Types } from "mongoose";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  const { id: channelId } = await params;
  if (!channelId) {
    return NextResponse.json({ error: "Channel ID required" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { email, viewerName } = body as { email?: string; viewerName?: string };

    if (!email || typeof email !== "string" || !email.trim()) {
      return NextResponse.json(
        { error: "Email is required for invitation" },
        { status: 400 }
      );
    }
    if (!viewerName || typeof viewerName !== "string" || !viewerName.trim()) {
      return NextResponse.json(
        { error: "Viewer name is required so the other parent knows who they are." },
        { status: 400 }
      );
    }

    // Per Craig 2026-05-22: viewers are always read_only (Doc 2 §12) and
    // visibility is auto-mirror-adding-parent (no per-invite dropdown — the
    // consent flow controls what the OTHER parent shares). Keep the legacy
    // enum values stored for back-compat with old rows / queries.
    const accessLevel: AccessLevel = "read_only";
    const visibility: ViewerVisibility = "rewrites_only";

    await connectDB();

    const channel = await Channel.findById(channelId).lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const isMember = (channel.users as Types.ObjectId[]).some(
      (id) => id.toString() === payload.userId
    );
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const existingPendingInvite = await Invite.findOne({
      channelId,
      email: email.toLowerCase().trim(),
      status: "pending",
    });

    if (existingPendingInvite) {
      return NextResponse.json(
        { error: "An active invitation already exists for this email" },
        { status: 409 }
      );
    }

    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const expiresAt = getInviteExpiry();

    const invite = await Invite.create({
      channelId,
      invitedByUserId: payload.userId,
      email: email.toLowerCase().trim(),
      viewerName: viewerName.trim(),
      tokenHash,
      accessLevel,
      visibility: visibility as ViewerVisibility,
      status: "pending",
      expiresAt,
    });

    await AuditLog.create({
      action: "invite_created",
      channelId,
      actorUserId: payload.userId,
      inviteId: invite._id,
      metadata: {
        email: email.toLowerCase().trim(),
        viewerName: viewerName.trim(),
        accessLevel,
        visibility,
      },
      ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const inviteLink = generateInviteLink(token, channelId);

    // Fire-and-forward email so the viewer doesn't have to be SMS'd the link
    // by the inviting parent. Modal still shows the link for manual share as
    // a fallback. Graceful if SENDGRID_API_KEY isn't configured.
    let emailSent = false;
    let emailError: string | undefined;
    if (isEmailConfigured()) {
      const inviter = await User.findById(payload.userId).select("name email").lean();
      const inviterName =
        (typeof inviter?.name === "string" && inviter.name.trim()) ||
        inviter?.email?.split("@")[0] ||
        "Your co-parent";
      const result = await sendInviteEmail({
        to: email.toLowerCase().trim(),
        inviteLink,
        viewerName: viewerName.trim(),
        inviterName,
        channelName: channel.name ?? "",
        expiresAt,
      });
      emailSent = result.success;
      if (!result.success) emailError = result.error;
      await AuditLog.create({
        action: "invite_created",
        channelId,
        actorUserId: payload.userId,
        inviteId: invite._id,
        metadata: {
          stage: "email_dispatch",
          emailSent: result.success,
          emailError: result.error ?? null,
          messageId: result.messageId ?? null,
        },
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      inviteId: invite._id.toString(),
      inviteLink,
      expiresAt,
      emailSent,
      emailError,
      message: emailSent
        ? "Invitation sent by email."
        : "Invitation created. Share the link below.",
    });
  } catch (error) {
    console.error("channels [id]/invite POST error:", error);
    return NextResponse.json(
      { error: "Failed to create invitation" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  const { id: channelId } = await params;
  if (!channelId) {
    return NextResponse.json({ error: "Channel ID required" }, { status: 400 });
  }

  try {
    await connectDB();

    const channel = await Channel.findById(channelId).lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const isMember = (channel.users as Types.ObjectId[]).some(
      (id) => id.toString() === payload.userId
    );
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const invites = await Invite.find({
      channelId,
      status: { $in: ["pending", "accepted"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({
      invites: invites.map((inv) => ({
        id: inv._id.toString(),
        email: inv.email,
        viewerName: inv.viewerName ?? null,
        accessLevel: inv.accessLevel,
        visibility: inv.visibility ?? "rewrites_only",
        status: inv.status,
        expiresAt: inv.expiresAt,
        acceptedAt: inv.acceptedAt,
        createdAt: inv.createdAt,
      })),
    });
  } catch (error) {
    console.error("channels [id]/invite GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch invitations" },
      { status: 500 }
    );
  }
}

/**
 * PATCH — rotate the token on a pending invite so the inviting parent can
 * re-share the link if they closed the "Invitation Ready" modal without
 * copying it. Invalidates the previous link, bumps expiresAt, and
 * (optionally) re-sends the email.
 *
 * Body: { inviteId: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  const { id: channelId } = await params;
  if (!channelId) {
    return NextResponse.json({ error: "Channel ID required" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { inviteId } = body as { inviteId?: string };
    if (!inviteId) {
      return NextResponse.json({ error: "inviteId is required" }, { status: 400 });
    }

    await connectDB();

    const channel = await Channel.findById(channelId).lean();
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const isMember = (channel.users as Types.ObjectId[]).some(
      (id) => id.toString() === payload.userId
    );
    if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const invite = await Invite.findOne({ _id: inviteId, channelId, status: "pending" });
    if (!invite) {
      return NextResponse.json(
        { error: "Pending invitation not found or already accepted/revoked" },
        { status: 404 }
      );
    }

    const token = generateInviteToken();
    invite.tokenHash = hashInviteToken(token);
    invite.expiresAt = getInviteExpiry();
    await invite.save();

    const inviteLink = generateInviteLink(token, channelId);

    let emailSent = false;
    let emailError: string | undefined;
    if (isEmailConfigured()) {
      const inviter = await User.findById(payload.userId).select("name email").lean();
      const inviterName =
        (typeof inviter?.name === "string" && inviter.name.trim()) ||
        inviter?.email?.split("@")[0] ||
        "Your co-parent";
      const result = await sendInviteEmail({
        to: invite.email,
        inviteLink,
        viewerName: invite.viewerName ?? invite.email,
        inviterName,
        channelName: channel.name ?? "",
        expiresAt: invite.expiresAt,
      });
      emailSent = result.success;
      if (!result.success) emailError = result.error;
    }

    await AuditLog.create({
      action: "invite_created",
      channelId,
      actorUserId: payload.userId,
      inviteId: invite._id,
      metadata: {
        stage: "token_rotated",
        emailSent,
        emailError: emailError ?? null,
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      inviteId: invite._id.toString(),
      inviteLink,
      expiresAt: invite.expiresAt,
      emailSent,
      emailError,
      email: invite.email,
      viewerName: invite.viewerName ?? null,
    });
  } catch (error) {
    console.error("channels [id]/invite PATCH error:", error);
    return NextResponse.json({ error: "Failed to refresh invitation" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  const { id: channelId } = await params;
  if (!channelId) {
    return NextResponse.json({ error: "Channel ID required" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { inviteId } = body;

    if (!inviteId) {
      return NextResponse.json({ error: "Invite ID required" }, { status: 400 });
    }

    await connectDB();

    const channel = await Channel.findById(channelId).lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const isMember = (channel.users as Types.ObjectId[]).some(
      (id) => id.toString() === payload.userId
    );
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const invite = await Invite.findOne({
      _id: inviteId,
      channelId,
      status: "pending",
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Invitation not found or already processed" },
        { status: 404 }
      );
    }

    invite.status = "revoked";
    await invite.save();

    await AuditLog.create({
      action: "invite_revoked",
      channelId,
      actorUserId: payload.userId,
      inviteId: invite._id,
      metadata: { email: invite.email },
      ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("channels [id]/invite DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to revoke invitation" },
      { status: 500 }
    );
  }
}
