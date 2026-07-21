import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, ChannelViewer, AuditLog, User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { getActiveViewersForChannel, revokeViewerAccess } from "@/lib/auth/viewerAuth";
import {
  a13ViewerGrantedFullHistory,
  a14ViewerAccessRestricted,
  a15ViewerRemoved,
  a16ViewerLeft,
} from "@/lib/messaging/appendixA";
import { sendSmsWithRetry } from "@/lib/services/twilio";
import { storeSystemMessage } from "@/lib/messaging/storeSystemMessage";
import type { Types } from "mongoose";

const VIEWER_PHONE_PREFIX = "viewer:";

function isRealPhone(p?: string | null): boolean {
  return !!p && !p.startsWith(VIEWER_PHONE_PREFIX);
}

async function getMembers(channelId: string) {
  const channel = await Channel.findById(channelId).select("users clanchaNumber").lean();
  if (!channel) return null;
  const memberIds = (channel.users as Types.ObjectId[]) ?? [];
  const members = await User.find({ _id: { $in: memberIds } })
    .select("_id name phone")
    .lean();
  return { channel, members };
}

async function smsAndStore(
  channelId: string,
  body: string,
  recipients: { phone?: string | null }[],
  clanchaNumber?: string,
  // The single channel member this notice is FOR. Scopes the stored system
  // message so it surfaces only in that member's portal history. Pass null for
  // genuinely shared notices that BOTH members should see (e.g. A16 viewer
  // left).
  systemRecipientUserId?: Types.ObjectId | string | null,
) {
  for (const r of recipients) {
    if (isRealPhone(r.phone)) {
      try {
        await sendSmsWithRetry(r.phone!, body, clanchaNumber ?? undefined);
      } catch (err) {
        console.error("[viewers] outbound A1x SMS failed:", err);
      }
    }
  }
  try {
    await storeSystemMessage(channelId, body, undefined, systemRecipientUserId ?? null);
  } catch (err) {
    console.error("[viewers] storeSystemMessage failed:", err);
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

    const viewers = await getActiveViewersForChannel(channelId);

    return NextResponse.json({ viewers });
  } catch (error) {
    console.error("channels [id]/viewers GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch viewers" },
      { status: 500 }
    );
  }
}

