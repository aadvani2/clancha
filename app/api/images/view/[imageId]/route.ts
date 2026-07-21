import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import connectDB from "@/lib/db/connect";
import { Image } from "@/lib/db/models";
import { getPresignedViewUrl } from "@/lib/services/s3";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  // Approved/pending images: public access by imageId so SMS recipients can view
  // without a portal login. Denied images: admin-only per spec — Picture Sharing
  // Add-on rules require denied images retained with admin-only visibility.

  const { imageId } = await params;
  if (!imageId) {
    return NextResponse.json({ error: "Image ID required" }, { status: 400 });
  }

  try {
    await connectDB();

    const image = await Image.findById(imageId).lean();
    if (!image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    if (image.state === "denied") {
      const auth = await requireAuth();
      if (auth.response) return auth.response;
      if (auth.payload.role !== "super_admin" && auth.payload.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Generate a fresh presigned URL (1 hour expiry).
    // For denied images this is reached only by an authenticated admin — the
    // moderator UI applies the blurred 'UNSAFE' overlay client-side.
    const viewUrl = await getPresignedViewUrl(image.storageUrl, 3600);
    if (!viewUrl) {
      return NextResponse.json({ error: "Could not generate view URL" }, { status: 503 });
    }

    // Redirect the browser directly to the presigned S3 URL
    return NextResponse.redirect(viewUrl, { status: 302 });
  } catch (error) {
    console.error("[images/view] Error:", error);
    return NextResponse.json({ error: "Failed to load image" }, { status: 500 });
  }
}
