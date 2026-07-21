import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User } from "@/lib/db/models/user";
import { AuditLog, ChannelViewer } from "@/lib/db/models";
import bcrypt from "bcryptjs";
import { signToken } from "@/lib/auth/jwt";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Normalise before DB lookup so mixed-case submissions always match the
    // lowercase-stored address written at invite-acceptance / account creation.
    const normalizedEmail = typeof email === "string" ? email.toLowerCase().trim() : "";
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user || !user.password) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Per spec (clarified 2026-05-19 / extended 2026-05-22): admin,
    // super_admin, moderator, and viewer accounts use email +
    // password. Regular users use the OTP flow and are rejected here.
    if (
      user.role !== "super_admin" &&
      user.role !== "admin" &&
      user.role !== "moderator" &&
      user.role !== "viewer"
    ) {
      return NextResponse.json(
        { error: "Access denied. Use the OTP login flow." },
        { status: 403 }
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Audit failed login attempts so a brute-force / password-spray pattern
      // shows up in the activity feed.
      await AuditLog.create({
        action: "admin_password_login_failed",
        actorUserId: user._id,
        metadata: {
          email,
          role: user.role,
          reason: "bad_password",
        },
        ipAddress: request.headers.get("x-forwarded-for") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      }).catch(() => {});
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    if ((user as { suspended?: boolean }).suspended) {
      return NextResponse.json(
        { error: "This account has been suspended. Contact support if you need help." },
        { status: 403 }
      );
    }

    // Viewers must have at least one active ChannelViewer record to log in.
    // If all access has been revoked by the inviting parents, their account is
    // effectively inactive — block login so they cannot reach the portal.
    if (user.role === "viewer") {
      const hasActiveAccess = await ChannelViewer.exists({
        userId: user._id,
        status: "active",
      });
      if (!hasActiveAccess) {
        return NextResponse.json(
          { error: "Your viewer access has been revoked. Please contact the channel owner." },
          { status: 403 }
        );
      }
    }

    const token = signToken({
      userId: String(user._id),
      phone: user.phone,
      role: user.role,
    });

    // Audit successful logins so admin/moderator activity is auditable.
    await AuditLog.create({
      action: "admin_password_login",
      actorUserId: user._id,
      metadata: {
        email: user.email,
        role: user.role,
      },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(() => {});

    const response = NextResponse.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        name: user.name,
      },
      token,
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("Password login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
