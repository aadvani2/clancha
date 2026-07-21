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
 * POST /api/subscription/cancel
 *
 * Body (all optional):
 *   { subscriptionId?: string }  — cancel a single subscription by its MongoDB _id
 *   { cancelAll?: true }         — cancel every active subscription for the user
 *
 * No body / unknown combo → cancel all (backwards-compatible).
 *
 * For a single non-last-channel cancel, this immediately adjusts the Stripe
 * subscription item quantities so the next billing period reflects only the
 * remaining active channels. The channel stays Active locally until
 * currentPeriodEnd; the invoice.paid webhook / cron then move it to view_only.
 * No proration credit is issued (proration_behavior: "none"). Per Craig
 * 2026-06-15 spec: each channel must be individually addressable in Stripe.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    await connectDB();
    const stripe = getStripe();

    const body = await request.json().catch(() => ({})) as {
      subscriptionId?: string;
      cancelAll?: boolean;
    };

    const user = await User.findById(auth.payload.userId).select("_id").lean();
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // ── Single-subscription cancel ─────────────────────────────────────────
    if (body.subscriptionId && !body.cancelAll) {
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
      if (sub.cancelAtPeriodEnd) {
        return NextResponse.json({ error: "Already scheduled for cancellation." }, { status: 400 });
      }

      // Count other active channels sharing the same Stripe subscription.
      // Exclude currently-cancelled ones (cancelAtPeriodEnd: true) since they are
      // already no longer being billed. This count becomes the new Stripe item
      // quantity after this cancel: it represents exactly the channels that will
      // remain billable next cycle.
      const otherActiveCount = await Subscription.countDocuments({
        stripeSubscriptionId: sub.stripeSubscriptionId,
        userId: user._id,
        _id: { $ne: sub._id },
        status: { $in: ["active", "trialing"] },
        cancelAtPeriodEnd: { $ne: true },
      });

      let periodEnd: string | null = sub.currentPeriodEnd
        ? sub.currentPeriodEnd.toISOString()
        : null;

      if (otherActiveCount === 0) {
        // Last active channel — cancel the Stripe subscription itself.
        const cancelled = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
        periodEnd =
          typeof (cancelled as any).current_period_end === "number"
            ? new Date((cancelled as any).current_period_end * 1000).toISOString()
            : periodEnd;
      } else {
        // Non-last channel: adjust Stripe item quantities so next billing period
        // reflects only the remaining active channels. proration_behavior "none"
        // means no credit/charge today — the cancelled channel keeps access this
        // period, and Stripe won't bill for it next cycle.
        //
        // We use the count-based approach (setting quantity = otherActiveCount)
        // rather than a blind decrement — this self-reconciles any previously
        // out-of-sync quantities from the old local-only cancel path.
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
        const corePriceId = process.env.STRIPE_PRICE_CORE;
        const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON;
        const coreItem = corePriceId
          ? stripeSub.items.data.find((item) => item.price.id === corePriceId)
          : null;
        const addonItem = addonPriceId
          ? stripeSub.items.data.find((item) => item.price.id === addonPriceId)
          : null;

        const stripeItems: Stripe.SubscriptionUpdateParams.Item[] = [];

        if (coreItem) {
          // Set quantity to the number of channels that will remain active after
          // this cancel. Minimum 1 to avoid accidentally deleting the line item
          // (the last-channel path above handles the true-zero case).
          stripeItems.push({ id: coreItem.id, quantity: Math.max(1, otherActiveCount) });
        }

        // Adjust the picture-sharing addon item if this channel had it bundled.
        if (addonItem && sub.plan === "picture_addon") {
          const addonCountAfterCancel = await Subscription.countDocuments({
            stripeSubscriptionId: sub.stripeSubscriptionId,
            userId: user._id,
            plan: "picture_addon",
            status: { $in: ["active", "trialing"] },
            cancelAtPeriodEnd: { $ne: true },
            _id: { $ne: sub._id },
          });
          if (addonCountAfterCancel <= 0) {
            stripeItems.push({ id: addonItem.id, deleted: true });
          } else {
            stripeItems.push({ id: addonItem.id, quantity: addonCountAfterCancel });
          }
        }

        if (stripeItems.length > 0) {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, {
            items: stripeItems,
            proration_behavior: "none",
          });
        }
      }

      await Subscription.updateOne(
        { _id: sub._id },
        { $set: { cancelAtPeriodEnd: true } }
      );

      return NextResponse.json({
        success: true,
        message: "This channel will move to view-only at the end of the current billing period. You can undo this any time before then.",
        periodEnd,
        cancelAtPeriodEnd: true,
        subscriptionId: body.subscriptionId,
      });
    }

    // ── Cancel-all ────────────────────────────────────────────────────────
    const activeSubs = await Subscription.find({
      userId: user._id,
      status: { $in: ["active", "trialing"] },
      cancelAtPeriodEnd: { $ne: true },
      stripeSubscriptionId: { $ne: null },
    });

    if (activeSubs.length === 0) {
      return NextResponse.json({ error: "No active subscriptions to cancel." }, { status: 400 });
    }

    let latestPeriodEnd: string | null = null;
    for (const sub of activeSubs) {
      const cancelled = await stripe.subscriptions.update(sub.stripeSubscriptionId!, {
        cancel_at_period_end: true,
      });
      await Subscription.updateOne({ _id: sub._id }, { $set: { cancelAtPeriodEnd: true } });
      const pe =
        typeof (cancelled as any).current_period_end === "number"
          ? new Date((cancelled as any).current_period_end * 1000).toISOString()
          : null;
      if (pe && (!latestPeriodEnd || pe > latestPeriodEnd)) latestPeriodEnd = pe;
    }

    return NextResponse.json({
      success: true,
      message: `All ${activeSubs.length} subscription${activeSubs.length > 1 ? "s" : ""} will end at the close of the current billing period. You can undo this any time before then.`,
      periodEnd: latestPeriodEnd,
      cancelAtPeriodEnd: true,
      cancelledCount: activeSubs.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to cancel subscription";
    console.error("[subscription/cancel] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
