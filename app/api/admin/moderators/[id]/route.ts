import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/db/connect";
import { User, AuditLog } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

const MIN_PASSWORD_LEN = 8;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;
  if (payload.role !== "admin" && payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Moderator ID required" }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { name, email, password } = body;

    await connectDB();

    const user = await User.findById(id);
    if (!user) {
      return NextResponse.json({ error: "Moderator not found" }, { status: 404 });
    }
    if (user.role !== "moderator") {
      return NextResponse.json(
        { error: "User is not a moderator" },
        { status: 400 }
      );
    }

    const updates: { name?: string; email?: string; password?: string } = {};
    if (typeof name === "string") {
      updates.name = name.trim() || undefined;
    }
    if (typeof email === "string" && email.trim()) {
      const emailTrimmed = email.trim().toLowerCase();
      const existing = await User.findOne({ email: emailTrimmed });
      if (existing && existing._id.toString() !== id) {
        return NextResponse.json(
          { error: "This email is already in use" },
          { status: 400 }
        );
      }
      updates.email = emailTrimmed;
    }
    if (typeof password === "string" && password.length > 0) {
      if (password.length < MIN_PASSWORD_LEN) {
        return NextResponse.json(
          { error: `password must be at least ${MIN_PASSWORD_LEN} characters` },
          { status: 400 }
        );
      }
      updates.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true }
    )
      .select("_id phone email name role createdAt")
      .lean();

    await AuditLog.create({
      action: "moderator_updated",
      actorUserId: payload.userId,
      targetUserId: id,
      metadata: {
        fieldsChanged: Object.keys(updates).filter((k) => k !== "password"),
        passwordReset: Object.prototype.hasOwnProperty.call(updates, "password"),
      },
    }).catch(() => {});

    return NextResponse.json({
      id: updated!._id.toString(),
      phone: updated!.phone,
      ...(updated!.email != null && { email: updated!.email }),
      name: updated!.name ?? null,
      role: updated!.role,
      createdAt: updated!.createdAt,
    });
  } catch (error) {
    console.error("admin/moderators PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update moderator" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;
  if (payload.role !== "admin" && payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Moderator ID required" }, { status: 400 });
  }

  try {
    await connectDB();

    const user = await User.findById(id);
    if (!user) {
      return NextResponse.json({ error: "Moderator not found" }, { status: 404 });
    }
    if (user.role !== "moderator") {
      return NextResponse.json(
        { error: "User is not a moderator" },
        { status: 400 }
      );
    }
    if (user._id.toString() === auth.payload.userId) {
      return NextResponse.json(
        { error: "You cannot remove your own moderator role" },
        { status: 400 }
      );
    }

    user.role = "user";
    await user.save();

    await AuditLog.create({
      action: "moderator_removed",
      actorUserId: payload.userId,
      targetUserId: id,
      metadata: {
        email: user.email,
        phone: user.phone,
      },
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("admin/moderators DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to remove moderator" },
      { status: 500 }
    );
  }
}
