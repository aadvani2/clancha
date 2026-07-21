import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, Message, AuditLog, Image, User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { canAccessChannel, updateViewerLastAccess } from "@/lib/auth/viewerAuth";
import type { Types } from "mongoose";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
    MAX_LIMIT
  );
  const before = searchParams.get("before");
  const after = searchParams.get("after");

  try {
    await connectDB();

    const channel = await Channel.findById(channelId).lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const userId = payload.userId;
    const accessResult = await canAccessChannel(userId, channelId);

    if (!accessResult.canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const query: any = {
      channelId: channel._id as Types.ObjectId,
    };
    if (before) {
      query._id = { $lt: before as unknown as Types.ObjectId };
    } else if (after) {
      query._id = { $gt: after as unknown as Types.ObjectId };
    }

    // VISIBILITY RULES (refreshed 2026-05-22 per Craig — Doc 3 Appendix A13–A16):
    // - Members see delivered messages, their own in-flight messages, and
    //   system messages.
    // - Viewers always see delivered + system messages. Originals are gated
    //   per-sender below (canSeeOriginal) based on the inviting parent and
    //   whether the OTHER parent has opted in via the consent flow. There is
    //   no longer a separate "rewrites_only" / "full_history" filter — the
    //   timeline shape is the same; only the original text varies per-row.
    //
    // SYSTEM-MESSAGE SCOPING (privacy/security — items 29 & 99): a system
    // message carrying a non-null `systemRecipientUserId` is private to that
    // user. It must surface ONLY in that user's history — e.g. the A1 intro
    // (which embeds B's one-shot /join token), A2 queued, A8/A9 image notices.
    // System messages with a null `systemRecipientUserId` remain shared to all
    // channel members (genuinely broadcast notices like "viewer left").
    const systemVisible = {
      isSystem: true,
      $or: [
        { systemRecipientUserId: null },
        { systemRecipientUserId: { $exists: false } },
        { systemRecipientUserId: userId },
      ],
    };
    if (accessResult.isMember) {
      query.$or = [
        { state: "delivered", isSystem: { $ne: true } },
        { senderId: userId, isSystem: { $ne: true } },
        systemVisible,
      ];
    } else if (accessResult.isViewer) {
      // Viewers see delivered (non-system) messages. They are not a channel
      // member, so they only ever see SHARED system notices, never per-user
      // ones scoped to a specific parent.
      query.$or = [
        { state: "delivered", isSystem: { $ne: true } },
        {
          isSystem: true,
          $or: [
            { systemRecipientUserId: null },
            { systemRecipientUserId: { $exists: false } },
          ],
        },
      ];
    } else {
      // Shouldn't happen — canAccess guards above — but be conservative.
      query.$or = [
        { state: "delivered", isSystem: { $ne: true } },
        {
          isSystem: true,
          $or: [
            { systemRecipientUserId: null },
            { systemRecipientUserId: { $exists: false } },
          ],
        },
      ];
    }

    const sortOrder = after ? { createdAt: 1 as const } : { createdAt: -1 as const };
    const messages = await Message.find(query)
      .sort(sortOrder)
      .limit(limit)
      .lean();

    // Batch-fetch image states for all messages that have an imageId
    const imageIds = messages
      .filter((m) => m.imageId)
      .map((m) => m.imageId!.toString());

    const imageStateMap = new Map<string, string>();
    if (imageIds.length > 0) {
      const images = await Image.find({ _id: { $in: imageIds } })
        .select("_id state")
        .lean();
      for (const img of images) {
        imageStateMap.set(img._id.toString(), img.state as string);
      }
    }

    // Batch-resolve sender names so viewers see who said what (members
    // already know — both sides of the conversation are them or the other
    // parent — but the same field is harmless for them too).
    const senderIds = Array.from(
      new Set(messages.map((m) => m.senderId?.toString()).filter(Boolean) as string[])
    );
    const senderNameMap = new Map<string, string>();
    if (senderIds.length > 0) {
      const senders = await User.find({ _id: { $in: senderIds } })
        .select("_id name")
        .lean();
      for (const u of senders) {
        senderNameMap.set(u._id.toString(), u.name || "");
      }
    }

    let previousDate: string | null = null;
    const invitingParentId = accessResult.invitingParentUserId ?? null;
    const otherParentApproved = !!accessResult.otherParentApproved;
    const items = messages.map((m) => {
      const senderIdStr = m.senderId ? m.senderId.toString() : null;
      const isSender = senderIdStr === userId;
      // Members see only their own original wording (the other member's
      // originals are never exposed per spec Doc 3 "Portal Message
      // Visibility Rules"). Viewers see the inviting parent's originals
      // always, and the other parent's originals only when that parent has
      // approved full-history via the consent flow (A13).
      let canSeeOriginal = false;
      if (accessResult.isMember && isSender) {
        canSeeOriginal = true;
      } else if (accessResult.isViewer && senderIdStr) {
        if (invitingParentId && senderIdStr === invitingParentId) {
          canSeeOriginal = true;
        } else if (invitingParentId && otherParentApproved && senderIdStr !== invitingParentId) {
          canSeeOriginal = true;
        }
      }

      const mObj = m as any;
      const imageIdRaw = mObj.imageId;
      const imageId = imageIdRaw ? imageIdRaw.toString() : undefined;
      const imageState = imageId ? (imageStateMap.get(imageId) ?? "pending") : undefined;

      const mAny = m as any;
      return {
        id: m._id.toString(),
        channelId: m.channelId.toString(),
        senderId: senderIdStr,
        senderName: senderIdStr ? senderNameMap.get(senderIdStr) ?? "" : "",
        originalText: canSeeOriginal ? m.originalText : undefined,
        rewrittenText: m.rewrittenText,
        imageUrl: imageId ? `/api/images/view/${imageId}` : undefined,
        imageState,
        state: m.state,
        isEmergency: m.isEmergency,
        isSystem: mAny.isSystem ?? false,
        deliveredAt: m.deliveredAt ?? null,
        createdAt: m.createdAt,
      };
    });

    const chronologicalItems = after ? items : items.reverse();
    
    // Log viewer access and update last access time
    if (accessResult.isViewer && accessResult.viewerId) {
      await updateViewerLastAccess(accessResult.viewerId);
      await AuditLog.create({
        action: "viewer_viewed_messages",
        channelId,
        actorUserId: userId,
        metadata: { messageCount: items.length, accessLevel: accessResult.accessLevel },
      });
    }

    // For viewer alignment: surface the two channel members in a deterministic
    // order so the client can pick "right side = first member, left = second"
    // and the conversation reads like a real chat instead of all bubbles
    // landing on one side.
    const memberIds = (channel.users as Types.ObjectId[]).map((id) => id.toString());
    const memberNames = await User.find({ _id: { $in: memberIds } })
      .select("_id name")
      .lean();
    const memberNameMap = new Map(memberNames.map((u) => [u._id.toString(), u.name || ""]));
    const participants = memberIds.map((id) => ({ id, name: memberNameMap.get(id) || "" }));

    return NextResponse.json({
      messages: chronologicalItems,
      hasMore: items.length === limit,
      isViewer: accessResult.isViewer,
      accessLevel: accessResult.isViewer ? accessResult.accessLevel : undefined,
      participants,
    });
  } catch (error) {
    console.error("channels/[id]/messages GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
