import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/db/connect";
import { User, AuditLog } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { sendSmsWithRetry } from "@/lib/services/twilio";
import { getPortalBaseUrl } from "@/lib/messaging/appendixA";

const MIN_PASSWORD_LEN = 8;

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  if (payload.role !== "admin" && payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "10", 10);
  const skip = (page - 1) * limit;

  try {
    await connectDB();
    const query = { role: "moderator" };
    
    const [moderators, total] = await Promise.all([
      User.find(query)
        .select("_id phone email name role createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    const items = moderators.map((u: any) => ({
      id: u._id.toString(),
      phone: u.phone,
      ...(u.email != null && { email: u.email }),
      name: u.name ?? "-",
      role: u.role,
      createdAt: u.createdAt,
    }));

    return NextResponse.json({
      data: items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("admin/moderators GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch moderators" },
      { status: 500 }
    );
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").trim();
}

/**
 * Create a new moderator. Admin/super_admin only.
 *
 * Per spec (clarified 2026-05-19): moderator authentication is email +
 * password, same as admin / super_admin. The admin creating the moderator
 * supplies the initial password; the new moderator logs in at /admin/login.
 * The welcome SMS confirms the account and links to the login page — it does
 * NOT contain the password (admins must communicate that out-of-band).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  if (payload.role !== "admin" && payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { name, phone, email, password } = body;

    if (!name || !phone || !email || !password) {
      return NextResponse.json(
        { error: "name, phone, email, and password are required" },
        { status: 400 }
      );
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
      return NextResponse.json(
        { error: `password must be at least ${MIN_PASSWORD_LEN} characters` },
        { status: 400 }
      );
    }

    await connectDB();

    const normalizedPhone = `+${normalizePhone(phone)}`;
    const normalizedEmail = email.toLowerCase();

    const existingPhone = await User.findOne({ phone: normalizedPhone });
    if (existingPhone) {
      return NextResponse.json(
        { error: "A user with this phone number already exists" },
        { status: 400 }
      );
    }
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = new User({
      name: name.trim(),
      phone: normalizedPhone,
      email: normalizedEmail,
      role: "moderator",
      password: passwordHash,
    });

    await user.save();

    await AuditLog.create({
      action: "moderator_created",
      actorUserId: payload.userId,
      targetUserId: user._id,
      metadata: {
        email: normalizedEmail,
        name: name.trim(),
        phone: normalizedPhone,
      },
    }).catch(() => {});

    // Welcome SMS confirms the account exists and links to the admin login.
    // The password is NOT sent over SMS — the admin who created the account
    // is responsible for communicating it securely.
    const welcomeBody = `Clancha: You've been added as a moderator. Log in at ${getPortalBaseUrl()}/admin/login with your email and the password your admin shared with you.`;
    try {
      await sendSmsWithRetry(normalizedPhone, welcomeBody);
    } catch (smsErr) {
      console.warn("[admin/moderators POST] welcome SMS failed but moderator was created", smsErr);
    }

    return NextResponse.json({
      id: user._id.toString(),
      phone: user.phone,
      ...(user.email != null && { email: user.email }),
      name: user.name ?? null,
      role: user.role,
    });
  } catch (error) {
    console.error("admin/moderators POST error:", error);
    return NextResponse.json(
      { error: "Failed to add moderator" },
      { status: 500 }
    );
  }
}

