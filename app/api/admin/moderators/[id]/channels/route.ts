import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User, ModeratorAssignment } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  if (payload.role !== "admin" && payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await connectDB();
    const { id: moderatorId } = await params;
    
    // Check if user is a moderator
    const moderator = await User.findOne({ _id: moderatorId, role: "moderator" });
    if (!moderator) {
      return NextResponse.json({ error: "Moderator not found" }, { status: 404 });
    }

    const assignments = await ModeratorAssignment.find({ userId: moderatorId }).lean();
    const mappedChannelIds = assignments.map(a => a.channelId.toString());

    return NextResponse.json({ channelIds: mappedChannelIds });
  } catch (error) {
    console.error("GET moderator channels error:", error);
    return NextResponse.json(
      { error: "Failed to load moderator channels" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  if (payload.role !== "admin" && payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { channelIds } = await request.json();
    if (!Array.isArray(channelIds)) {
      return NextResponse.json({ error: "channelIds array is required" }, { status: 400 });
    }

    await connectDB();
    const { id: moderatorId } = await params;

    const moderator = await User.findOne({ _id: moderatorId, role: "moderator" });
    if (!moderator) {
      return NextResponse.json({ error: "Moderator not found" }, { status: 404 });
    }

    // Replace assignments completely
    await ModeratorAssignment.deleteMany({ userId: moderatorId });

    if (channelIds.length > 0) {
      const docsToInsert = channelIds.map((cid: string) => ({
        userId: moderatorId,
        channelId: cid,
        unsafeMessageCount: 0,
      }));
      await ModeratorAssignment.insertMany(docsToInsert);
    }

    return NextResponse.json({ success: true, assignedCount: channelIds.length });
  } catch (error) {
    console.error("PUT moderator channels error:", error);
    return NextResponse.json(
      { error: "Failed to update moderator channels" },
      { status: 500 }
    );
  }
}
