import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User } from "@/lib/db/models";
import { getTokenFromCookie } from "@/lib/auth/getToken";
import { verifyToken } from "@/lib/auth/jwt";

export async function PATCH(request: NextRequest) {
  try {
    const token = await getTokenFromCookie();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const body = await request.json();
    const { email, name, profileImageUrl, receivingHoursStart, receivingHoursEnd, timezone } = body;

    await connectDB();

    const updates: { 
      email?: string; 
      name?: string; 
      profileImageUrl?: string; 
      receivingHoursStart?: string | null; 
      receivingHoursEnd?: string | null; 
      timezone?: string 
    } = {};
    if (typeof email === "string" && email.trim()) {
      const emailTrimmed = email.trim().toLowerCase();
      const existing = await User.findOne({ email: emailTrimmed });
      if (existing && existing._id.toString() !== payload.userId) {
        return NextResponse.json(
          { error: "This email is already in use" },
          { status: 400 }
        );
      }
      updates.email = emailTrimmed;
    }
    if (typeof name === "string") {
      updates.name = name.trim() || undefined;
    }
    if (typeof profileImageUrl === "string") {
      updates.profileImageUrl = profileImageUrl.trim() || undefined;
    }
    if (receivingHoursStart !== undefined) {
      updates.receivingHoursStart = receivingHoursStart;
    }
    if (receivingHoursEnd !== undefined) {
      updates.receivingHoursEnd = receivingHoursEnd;
    }
    if (typeof timezone === "string") {
      updates.timezone = timezone.trim() || undefined;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }
    const user = await User.findByIdAndUpdate(
      payload.userId,
      { $set: updates },
      { new: true }
    )
      .select("-__v")
      .lean();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: user._id.toString(),
      phone: user.phone,
      ...(user.email != null && { email: user.email }),
      role: user.role,
      name: user.name ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
      stripeCustomerId: user.stripeCustomerId ?? null,
      receivingHoursStart: user.receivingHoursStart ?? null,
      receivingHoursEnd: user.receivingHoursEnd ?? null,
      timezone: user.timezone ?? null,
    });
  } catch (error) {
    console.error("users/update-profile error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
