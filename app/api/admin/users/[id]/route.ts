import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import {
  deleteUserCascade,
  NotTestEnvironmentError,
} from "@/lib/services/testReset";

/**
 * Super admin: view and adjust user account fields (receiving hours, suspension).
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
  if (!id) return NextResponse.json({ error: "User id required" }, { status: 400 });

  await connectDB();
  const user = await User.findById(id)
    .select(
      "_id phone email name role suspended receivingHoursStart receivingHoursEnd timezone isPictureAddonEnabled activeStripeSubscriptionId stripeCustomerId"
    )
    .lean();
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({
    id: user._id.toString(),
    phone: user.phone,
    email: user.email ?? null,
    name: user.name ?? null,
    role: user.role,
    suspended: !!(user as { suspended?: boolean }).suspended,
    receivingHoursStart: (user as { receivingHoursStart?: string | null }).receivingHoursStart ?? null,
    receivingHoursEnd: (user as { receivingHoursEnd?: string | null }).receivingHoursEnd ?? null,
    timezone: (user as { timezone?: string | null }).timezone ?? "Europe/London",
    isPictureAddonEnabled: !!user.isPictureAddonEnabled,
    hasActiveSubscription: !!user.activeStripeSubscriptionId,
    stripeCustomerId: user.stripeCustomerId ?? null,
  });
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
  if (!id) return NextResponse.json({ error: "User id required" }, { status: 400 });

  const body = await request.json();
  const { receivingHoursStart, receivingHoursEnd, timezone, suspended, name, email } = body;

  await connectDB();
  const updates: Record<string, unknown> = {};
  if (receivingHoursStart !== undefined) updates.receivingHoursStart = receivingHoursStart;
  if (receivingHoursEnd !== undefined) updates.receivingHoursEnd = receivingHoursEnd;
  if (typeof timezone === "string") updates.timezone = timezone.trim();
  if (typeof suspended === "boolean") updates.suspended = suspended;
  if (typeof name === "string") updates.name = name.trim() || null;
  if (typeof email === "string" && email.trim()) {
    const e = email.trim().toLowerCase();
    const taken = await User.findOne({ email: e });
    if (taken && taken._id.toString() !== id) {
      return NextResponse.json({ error: "Email already in use" }, { status: 400 });
    }
    updates.email = e;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  const user = await User.findByIdAndUpdate(id, { $set: updates }, { new: true })
    .select(
      "_id phone email name role suspended receivingHoursStart receivingHoursEnd timezone isPictureAddonEnabled activeStripeSubscriptionId"
    )
    .lean();

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({
    id: user._id.toString(),
    phone: user.phone,
    email: user.email ?? null,
    name: user.name ?? null,
    role: user.role,
    suspended: !!(user as { suspended?: boolean }).suspended,
    receivingHoursStart: (user as { receivingHoursStart?: string | null }).receivingHoursStart ?? null,
    receivingHoursEnd: (user as { receivingHoursEnd?: string | null }).receivingHoursEnd ?? null,
    timezone: (user as { timezone?: string | null }).timezone ?? "Europe/London",
    isPictureAddonEnabled: !!user.isPictureAddonEnabled,
    hasActiveSubscription: !!user.activeStripeSubscriptionId,
  });
}

/**
 * Super admin, TEST ENVIRONMENT ONLY: hard-delete a test user and everything
 * tied to them, freeing their phone for a fresh sign-up and releasing any pool
 * numbers their channels used (M4 #95). Disabled outside a Stripe test account;
 * refuses staff accounts and self-deletion.
 */
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
  if (!id) return NextResponse.json({ error: "User id required" }, { status: 400 });
  if (id === auth.payload.userId) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  try {
    const summary = await deleteUserCascade(id, { actorUserId: auth.payload.userId });
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof NotTestEnvironmentError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : "Delete failed";
    const status = /not found/i.test(msg) ? 404 : /Refusing/i.test(msg) ? 400 : 500;
    if (status === 500) console.error("admin/users [id] DELETE error:", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
