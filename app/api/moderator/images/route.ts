import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Image } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { canAccessModeration } from "@/lib/auth/moderatorAccess";
import { getPresignedViewUrl } from "@/lib/services/s3";
import { applyModeratorImageDecision } from "@/lib/services/moderatorImageReview";
import mongoose from "mongoose";

/**
 * List pending images for moderation (preview URLs).
 * Approve/deny: delegates to shared moderator image review (same as POST /api/moderator/review).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (!canAccessModeration(auth.payload.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await connectDB();
    const images = await Image.find({ state: "pending" })
      .sort({ createdAt: 1 })
      .populate("senderId", "name phone")
      .populate("channelId", "name clanchaNumber")
      .lean();

    const imagesWithUrls = await Promise.all(
      images.map(async (img: any) => ({
        ...img,
        viewUrl: await getPresignedViewUrl(img.storageUrl, 3600),
        violationTags: img.violationTags || [],
        classification: img.classification || "uncertain",
      }))
    );

    return NextResponse.json(imagesWithUrls);
  } catch (error) {
    console.error("[moderator/images] GET Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (!canAccessModeration(auth.payload.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { imageId, action, moderatorNotes } = await request.json();

    if (!imageId || !["approved", "denied"].includes(action)) {
      return NextResponse.json({ error: "Missing required fields: imageId, action" }, { status: 400 });
    }

    const moderatorId = new mongoose.Types.ObjectId(auth.payload.userId);
    const decision = await applyModeratorImageDecision({
      imageId,
      moderatorId,
      action: action === "approved" ? "approve" : "deny",
      notes: typeof moderatorNotes === "string" ? moderatorNotes : undefined,
    });

    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    return NextResponse.json({ success: true, state: decision.state });
  } catch (error) {
    console.error("[moderator/images] PATCH Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
