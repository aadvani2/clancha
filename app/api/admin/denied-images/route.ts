import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Image, Channel, User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import type { Types } from "mongoose";

/**
 * GET /api/admin/denied-images
 *
 * Returns all images currently in `state:"denied"`. Admin/super_admin only —
 * the spec requires denied images be retained for 30 days, admin-visible only,
 * then permanently removed (handled by the cron at /api/cron/route.ts).
 *
 * The 30-day countdown is derived from updatedAt — that's the field the cron
 * uses to decide when to purge. We surface it so the admin can see exactly
 * when each retained image will be deleted.
 */
export async function GET(_request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  if (payload.role !== "admin" && payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await connectDB();

    const denied = await Image.find({ state: "denied" })
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    // Batch-resolve channel + sender names to keep the response compact.
    const channelIds = [...new Set(denied.map((i) => i.channelId.toString()))];
    const senderIds = [...new Set(denied.map((i) => i.senderId.toString()))];

    const [channels, senders] = await Promise.all([
      Channel.find({ _id: { $in: channelIds } })
        .select("_id name clanchaNumber")
        .lean(),
      User.find({ _id: { $in: senderIds } })
        .select("_id name email phone")
        .lean(),
    ]);

    const channelMap = new Map(
      channels.map((c: { _id: Types.ObjectId; name?: string; clanchaNumber?: string }) => [
        c._id.toString(),
        c,
      ])
    );
    const senderMap = new Map(
      senders.map((u: { _id: Types.ObjectId; name?: string; email?: string; phone?: string }) => [
        u._id.toString(),
        u,
      ])
    );

    // 30 days from updatedAt — the cron purges anything older than this.
    const now = Date.now();
    const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

    const items = denied.map((img) => {
      const channel = channelMap.get(img.channelId.toString());
      const sender = senderMap.get(img.senderId.toString());
      const deniedAtMs = new Date(img.updatedAt).getTime();
      const purgesAtMs = deniedAtMs + RETENTION_MS;
      const daysRemaining = Math.max(0, Math.ceil((purgesAtMs - now) / (24 * 60 * 60 * 1000)));

      return {
        id: img._id.toString(),
        channelId: img.channelId.toString(),
        channelName: channel?.name ?? null,
        clanchaNumber: channel?.clanchaNumber ?? null,
        senderId: img.senderId.toString(),
        senderName: sender?.name ?? null,
        senderEmail: sender?.email ?? null,
        senderPhone: sender?.phone ?? null,
        deniedAt: new Date(img.updatedAt).toISOString(),
        purgesAt: new Date(purgesAtMs).toISOString(),
        daysRemaining,
        aiReason: img.aiReason ?? null,
        moderatorNotes: img.moderatorNotes ?? null,
        violationTags: img.violationTags ?? [],
        classification: img.classification ?? null,
        // The view endpoint enforces its own admin gate.
        viewUrl: `/api/images/view/${img._id.toString()}`,
      };
    });

    return NextResponse.json({ items, total: items.length });
  } catch (error) {
    console.error("admin/denied-images GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch denied images" },
      { status: 500 }
    );
  }
}
