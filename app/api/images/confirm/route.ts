import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import connectDB from "@/lib/db/connect";
import { Image, AuditLog, Channel } from "@/lib/db/models";
import { moderateImage } from "@/lib/services/imageModeration";
import { getPresignedViewUrl } from "@/lib/services/s3";
import { Types } from "mongoose";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    const { imageId } = await request.json();

    if (!imageId) {
      return NextResponse.json({ error: "Missing imageId" }, { status: 400 });
    }

    await connectDB();

    const image = await Image.findById(imageId);
    if (!image) {
      return NextResponse.json({ error: "Image record not found" }, { status: 404 });
    }

    if (image.senderId.toString() !== payload.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const signedViewUrl = await getPresignedViewUrl(image.storageUrl, 604800);
    if (!signedViewUrl) {
      return NextResponse.json({ error: "Could not generate signed URL" }, { status: 503 });
    }

    let moderationResult;
    try {
      moderationResult = await moderateImage(signedViewUrl);
    } catch (error) {
      console.error("[Confirm] ✗ AI Moderation Failed:", error);
      moderationResult = {
        decision: "pending",
        classification: "error",
        reason: "AI Moderation service temporarily unavailable",
        score: 0,
        tags: ["System_Error"],
      };
    }

    // All images route to the human moderator queue. AI moderation is kept as
    // advisory metadata on the image record so the moderator can see classification,
    // reason, and tags — but only the moderator's approve/deny decides delivery.
    image.state = "pending";
    image.aiScore = moderationResult.score;
    image.aiReason = moderationResult.reason;
    image.classification = moderationResult.classification;
    image.violationTags = moderationResult.tags;

    await image.save();

    const channel = await Channel.findById(image.channelId).lean();
    const recipientUserId = (channel?.users as Types.ObjectId[])?.find(
      (id) => id.toString() !== image.senderId.toString()
    );

    await AuditLog.create({
      action: "image_ai_scan_pending",
      channelId: image.channelId,
      actorUserId: payload.userId,
      ...(recipientUserId && { targetUserId: recipientUserId }),
      metadata: {
        imageId,
        classification: moderationResult.classification,
        violationTags: moderationResult.tags,
        aiDecision: moderationResult.decision,
      },
    });

    console.log(
      `[Confirm] Image ${imageId} queued for human moderation (AI advisory: ${moderationResult.decision})`
    );

    return NextResponse.json({
      success: true,
      decision: moderationResult.decision,
      classification: moderationResult.classification,
      violationTags: moderationResult.tags,
      pendingHumanReview: true,
    });
  } catch (error) {
    console.error("[images/confirm] Error:", error);
    return NextResponse.json({ error: "Failed to confirm upload" }, { status: 500 });
  }
}
