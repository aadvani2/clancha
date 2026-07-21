import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { getPresignedUploadUrl } from "@/lib/services/s3";
import type { Types } from "mongoose";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

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
    const { filename, contentType, size } = body;

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { error: "filename is required" },
        { status: 400 }
      );
    }
    if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: `Invalid contentType. Allowed: ${ALLOWED_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    if (typeof size === "number" && size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${MAX_SIZE_MB} MB` },
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

    if (channel.state === "view_only" || channel.state === "closed") {
      return NextResponse.json(
        { error: "Cannot upload in this channel" },
        { status: 403 }
      );
    }
    if (!channel.pictureShareEnabled) {
      return NextResponse.json(
        { error: "Image sharing is not enabled for this channel. Purchase the picture add-on to share images." },
        { status: 403 }
      );
    }

    const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
    const normalizedExt = ["jpeg", "jpg"].includes(ext) ? "jpg" : ext;
    if (!["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      return NextResponse.json(
        { error: "Invalid file extension" },
        { status: 400 }
      );
    }

    const result = await getPresignedUploadUrl(channelId, contentType, normalizedExt);
    if (!result) {
      return NextResponse.json(
        { error: "S3 not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      key: result.key,
      storageUrl: result.storageUrl,
    });
  } catch (error) {
    console.error("[images/upload-url] error:", error);
    return NextResponse.json(
      { error: "Failed to get upload URL" },
      { status: 500 }
    );
  }
}
