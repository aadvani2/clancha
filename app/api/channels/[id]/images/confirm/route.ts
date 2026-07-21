import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, Image, AuditLog, ModeratorAssignment } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { scanImageForSafety } from "@/lib/services/imageScan";
import type { Types } from "mongoose";

const BUCKET = process.env.AWS_BUCKET ?? process.env.S3_BUCKET ?? "clancha-images";
const REGION = process.env.AWS_REGION ?? "us-east-1";

function keyToStorageUrl(key: string): string {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

export async function POST(
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
    const body = await request.json();
    const { key } = body;

    if (!key || typeof key !== "string" || !key.startsWith("channels/")) {
      return NextResponse.json(
        { error: "Valid key is required (channels/...)" },
        { status: 400 }
      );
    }

    await connectDB();

    const channel = await Channel.findById(channelId).lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const userIdStr = payload.userId;
    const isMember = (channel.users as Types.ObjectId[]).some(
      (id) => id.toString() === userIdStr
    );
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!channel.pictureShareEnabled) {
      return NextResponse.json(
        { error: "Image sharing is not enabled for this channel." },
        { status: 403 }
      );
    }

    const storageUrl = keyToStorageUrl(key);
    const thumbnailUrl = storageUrl; // Same for now

    const scanResult = await scanImageForSafety(storageUrl);

    // All images go to 'pending' state
    const state: "pending" = "pending";

    const image = await Image.create({
      channelId: channel._id,
      senderId: userIdStr,
      storageUrl,
      thumbnailUrl,
      state,
      classification: scanResult
    });

    if (scanResult === "unsafe") {
        await ModeratorAssignment.updateMany(
            { channelId: channel._id },
            { $inc: { unsafeMessageCount: 1 } }
        );
    }

    await AuditLog.create({
      action: "image_uploaded",
      channelId: channel._id,
      actorUserId: userIdStr,
      metadata: { imageId: image._id.toString() },
    });
    await AuditLog.create({
      action: scanResult === "safe" ? "image_ai_scan_safe" : "image_ai_scan_unsafe",
      channelId: channel._id,
      actorUserId: userIdStr,
      metadata: { imageId: image._id.toString(), scanResult },
    });

    return NextResponse.json({
      id: image._id.toString(),
      storageUrl: image.storageUrl,
      thumbnailUrl: image.thumbnailUrl,
      state: image.state,
    });
  } catch (error) {
    console.error("[images/confirm] error:", error);
    return NextResponse.json(
      { error: "Failed to confirm image" },
      { status: 500 }
    );
  }
}
