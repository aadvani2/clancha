import { NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User } from "@/lib/db/models";
import { getTokenFromCookie } from "@/lib/auth/getToken";
import { verifyToken } from "@/lib/auth/jwt";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia" as any,
});

export async function GET() {
  try {
    const token = await getTokenFromCookie();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    await connectDB();
    const user = await User.findById(payload.userId).select("-__v").lean();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if ((user as { suspended?: boolean }).suspended) {
      return NextResponse.json(
        { error: "Account suspended", suspended: true },
        { status: 403 }
      );
    }

    let isSubscribed = !!user.activeStripeSubscriptionId;
    let subscriptionQuantity = 0;

    if (user.activeStripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.activeStripeSubscriptionId);

        if (sub.status === "active" || sub.status === "trialing") {
          isSubscribed = true;
          // Get the quantity of the main core item
          const corePriceId = process.env.STRIPE_PRICE_CORE;
          const coreItem = sub.items.data.find((item: any) => item.price.id === corePriceId);
          subscriptionQuantity = coreItem?.quantity || 0;
        } else {
          isSubscribed = false;
        }
      } catch (err) {
        console.error("Stripe fetch error in /me:", err);
      }
    }

    return NextResponse.json({
      id: user._id.toString(),
      phone: user.phone,
      ...(user.email != null && { email: user.email }),
      role: user.role,
      name: user.name ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
      stripeCustomerId: user.stripeCustomerId ?? null,
      isSubscribed: isSubscribed,
      subscriptionQuantity: subscriptionQuantity,
      isPictureAddonEnabled: !!user.isPictureAddonEnabled,
      receivingHoursStart: (user as any).receivingHoursStart ?? null,
      receivingHoursEnd: (user as any).receivingHoursEnd ?? null,
      timezone: (user as any).timezone ?? "Europe/London",
    });
  } catch (error) {
    console.error("users/me error:", error);
    return NextResponse.json(
      { error: "Failed to fetch user" },
      { status: 500 }
    );
  }
}
