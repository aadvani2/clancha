import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Message, Image } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { canAccessModeration } from "@/lib/auth/moderatorAccess";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";

/**
 * Resolve a display name for the sender of a queued item. Prefer the
 * participant's saved name; if they never set one (e.g. a second parent who
 * joined via OTP), fall back to the formatted phone number rather than a bare
 * E.164 string or "Unknown sender" (M4 tracker #91).
 */
function resolveSenderName(name?: string | null, phone?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (trimmed) return trimmed;
  if (phone) return formatPhoneForDisplay(phone);
  return "Unknown sender";
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  if (!canAccessModeration(payload.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");

  try {
    await connectDB();

    const msgQuery: any = { state: "held", deliveredAt: null };
    const imgQuery: any = { state: "pending" };
    if (channelId) {
      msgQuery.channelId = channelId;
      imgQuery.channelId = channelId;
    }

    const [heldMessages, pendingImages] = await Promise.all([
      Message.find(msgQuery)
        .populate("senderId", "phone name")
        .populate("channelId", "clanchaNumber")
        .sort({ createdAt: 1 })
        .limit(100)
        .lean(),
      Image.find(imgQuery)
        .populate("senderId", "phone name")
        .populate("channelId", "clanchaNumber")
        .sort({ createdAt: 1 })
        .limit(100)
        .lean(),
    ]);

    return NextResponse.json({
      messages: heldMessages.map((m: any) => ({
        id: m._id.toString(),
        channelId: (m.channelId as any)?._id?.toString() ?? m.channelId?.toString(),
        channelNumber: (m.channelId as any)?.clanchaNumber ?? null,
        senderName: resolveSenderName((m.senderId as any)?.name, (m.senderId as any)?.phone),
        senderPhone: (m.senderId as any)?.phone ?? null,
        originalText: m.originalText,
        rewrittenText: m.rewrittenText,
        classification: m.classification ?? null,
        violationTags: m.violationTags ?? [],
        state: m.state,
        createdAt: m.createdAt,
      })),
      images: pendingImages.map((i: any) => ({
        id: i._id.toString(),
        channelId: (i.channelId as any)?._id?.toString() ?? i.channelId?.toString(),
        channelNumber: (i.channelId as any)?.clanchaNumber ?? null,
        senderName: resolveSenderName((i.senderId as any)?.name, (i.senderId as any)?.phone),
        senderPhone: (i.senderId as any)?.phone ?? null,
        storageUrl: i.storageUrl,
        thumbnailUrl: i.thumbnailUrl,
        state: i.state,
        classification: i.classification ?? null,
        aiReason: i.aiReason ?? null,
        violationTags: i.violationTags ?? [],
        createdAt: i.createdAt,
      })),
    });
  } catch (error) {
    console.error("moderator/queue error:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue" },
      { status: 500 }
    );
  }
}
