import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Stripe from "stripe";
import connectDB from "@/lib/db/connect";
import { Channel, CHANNEL_STATES, type ChannelState, AuditLog, Subscription, User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { applyChannelCloseToStripe } from "@/lib/services/billing";
import type { Types } from "mongoose";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2025-01-27.acacia" as any });
}

/**
 * Super admin: adjust channel operational state (close, view-only, active, trial).
 * Optional `action` field captures the admin's intent for the audit trail
 * (suspend / cancel / reactivate / close / state_change).
 */
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
  if (!id) return NextResponse.json({ error: "Channel id required" }, { status: 400 });

  const body = await request.json();
  const { state, action } = body as { state?: string; action?: string };

  await connectDB();
  const before = await Channel.findById(id).select("state users pictureShareEnabled").lean();
  if (!before) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  // Cancel / Uncancel: do NOT change channel.state. Flip cancel_at_period_end
  // on each member's active Stripe subscription. Channel auto-transitions to
  // view_only via customer.subscription.deleted webhook when the paid period
  // actually ends. Per Craig 2026-05-26 spec.
  if (action === "cancel" || action === "uncancel") {
    const stripe = getStripe();
    const memberIds = (before.users ?? []) as Types.ObjectId[];
    const flipTo = action === "cancel";
    const stripeResults: Array<{ userId: string; subId?: string; ok: boolean; reason?: string }> = [];

    for (const uid of memberIds) {
      const u = await User.findById(uid).select("activeStripeSubscriptionId").lean();
      if (!u?.activeStripeSubscriptionId) {
        stripeResults.push({ userId: uid.toString(), ok: false, reason: "no_active_subscription" });
        continue;
      }
      try {
        const current = await stripe.subscriptions.retrieve(u.activeStripeSubscriptionId);
        if (current.cancel_at_period_end === flipTo) {
          stripeResults.push({ userId: uid.toString(), subId: u.activeStripeSubscriptionId, ok: true, reason: "already_in_target_state" });
        } else {
          await stripe.subscriptions.update(u.activeStripeSubscriptionId, {
            cancel_at_period_end: flipTo,
          });
          stripeResults.push({ userId: uid.toString(), subId: u.activeStripeSubscriptionId, ok: true });
        }
        await Subscription.updateMany(
          { userId: uid, stripeSubscriptionId: u.activeStripeSubscriptionId },
          { $set: { cancelAtPeriodEnd: flipTo } }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "stripe_error";
        console.error("[admin/channels cancel/uncancel] Stripe call failed", {
          channelId: id, userId: uid.toString(), action, error: msg,
        });
        stripeResults.push({ userId: uid.toString(), subId: u.activeStripeSubscriptionId, ok: false, reason: msg });
      }
    }

    await AuditLog.create({
      action: action === "cancel" ? "channel_admin_cancel" : "channel_admin_uncancel",
      channelId: before._id,
      actorUserId: new mongoose.Types.ObjectId(auth.payload.userId),
      metadata: { stripeResults },
    });

    return NextResponse.json({
      id: before._id.toString(),
      state: before.state,
      action,
      stripeResults,
    });
  }

  // Default path: change channel.state directly. Used by suspend/reactivate/close.
  if (!state || !CHANNEL_STATES.includes(state as ChannelState)) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  // Billing-leak guard for reactivate (Craig #73): when the channel reached
  // view_only because the paid period ended (sub was deleted), an admin
  // flipping state back to "active" would make the channel sendable without
  // anyone paying. Refuse unless at least one member still has an active
  // Stripe subscription. The user-side "Restart channel" → /subscription flow
  // is the right path to start a fresh paid month.
  if (
    action === "reactivate" &&
    before.state === "view_only" &&
    (state === "active" || state === "trial")
  ) {
    const memberIds = (before.users ?? []) as Types.ObjectId[];
    const anyActiveSub = await User.exists({
      _id: { $in: memberIds },
      activeStripeSubscriptionId: { $exists: true, $ne: null },
    });
    if (!anyActiveSub) {
      return NextResponse.json(
        {
          error:
            "Cannot reactivate: no active subscription on this channel. The paying user must restart the channel from their portal (Settings → Subscription) to begin a fresh billing cycle.",
        },
        { status: 409 }
      );
    }
  }

  const ch = await Channel.findByIdAndUpdate(id, { $set: { state } }, { new: true }).lean();
  if (!ch) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const allowedActions = new Set(["suspend", "cancel", "reactivate", "close"]);
  const auditAction =
    action && allowedActions.has(action) ? `channel_admin_${action}` : "channel_state_change";

  // Stripe-side cleanup on close: decrement core line-item quantity on each
  // user's Stripe sub (and picture-addon line if the channel had it).
  // Billing module no-ops for users without an active sub. Failures are
  // logged but don't roll back the Mongo state change — admins can retry.
  let stripeCleanup: Array<{ userId: string; result?: unknown; error?: string }> = [];
  if (state === "closed" && before.state !== "closed") {
    const userIds = (before.users ?? []) as Types.ObjectId[];
    for (const uid of userIds) {
      try {
        const result = await applyChannelCloseToStripe(
          uid.toString(),
          ch._id.toString(),
          !!before.pictureShareEnabled
        );
        stripeCleanup.push({ userId: uid.toString(), result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[admin/channels close] Stripe cleanup failed", {
          channelId: ch._id.toString(),
          userId: uid.toString(),
          error: msg,
        });
        stripeCleanup.push({ userId: uid.toString(), error: msg });
      }
    }
  }

  await AuditLog.create({
    action: auditAction,
    channelId: ch._id,
    actorUserId: new mongoose.Types.ObjectId(auth.payload.userId),
    metadata: {
      fromState: before.state,
      toState: ch.state,
      ...(action ? { intent: action } : {}),
      ...(stripeCleanup.length > 0 ? { stripeCleanup } : {}),
    },
  });

  return NextResponse.json({
    id: ch._id.toString(),
    state: ch.state,
    ...(stripeCleanup.length > 0 ? { stripeCleanup } : {}),
  });
}
