import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuth } from "@/lib/auth/requireAuth";
import connectDB from "@/lib/db/connect";
import { User, PendingChannelRequest } from "@/lib/db/models";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2025-01-27.acacia" as any });
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/**
 * Create a Stripe Checkout Session.
 *
 * Two scenarios per Stripe Developer Handover (Doc 3):
 *
 *   - "signup"      → mode: "subscription". First channel for a new user;
 *                     Checkout collects the card and creates the customer +
 *                     subscription. Webhooks (invoice.paid →
 *                     createFirstChannelForUser) provision the channel.
 *
 *   - "add_channel" → mode: "setup". Existing customer adding a 2nd+ channel
 *                     who has no default payment method on file. Checkout
 *                     collects a card; the `checkout.session.completed`
 *                     webhook attaches it as default PM and then bumps the
 *                     subscription quantity — that invoice auto-pays and
 *                     invoice.paid creates the channel from the pending
 *                     request. Avoids the 5-minute "Payment Processing" hang
 *                     where the old flow tried to bump quantity without a PM.
 *
 * No client-side Stripe Elements anywhere — server-side Stripe Checkout only,
 * per the handover doc.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    const body = await req.json();
    const { scenario, pictureAddon, otherUserPhone, pictureShareEnabled } = body as {
      scenario: "signup" | "add_channel";
      pictureAddon?: boolean;
      otherUserPhone?: string;
      pictureShareEnabled?: boolean;
    };

    if (scenario !== "signup" && scenario !== "add_channel") {
      return NextResponse.json({ error: "Invalid scenario" }, { status: 400 });
    }

    await connectDB();
    const user = await User.findById(payload.userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const stripe = getStripe();
    const corePriceId = process.env.STRIPE_PRICE_CORE;
    const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON;
    if (!corePriceId) throw new Error("STRIPE_PRICE_CORE is not set");

    // Ensure the user has a Stripe customer. We may not have created one yet
    // (signup happens before any Stripe contact in the password-only flow).
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customerName =
        user.name?.trim() ||
        (typeof user.email === "string" && user.email.includes("@")
          ? user.email.split("@")[0]
          : "Clancha User");
      const created = await stripe.customers.create({
        email: user.email || undefined,
        name: customerName,
        metadata: { userId: user._id.toString() },
      });
      customerId = created.id;
      await User.updateOne(
        { _id: user._id },
        { $set: { stripeCustomerId: customerId } }
      );
    }

    if (scenario === "signup") {
      const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        { price: corePriceId, quantity: 1 },
      ];
      if (pictureAddon) {
        if (!addonPriceId) throw new Error("STRIPE_PRICE_PICTURE_ADDON is not set");
        line_items.push({ price: addonPriceId, quantity: 1 });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items,
        success_url: `${appUrl()}/dashboard?welcome=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl()}/subscription`,
        subscription_data: {
          metadata: {
            userId: user._id.toString(),
            scenario: "signup",
            pictureAddon: pictureAddon ? "1" : "0",
          },
        },
        metadata: {
          userId: user._id.toString(),
          scenario: "signup",
          pictureAddon: pictureAddon ? "1" : "0",
        },
        allow_promotion_codes: false,
      });

      return NextResponse.json({ url: session.url });
    }

    // scenario === "add_channel"
    if (!user.activeStripeSubscriptionId) {
      return NextResponse.json(
        { error: "No active subscription. Complete signup checkout first." },
        { status: 402 }
      );
    }
    if (!otherUserPhone || typeof otherUserPhone !== "string") {
      return NextResponse.json(
        { error: "otherUserPhone is required for add_channel scenario" },
        { status: 400 }
      );
    }

    // Self-loop guard — same reason as /api/setup/first-channel: without
    // this the webhook silently no-ops on the materialise step.
    const ownDigits = (user.phone ?? "").replace(/\D/g, "");
    const otherDigits = otherUserPhone.replace(/\D/g, "");
    if (ownDigits && otherDigits && ownDigits === otherDigits) {
      return NextResponse.json(
        { error: "Recipient phone can't be your own number." },
        { status: 400 }
      );
    }

    // Park the channel intent so the webhook can complete it after PM
    // collection. We create it here (not by reusing an old pending) so the
    // webhook's pending-channel pipeline picks it up via createdAt ordering.
    const pending = await PendingChannelRequest.create({
      userId: user._id,
      otherUserPhone: otherUserPhone.trim(),
      pictureShareEnabled: !!pictureShareEnabled,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      success_url: `${appUrl()}/dashboard?channel_pending=1`,
      cancel_url: `${appUrl()}/dashboard`,
      metadata: {
        userId: user._id.toString(),
        scenario: "add_channel",
        pendingChannelRequestId: pending._id.toString(),
        pictureShareEnabled: pictureShareEnabled ? "1" : "0",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("[create-session] error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
