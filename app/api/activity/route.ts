import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db/connect";
import { Message, AuditLog, User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

/** Escape user input before using it inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Timeline of activity (messages sent by user or moderator/admin actions). */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    await connectDB();
    const userId = payload.userId;
    const isModerator = payload.role === "moderator";
    const isAdmin = payload.role === "admin" || payload.role === "super_admin";

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const channelId = searchParams.get("channelId");
    const actorId = searchParams.get("actorId");
    // Free-text actor search: a name (or partial name / email / phone) typed by
    // an admin. Resolved to matching user IDs below so the filter no longer
    // requires a raw UUID (M4 tracker #90).
    const actorName = searchParams.get("actorName");
    const action = searchParams.get("action");
    const limitParam = parseInt(searchParams.get("limit") || "100", 10);
    const limit = Math.min(Math.max(limitParam, 1), 500);

    let items: Array<Record<string, unknown>> = [];

    if (isModerator || isAdmin) {
      const auditQuery: Record<string, unknown> = {};

      if (isModerator) {
        // Moderators see only their own moderation actions.
        auditQuery.actorUserId = new mongoose.Types.ObjectId(userId);
        auditQuery.action = {
          $in: [
            "message_moderator_approved",
            "message_moderator_denied",
            "message_moderator_retry_rewrite",
            "image_moderator_approved",
            "image_moderator_denied",
          ],
        };
      }
      // Admins/super_admins: no implicit action filter — they see everything.

      // Filters
      if (channelId) {
        try {
          auditQuery.channelId = new mongoose.Types.ObjectId(channelId);
        } catch {
          /* invalid id ignored */
        }
      }
      if (actorId && isAdmin) {
        try {
          auditQuery.actorUserId = new mongoose.Types.ObjectId(actorId);
        } catch {
          /* invalid id ignored */
        }
      }
      // Name-based actor filter (admins only). Resolve the typed text against
      // user name / email / phone and constrain to the matching IDs. An empty
      // match set yields no rows rather than silently ignoring the filter.
      if (actorName && actorName.trim() && isAdmin && !auditQuery.actorUserId) {
        const term = actorName.trim();
        const rx = new RegExp(escapeRegExp(term), "i");
        const matches = await User.find({
          $or: [{ name: rx }, { email: rx }, { phone: rx }],
        })
          .select("_id")
          .limit(100)
          .lean();
        auditQuery.actorUserId = {
          $in: matches.map((u) => (u as { _id: mongoose.Types.ObjectId })._id),
        };
      }
      if (action) {
        // Override the default action filter when an explicit action is passed.
        auditQuery.action = action;
      }
      if (from || to) {
        const range: Record<string, Date> = {};
        if (from) {
          const d = new Date(from);
          if (!isNaN(d.getTime())) range.$gte = d;
        }
        if (to) {
          const d = new Date(to);
          if (!isNaN(d.getTime())) range.$lte = d;
        }
        if (Object.keys(range).length > 0) auditQuery.createdAt = range;
      }

      const logs = await AuditLog.find(auditQuery)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("channelId", "clanchaNumber name")
        .populate("actorUserId", "name email phone role")
        .populate("targetUserId", "name email phone")
        .lean();

      items = logs.map((l) => {
        const lAny = l as unknown as Record<string, unknown> & {
          _id: { toString(): string };
          channelId?: { _id?: { toString(): string }; name?: string; clanchaNumber?: string };
          actorUserId?: { _id?: { toString(): string }; name?: string; phone?: string; role?: string };
          targetUserId?: { name?: string; phone?: string };
          createdAt?: Date;
          metadata?: unknown;
          action?: string;
        };
        return {
          id: lAny._id.toString(),
          type: "action",
          action: lAny.action,
          channelId: lAny.channelId?._id?.toString(),
          channelName: lAny.channelId?.name || null,
          clanchaNumber: lAny.channelId?.clanchaNumber || null,
          actorId: lAny.actorUserId?._id?.toString(),
          actorName: lAny.actorUserId?.name || "System",
          actorRole: lAny.actorUserId?.role || null,
          targetName: lAny.targetUserId?.name || lAny.targetUserId?.phone || null,
          createdAt: lAny.createdAt,
          metadata: lAny.metadata,
        };
      });
    } else {
      // Regular users see messages they sent (no admin filters apply).
      const msgQuery: Record<string, unknown> = { senderId: userId };
      if (from || to) {
        const range: Record<string, Date> = {};
        if (from) {
          const d = new Date(from);
          if (!isNaN(d.getTime())) range.$gte = d;
        }
        if (to) {
          const d = new Date(to);
          if (!isNaN(d.getTime())) range.$lte = d;
        }
        if (Object.keys(range).length > 0) msgQuery.createdAt = range;
      }
      if (channelId) {
        try {
          msgQuery.channelId = new mongoose.Types.ObjectId(channelId);
        } catch {
          /* invalid id ignored */
        }
      }
      const messages = await Message.find(msgQuery)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("channelId", "clanchaNumber name")
        .lean();

      items = messages.map((m) => {
        const mAny = m as unknown as Record<string, unknown> & {
          _id: { toString(): string };
          channelId?: { _id?: { toString(): string }; name?: string; clanchaNumber?: string };
          originalText?: string;
          rewrittenText?: string;
          state?: string;
          isEmergency?: boolean;
          createdAt?: Date;
          deliveredAt?: Date | null;
        };
        return {
          id: mAny._id.toString(),
          type: "message",
          channelId: mAny.channelId?._id?.toString(),
          channelName: mAny.channelId?.name || null,
          clanchaNumber: mAny.channelId?.clanchaNumber || null,
          originalText: mAny.originalText,
          rewrittenText: mAny.rewrittenText,
          state: mAny.state,
          isEmergency: mAny.isEmergency,
          createdAt: mAny.createdAt,
          deliveredAt: mAny.deliveredAt ?? null,
        };
      });
    }

    return NextResponse.json({ activity: items });
  } catch (error) {
    console.error("activity GET error:", error);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}
