import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import connectDB from "@/lib/db/connect";
import { Channel, Image, AuditLog } from "@/lib/db/models";
import { getPresignedUploadUrl } from "@/lib/services/s3";
import mongoose from "mongoose";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    const { channelId, fileName, fileType } = await request.json();

    if (!channelId || !fileName || !fileType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await connectDB();

    // ── Gating Check: £4.99 Picture Sharing Add-On ──
    const channel = await Channel.findById(channelId).lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    if (channel.state === "view_only" || channel.state === "closed") {
      return NextResponse.json(
        { error: "Cannot upload images to a channel that is view-only or closed." },
        { status: 403 }
      );
    }

    if (!channel.pictureShareEnabled) {
      return NextResponse.json(
        {
          error: "Picture Sharing is a premium add-on (£4.99/channel).",
          code: "ADDON_REQUIRED",
        },
        { status: 403 }
      );
    }

    // ── Generate S3 Upload URL ──
    const extension = fileName.split('.').pop() || 'jpg';
    const s3Result = await getPresignedUploadUrl(channelId, fileType, extension);
    
    if (!s3Result) {
      return NextResponse.json({ error: "S3 service unavailable" }, { status: 503 });
    }

    const { uploadUrl, key } = s3Result;

    // ── Create Pending Image Record ──
    const image = await Image.create({
      channelId: new mongoose.Types.ObjectId(channelId),
      senderId: new mongoose.Types.ObjectId(payload.userId),
      storageUrl: key,
      state: "pending",
    });

    await AuditLog.create({
      action: "image_uploaded",
      channelId: channel._id,
      actorUserId: payload.userId,
      metadata: { imageId: image._id, key },
    });

    return NextResponse.json({
      uploadUrl,
      imageId: image._id,
      key,
    });
  } catch (error) {
    console.error("[images/upload] Error:", error);
    return NextResponse.json({ error: "Failed to initiate upload" }, { status: 500 });
  }
}
