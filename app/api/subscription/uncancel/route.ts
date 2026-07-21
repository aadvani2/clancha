import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import connectDB from "@/lib/db/connect";
import { Subscription, User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2025-01-27.acacia" as any });
}

/**
 * POST /api/subscription/uncancel
 *
 * Body (optional):
 *   { subscriptionId?: string }  — undo cancellation for a specific sub (MongoDB _id)
 *
 * No subscriptionId → undo all pending cancellations for the user.
 *
 * For a single per-channel undo: re-increments the Stripe subscription item
 * quantities to restore this channel's billing for the next period. Uses
 * proration_behavior "none" — no charge today, billing resumes next cycle.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    await connectDB();
    const stripe = getStripe();

    const body = await request.json().catch(() => ({})) as { subscriptionId?: string };

    const user = await User.findById(auth.payload.userId).select("_id").lean();
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // ── Single-subscription uncancel ──────────────────────────────────────
    if (body.subscriptionId) {
      const sub = await Subscription.findOne({
        _id: body.subscriptionId,
        userId: user._id,
      });
      if (!sub) {
        return NextResponse.json({ error: "Subscription not found." }, { status: 404 });
      }
      if (!sub.stripeSubscriptionId) {
        return NextResponse.json({ error: "No Stripe subscription linked." }, { status: 400 });
      }
      if (!sub.cancelAtPeriodEnd) {
        return NextResponse.json({ error: "Subscription is not pending cancellation." }, { status: 400 });
      }

      // Clear the local cancellation flag first so the upcoming count queries
      // include this channel in the "active" set.
      await Subscription.updateOne({ _id: sub._id }, { $set: { cancelAtPeriodEnd: false } });

      const stripeState = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

      if (stripeState.cancel_at_period_end) {
        // The entire Stripe subscription was marked for cancellation (this was
        // the last active channel when it was cancelled). Only clear the Stripe
        // flag if no other channels are still locally pending cancellation.
        const otherLocallyCancelled = await Subscription.countDocuments({
          stripeSubscriptionId: sub.stripeSubscriptionId,
          _id: { $ne: sub._id },
          cancelAtPeriodEnd: true,
        });
        if (otherLocallyCancelled === 0) {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: false });
        }
      } else {
        // Per-channel cancel — the Stripe subscription item quantities were
        // decremented when this channel was cancelled. Re-increment them now.
        // Using count-based reconciliation: set quantity = total active count
        // (now including the just-uncancelled channel), so any prior drift is
        // fixed in the same operation.
        const newActiveCount = await Subscription.countDocuments({
          stripeSubscriptionId: sub.stripeSubscriptionId,
          userId: user._id,
          status: { $in: ["active", "trialing"] },
          cancelAtPeriodEnd: { $ne: true },
        });
        const newAddonCount = await Subscription.countDocuments({
          stripeSubscriptionId: sub.stripeSubscriptionId,
          userId: user._id,
          plan: "picture_addon",
          status: { $in: ["active", "trialing"] },
          cancelAtPeriodEnd: { $ne: true },
        });

        const corePriceId = process.env.STRIPE_PRICE_CORE;
        const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON;
        const coreItem = corePriceId
          ? stripeState.items.data.find((item) => item.price.id === corePriceId)
          : null;
        const addonItem = addonPriceId
          ? stripeState.items.data.find((item) => item.price.id === addonPriceId)
          : null;

        const stripeItems: Stripe.SubscriptionUpdateParams.Item[] = [];

        if (coreItem && newActiveCount > 0) {
          stripeItems.push({ id: coreItem.id, quantity: newActiveCount });
        }

        // Restore the addon item if this channel had bundled picture sharing.
        if (sub.plan === "picture_addon") {
          if (addonItem) {
            // Item already exists — update the quantity.
            stripeItems.push({ id: addonItem.id, quantity: Math.max(1, newAddonCount) });
          } else if (addonPriceId) {
            // Item was deleted when quantity hit 0 on cancel — re-add it.
            stripeItems.push({ price: addonPriceId, quantity: Math.max(1, newAddonCount) });
          }
        }

        if (stripeItems.length > 0) {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, {
            items: stripeItems,
            proration_behavior: "none",
          });
        }
      }

      return NextResponse.json({
        success: true,
        message: "Cancellation undone. This channel will continue normally.",
        cancelAtPeriodEnd: false,
        subscriptionId: body.subscriptionId,
      });
    }

    // ── Undo-all ──────────────────────────────────────────────────────────
    const pendingSubs = await Subscription.find({
      userId: user._id,
      cancelAtPeriodEnd: true,
      stripeSubscriptionId: { $ne: null },
    });

    if (pendingSubs.length === 0) {
      return NextResponse.json({ error: "No pending cancellations to undo." }, { status: 400 });
    }

    for (const sub of pendingSubs) {
      try {
        await stripe.subscriptions.update(sub.stripeSubscriptionId!, { cancel_at_period_end: false });
        await Subscription.updateOne({ _id: sub._id }, { $set: { cancelAtPeriodEnd: false } });
      } catch (err) {
        console.error("[subscription/uncancel] failed for sub", sub._id, err);
      }
    }

    // Reconcile Stripe item quantities for the shared subscription after bulk undo.
    const stripeSubIds = [...new Set(pendingSubs.map((s) => s.stripeSubscriptionId).filter(Boolean) as string[])];
    for (const stripeSubId of stripeSubIds) {
      try {
        const newActiveCount = await Subscription.countDocuments({
          stripeSubscriptionId: stripeSubId,
          userId: user._id,
          status: { $in: ["active", "trialing"] },
          cancelAtPeriodEnd: { $ne: true },
        });
        const newAddonCount = await Subscription.countDocuments({
          stripeSubscriptionId: stripeSubId,
          userId: user._id,
          plan: "picture_addon",
          status: { $in: ["active", "trialing"] },
          cancelAtPeriodEnd: { $ne: true },
        });
        const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
        const corePriceId = process.env.STRIPE_PRICE_CORE;
        const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON;
        const coreItem = corePriceId
          ? stripeSub.items.data.find((item) => item.price.id === corePriceId)
          : null;
        const addonItem = addonPriceId
          ? stripeSub.items.data.find((item) => item.price.id === addonPriceId)
          : null;
        const stripeItems: Stripe.SubscriptionUpdateParams.Item[] = [];
        if (coreItem && newActiveCount > 0) {
          stripeItems.push({ id: coreItem.id, quantity: newActiveCount });
        }
        if (addonItem && newAddonCount > 0) {
          stripeItems.push({ id: addonItem.id, quantity: newAddonCount });
        }
        if (stripeItems.length > 0) {
          await stripe.subscriptions.update(stripeSubId, {
            items: stripeItems,
            proration_behavior: "none",
          });
        }
      } catch (err) {
        console.error("[subscription/uncancel] bulk quantity reconcile failed", stripeSubId, err);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Cancellation undone. Your subscriptions will continue normally.",
      cancelAtPeriodEnd: false,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to undo cancellation";
    console.error("[subscription/uncancel] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