/**
 * PATCH — the NON-inviting parent toggles their consent to share their own
 * originals with the viewer. Per Craig 2026-05-22 (Item 37):
 *
 *   action: "approve"  → otherParentApproved = true  → A13 to inviting parent
 *   action: "restrict" → otherParentApproved = false → A14 to inviting parent
 *
 * Only the non-inviting parent can hit this. The inviting parent uses DELETE
 * (which removes the viewer entirely → A15).
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
    const { viewerId, action } = (await request.json()) as { viewerId?: string; action?: "approve" | "restrict" };
    if (!viewerId) {
      return NextResponse.json({ error: "Viewer ID required" }, { status: 400 });
    }
    if (action !== "approve" && action !== "restrict") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    await connectDB();

    const data = await getMembers(channelId);
    if (!data) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const { channel, members } = data;

    const isMember = members.some((m) => m._id.toString() === payload.userId);
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const viewer = await ChannelViewer.findOne({ _id: viewerId, channelId, status: "active" });
    if (!viewer) {
      return NextResponse.json({ error: "Viewer not found" }, { status: 404 });
    }

    if (viewer.grantedByUserId.toString() === payload.userId) {
      return NextResponse.json(
        {
          error:
            "You are the inviting parent — your originals are always visible to your viewer. To revoke access, remove the viewer instead.",
        },
        { status: 400 }
      );
    }

    const acting = members.find((m) => m._id.toString() === payload.userId);
    const inviting = members.find((m) => m._id.toString() === viewer.grantedByUserId.toString());
    const viewerUser = await User.findById(viewer.userId).select("name email").lean();
    const viewerName =
      (typeof viewerUser?.name === "string" && viewerUser.name.trim()) ||
      viewerUser?.email ||
      "the viewer";
    const otherParentName =
      (typeof acting?.name === "string" && acting.name.trim()) ||
      "the other parent";

    const nextApproved = action === "approve";
    if (viewer.otherParentApproved === nextApproved) {
      return NextResponse.json({ ok: true, otherParentApproved: nextApproved, noop: true });
    }

    viewer.otherParentApproved = nextApproved;
    await viewer.save();

    await AuditLog.create({
      action: nextApproved ? "viewer_other_parent_approved" : "viewer_other_parent_restricted",
      channelId,
      actorUserId: payload.userId,
      targetUserId: viewer.userId,
      metadata: { viewerId, viewerName },
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const body = nextApproved
      ? a13ViewerGrantedFullHistory({ otherParentName, viewerName })
      : a14ViewerAccessRestricted({ otherParentName, viewerName });
    // A13/A14 are addressed to the inviting parent → scope to them.
    await smsAndStore(channelId, body, [{ phone: inviting?.phone }], channel.clanchaNumber, inviting?._id ?? null);

    return NextResponse.json({ ok: true, otherParentApproved: nextApproved });
  } catch (error) {
    console.error("channels [id]/viewers PATCH error:", error);
    return NextResponse.json({ error: "Failed to update viewer consent" }, { status: 500 });
  }
}

/**
 * DELETE — remove a viewer from a channel. Per Craig 2026-05-22:
 *
 *  - If the inviting parent removes the viewer → access ended entirely.
 *    A15 sent to the OTHER parent.
 *  - If the viewer themselves leaves (sets self.userId === requester via
 *    body.scope === "self") → status revoked. A16 sent to BOTH parents.
 *  - If the non-inviting parent tries to revoke entirely, they're told to
 *    use PATCH (action: "restrict") instead — they can't yank the viewer
 *    out of the inviting parent's invite, only restrict their own originals.
 */
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
    const { viewerId, scope } = (await request.json()) as { viewerId?: string; scope?: "self" };
    if (scope !== "self" && !viewerId) {
      return NextResponse.json({ error: "Viewer ID required" }, { status: 400 });
    }

    await connectDB();

    const data = await getMembers(channelId);
    if (!data) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const { channel, members } = data;

    // When scope:"self" the viewer leaves their own access; viewerId is
    // optional and we look up by auth instead so the viewer portal doesn't
    // need to fetch its own ChannelViewer id first.
    const viewer = scope === "self"
      ? await ChannelViewer.findOne({ userId: payload.userId, channelId, status: "active" })
      : await ChannelViewer.findOne({ _id: viewerId, channelId, status: "active" });
    if (!viewer) {
      return NextResponse.json({ error: "Viewer not found or already revoked" }, { status: 404 });
    }
    const viewerUser = await User.findById(viewer.userId).select("name email phone").lean();
    const viewerName =
      (typeof viewerUser?.name === "string" && viewerUser.name.trim()) ||
      viewerUser?.email ||
      "the viewer";

    const requesterIsViewer = viewer.userId.toString() === payload.userId;
    const requesterIsMember = members.some((m) => m._id.toString() === payload.userId);
    const requesterIsInviting = viewer.grantedByUserId.toString() === payload.userId;

    if (scope === "self") {
      if (!requesterIsViewer) {
        return NextResponse.json({ error: "Only the viewer can leave the channel themselves." }, { status: 403 });
      }
    } else {
      if (!requesterIsMember) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!requesterIsInviting) {
        return NextResponse.json(
          {
            error:
              "Only the inviting parent can remove this viewer entirely. To restrict your own originals from them, PATCH with action: \"restrict\" instead.",
          },
          { status: 403 }
        );
      }
    }

    const resolvedViewerId = viewer._id.toString();
    await revokeViewerAccess(resolvedViewerId, payload.userId);

    if (scope === "self") {
      await AuditLog.create({
        action: "viewer_left_channel",
        channelId,
        actorUserId: payload.userId,
        targetUserId: viewer.userId,
        metadata: { viewerId: resolvedViewerId, viewerName },
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      // A16: notify BOTH parents — genuinely shared notice → visible to all
      // channel members (systemRecipientUserId = null).
      const body = a16ViewerLeft({ viewerName });
      await smsAndStore(channelId, body, members.map((m) => ({ phone: m.phone })), channel.clanchaNumber, null);
    } else {
      // Inviting parent removed the viewer; A15 to the OTHER parent.
      const otherParent = members.find((m) => m._id.toString() !== payload.userId);
      await AuditLog.create({
        action: "viewer_access_revoked",
        channelId,
        actorUserId: payload.userId,
        targetUserId: viewer.userId,
        metadata: { viewerId: resolvedViewerId, viewerName, byInvitingParent: true },
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      // A15 is addressed to the OTHER parent → scope to them.
      const body = a15ViewerRemoved({ viewerName });
      await smsAndStore(channelId, body, [{ phone: otherParent?.phone }], channel.clanchaNumber, otherParent?._id ?? null);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("channels [id]/viewers DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to revoke viewer access" },
      { status: 500 }
    );
  }
}
