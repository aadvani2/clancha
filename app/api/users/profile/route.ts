import { NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    await connectDB();
    const user = await User.findById(payload.userId)
      .select("-__v -stripeCustomerId -activeStripeSubscriptionId")
      .lean();
    
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: user._id.toString(),
      phone: user.phone,
      email: user.email ?? null,
      name: user.name ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
      role: user.role,
      receivingHoursStart: (user as any).receivingHoursStart ?? null,
      receivingHoursEnd: (user as any).receivingHoursEnd ?? null,
      timezone: (user as any).timezone ?? "Europe/London",
      isPictureAddonEnabled: !!user.isPictureAddonEnabled,
    });
  } catch (error) {
    console.error("users/profile GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile details" },
      { status: 500 }
    );
  }
}
