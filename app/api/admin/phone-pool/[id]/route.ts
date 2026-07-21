import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { PhoneNumber, Channel } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * GET    /api/admin/phone-pool/[id] — number detail + assigned channels, oldest first (allocation order)
 * PATCH  /api/admin/phone-pool/[id] — toggle isActive
 * DELETE /api/admin/phone-pool/[id] — remove number (only if unassigned)
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await connectDB();
    const doc = await PhoneNumber.findById(id).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Oldest first so position in the list is the allocation order for this number.
    const channels = await Channel.find({ clanchaNumber: doc.number })
      .sort({ createdAt: 1 })
      .select("name state createdAt")
      .lean();

    return NextResponse.json({
      id: doc._id.toString(),
      number: doc.number,
      isActive: doc.isActive,
      channels: channels.map((c, index) => ({
        id: c._id.toString(),
        name: c.name ?? null,
        state: c.state,
        createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
        allocationOrder: index + 1,
      })),
    });
  } catch (error) {
    console.error("[admin/phone-pool/:id GET] error:", error);
    return NextResponse.json({ error: "Failed to fetch number detail" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const { isActive } = (await request.json()) as { isActive?: boolean };
    if (typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive (boolean) is required" }, { status: 400 });
    }

    await connectDB();
    const doc = await PhoneNumber.findByIdAndUpdate(id, { $set: { isActive } }, { new: true }).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ id: doc._id.toString(), number: doc.number, isActive: doc.isActive });
  } catch (error) {
    console.error("[admin/phone-pool PATCH] error:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await connectDB();
    const doc = await PhoneNumber.findById(id).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (doc.channelId) {
      return NextResponse.json(
        { error: "Cannot remove a number that is assigned to a channel" },
        { status: 409 }
      );
    }

    await PhoneNumber.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/phone-pool DELETE] error:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
