import { NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Subscription } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * GET /api/subscription/status
 * Returns whether the current user has an active subscription (created by webhook after payment).
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    await connectDB();
    const subs = await Subscription.find({
      userId: auth.payload.userId,
      status: "active",
    })
      .sort({ currentPeriodEnd: -1 })
      .lean();

    // Any active sub with cancelAtPeriodEnd=true means the user is in the
    // cancellation grace window — channel still usable until currentPeriodEnd.
    const cancelling = subs.find((s) => s.cancelAtPeriodEnd === true);
    return NextResponse.json({
      hasActiveSubscription: subs.length > 0,
      cancelAtPeriodEnd: !!cancelling,
      periodEnd: cancelling?.currentPeriodEnd
        ? cancelling.currentPeriodEnd.toISOString()
        : subs[0]?.currentPeriodEnd?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("subscription/status error:", error);
    return NextResponse.json(
      { error: "Failed to check subscription status" },
      { status: 500 }
    );
  }
}
