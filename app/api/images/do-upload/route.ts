import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import connectDB from "@/lib/db/connect";
import { Channel, Image, AuditLog } from "@/lib/db/models";
import { uploadFileToS3 } from "@/lib/services/s3";
import mongoose from "mongoose";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const channelId = formData.get("channelId") as string | null;

    if (!file || !channelId) {
      return NextResponse.json(
        { error: "Missing file or channelId" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    await connectDB();

    // Check channel access & feature flag
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

    // Build S3 key
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeExt = ["jpeg", "jpg"].includes(ext) ? "jpg" : ext;
    const key = `channels/${channelId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${safeExt}`;

    // Upload directly from server — no CORS, no checksum issues
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const s3Result = await uploadFileToS3(key, buffer, file.type);
    if (!s3Result) {
      return NextResponse.json(
        { error: "S3 upload failed. Check AWS configuration." },
        { status: 503 }
      );
    }

    // Create image record in DB
    const image = await Image.create({
      channelId: new mongoose.Types.ObjectId(channelId),
      senderId: new mongoose.Types.ObjectId(payload.userId),
      storageUrl: s3Result.key, // store the key; view URL is presigned on demand
      state: "pending",
    });

    await AuditLog.create({
      action: "image_uploaded",
      channelId: channel._id,
      actorUserId: payload.userId,
      metadata: { imageId: image._id, key: s3Result.key },
    });

    return NextResponse.json({
      imageId: image._id,
      key: s3Result.key,
    });
  } catch (error) {
    console.error("[images/do-upload] Error:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 }
    );
  }
}
