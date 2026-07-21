import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { uploadFileToS3, getCloudFrontUrl } from "@/lib/services/s3";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: JPG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Maximum 5 MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const key = `avatars/${auth.payload.userId}/${Date.now()}.${ext}`;

    const result = await uploadFileToS3(key, buffer, file.type);
    if (!result) {
      return NextResponse.json({ error: "Upload to storage failed" }, { status: 500 });
    }

    const cdnDomain = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN;
    const profileImageUrl = cdnDomain ? getCloudFrontUrl(key) : result.storageUrl;

    await connectDB();
    await User.findByIdAndUpdate(auth.payload.userId, { $set: { profileImageUrl } });

    return NextResponse.json({ profileImageUrl });
  } catch (error) {
    console.error("[upload-avatar] error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
