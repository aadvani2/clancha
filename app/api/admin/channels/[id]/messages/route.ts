import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import type { Types } from "mongoose";
import connectDB from "@/lib/db/connect";
import { Channel, Message, User, AuditLog } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

// Hard cap so the audit view stays performant on long-running channels. A
// simple chronological list capped here is enough for the read-only history
// (M4 tracker #88) — paginate later if a channel ever exceeds this.
const MESSAGE_LIMIT = 500;

/**
 * Super admin: full, read-only channel message history.
 *
 * Decision (2 Jun, M4 #88): the super admin can view the complete channel
 * history — BOTH parents' ORIGINAL messages AND their rewrites — from the
 * admin channel detail page. This is admin-only and must NEVER be exposed to
 * users or viewers (the user/viewer messages routes apply their own
 * visibility gates and are untouched here). Every successful fetch is written
 * to the audit trail.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  // Super admin only — not admin, not moderator, never a member/viewer.
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Channel id required" }, { status: 400 });
  }

  try {
    await connectDB();

    const channel = await Channel.findById(id).select("_id users").lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const messages = await Message.find({ channelId: id })
      .sort({ createdAt: 1 })
      .limit(MESSAGE_LIMIT)
      .lean();

    // Resolve sender names in one query.
    const senderIds = Array.from(
      new Set(
        messages
          .map((m) => (m.senderId ? m.senderId.toString() : null))
          .filter((v): v is string => !!v)
      )
    );
    const senders = senderIds.length
      ? await User.find({ _id: { $in: senderIds } })
          .select("name phone")
          .lean()
      : [];
    const senderMap = new Map(
      senders.map((u) => {
        const ux = u as unknown as { _id: Types.ObjectId; name?: string | null; phone?: string | null };
        return [ux._id.toString(), (ux.name && ux.name.trim()) || ux.phone || "Unknown"];
      })
    );

    const items = messages.map((m) => {
      const mx = m as unknown as {
        _id: Types.ObjectId;
        senderId?: Types.ObjectId | null;
        originalText: string;
        rewrittenText: string;
        state: string;
        isSystem: boolean;
        isEmergency: boolean;
        createdAt: Date;
      };
      const sid = mx.senderId ? mx.senderId.toString() : null;
      return {
        id: mx._id.toString(),
        senderId: sid,
        senderName: mx.isSystem ? "System" : sid ? senderMap.get(sid) ?? "Unknown" : "Unknown",
        originalText: mx.originalText ?? "",
        rewrittenText: mx.rewrittenText ?? "",
        state: mx.state,
        isSystem: !!mx.isSystem,
        isEmergency: !!mx.isEmergency,
        createdAt: mx.createdAt ? new Date(mx.createdAt).toISOString() : null,
      };
    });

    // Audit every access to the full history (M4 #88).
    await AuditLog.create({
      action: "admin_viewed_channel_messages",
      channelId: channel._id,
      actorUserId: new mongoose.Types.ObjectId(auth.payload.userId),
      metadata: { count: items.length, capped: messages.length >= MESSAGE_LIMIT },
      ipAddress:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    });

    return NextResponse.json({ messages: items, capped: messages.length >= MESSAGE_LIMIT });
  } catch (error) {
    console.error("[admin/channels/[id]/messages] error:", error);
    return NextResponse.json({ error: "Failed to fetch channel messages" }, { status: 500 });
  }
}
