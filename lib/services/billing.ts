import Stripe from "stripe";
import connectDB from "@/lib/db/connect";
import { User, Channel, Subscription } from "@/lib/db/models";
import mongoose from "mongoose";
import type { Types } from "mongoose";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-01-27.acacia" as any,
});

/**
 * Create a trial Subscription for a channel (e.g. invite-created) and link both ways.
 * Call within a transaction after creating the channel.
 */
export async function createTrialSubscriptionForChannel(
  session: mongoose.mongo.ClientSession,
  userId: Types.ObjectId,
  channelId: Types.ObjectId
): Promise<Types.ObjectId> {
  const currentPeriodEnd = new Date();
  currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 30);
  const created = await Subscription.create(
    [
      {
        userId,
        channelId,
        stripeSubscriptionId: undefined,
        plan: "core",
        status: "trialing",
        currentPeriodEnd,
      },
    ],
    { session }
  );
  const subId = created[0]._id as Types.ObjectId;
  await Channel.updateOne(
    { _id: channelId },
    { $set: { subscriptionId: subId } },
    { session }
  );
  return subId;
}

/**
 * Create a Subscription document for a channel and link both ways.
 * Call within a transaction after creating the channel.
 * stripeSubscriptionId is the user's active Stripe subscription (shared across their channels).
 */
export async function createSubscriptionForChannel(
  session: mongoose.mongo.ClientSession,
  userId: Types.ObjectId,
  channelId: Types.ObjectId,
  stripeSubscriptionId: string,
  plan: "core" | "picture_addon",
  currentPeriodEnd: Date
): Promise<Types.ObjectId> {
  const created = await Subscription.create(
    [
      {
        userId,
        channelId,
        stripeSubscriptionId,
        plan,
        status: "active",
        currentPeriodEnd,
      },
    ],
    { session }
  );
  const subId = created[0]._id as Types.ObjectId;
  await Channel.updateOne(
    { _id: channelId },
    { $set: { subscriptionId: subId } },
    { session }
  );
  return subId;
}

/**
 * Handles billing for creating a NEW channel.
 * If it's the user's first channel, it will be handled by the initial checkout.
 * This function is for subsequent channels created from the dashboard.
 */
export async function updateSubscriptionForNewChannel(userId: string, pictureShareEnabled: boolean) {
    await connectDB();
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    if (!user.activeStripeSubscriptionId) {
        throw new Error("No active subscription found. Please subscribe first.");
    }

    // How many channels does the user ALREADY have?
    const currentChannelCount = await Channel.countDocuments({
        users: user._id,
        state: { $in: ["active", "trial"] }
    });

    const subscription = await stripe.subscriptions.retrieve(user.activeStripeSubscriptionId);

    const corePriceId = process.env.STRIPE_PRICE_CORE!;
    const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON!;

    // Find existing items for these prices
    const coreItem = subscription.items.data.find(item => item.price.id === corePriceId);
    const addonItem = subscription.items.data.find(item => item.price.id === addonPriceId);

    const items: Stripe.SubscriptionUpdateParams.Item[] = [];
    let needsUpdate = false;

    // 1. Core Logic: Need (currentChannelCount + 1) quantities
    const coreQuantityNeeded = currentChannelCount + 1;
    const currentCoreQuantity = coreItem?.quantity || 0;

    if (coreQuantityNeeded > currentCoreQuantity) {
        needsUpdate = true;
        items.push({
            id: coreItem?.id,
            price: coreItem ? undefined : corePriceId,
            quantity: coreQuantityNeeded,
        });
    }

    // 2. Addon Logic — picture sharing is per-channel per spec.
    //    Bump addon quantity by one if the new channel has it enabled.
    if (pictureShareEnabled) {
        const channelsWithPictures = await Channel.countDocuments({
            users: user._id,
            state: { $in: ["active", "trial"] },
            pictureShareEnabled: true,
        });

        const addonQuantityNeeded = channelsWithPictures + 1;
        const currentAddonQuantity = addonItem?.quantity || 0;

        if (addonQuantityNeeded > currentAddonQuantity) {
            needsUpdate = true;
            items.push({
                id: addonItem?.id,
                price: addonItem ? undefined : addonPriceId,
                quantity: addonQuantityNeeded,
            });
        }
    }

    if (!needsUpdate) {
        console.log(`[Billing] No update needed for user ${userId}. New channel covered by existing subscription.`);
        return;
    }

    // Update subscription with proration to keep single billing date
    await stripe.subscriptions.update(user.activeStripeSubscriptionId, {
        items,
        proration_behavior: "always_invoice", // Charge immediately for the new channel
    });
}

/**
 * If the user's active subscription has an open (unpaid) invoice, return its
 * Stripe hosted URL so the client can redirect the user to re-enter card
 * details and pay it. Used to short-circuit POST /api/channels when a previous
 * proration attempt left a dangling unpaid invoice — re-running the create
 * flow would only bump sub quantity again and create a second failing invoice.
 */
export async function getOpenInvoiceForSubscription(
  stripeSubscriptionId: string
): Promise<{ id: string; hostedInvoiceUrl: string | null; amountDue: number; currency: string } | null> {
  const invoices = await stripe.invoices.list({
    subscription: stripeSubscriptionId,
    status: "open",
    limit: 1,
  });
  const open = invoices.data[0];
  if (!open) return null;
  return {
    id: open.id ?? "",
    hostedInvoiceUrl: open.hosted_invoice_url ?? null,
    amountDue: open.amount_due ?? 0,
    currency: open.currency ?? "usd",
  };
}

/**
 * Get current period end for a Stripe subscription (for creating Subscription doc).
 */
export async function getStripeSubscriptionPeriodEnd(stripeSubscriptionId: string): Promise<Date> {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const end = (sub as unknown as { current_period_end?: number }).current_period_end;
    return typeof end === "number" ? new Date(end * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/** Read current_period_end off a Stripe sub regardless of SDK typing drift. */
function periodEndOf(sub: Stripe.Subscription): Date | null {
    const ts = (sub as unknown as { current_period_end?: number }).current_period_end;
    return typeof ts === "number" ? new Date(ts * 1000) : null;
}

/**
 * Result of a Picture Sharing toggle.
 *  - "enabled"            → add-on is now on (line-item billed to the toggler).
 *  - "disabled"           → scheduled to switch off at `removeAt`; access kept until then.
 *  - "checkout_required"  → toggler has no subscription to bill; caller must
 *                           send them through Stripe Checkout (createPictureAddonCheckout).
 *  - "unchanged"          → nothing to do.
 */
export type PictureToggleResult =
    | { kind: "enabled" }
    | { kind: "disabled"; removeAt: Date | null }
    | { kind: "checkout_required" }
    | { kind: "unchanged" };

/**
 * Count a user's picture-billable channels (active/trial, picture on, NOT
 * already scheduled for removal). Used to size the add-on line-item quantity
 * so a channel mid-removal doesn't inflate it.
 */
async function countBillablePictureChannels(userId: Types.ObjectId): Promise<number> {
    return Channel.countDocuments({
        users: userId,
        state: { $in: ["active", "trial"] },
        pictureShareEnabled: true,
        pictureShareRemoveAt: null,
    });
}

/**
 * Resolve which user is billed for a channel's Picture Sharing add-on (#100).
 * Prefers the explicit `pictureAddonPurchasedBy` stamp (#81); falls back for
 * legacy channels enabled before that field existed: the owner of a standalone
 * add-on sub, else the core-sub owner. Returns null only when no payer can be
 * determined at all (in which case callers should not block — fail open).
 */
export async function resolvePicturePayerId(channel: {
    _id: Types.ObjectId;
    pictureAddonPurchasedBy?: Types.ObjectId | null;
}): Promise<string | null> {
    if (channel.pictureAddonPurchasedBy) return channel.pictureAddonPurchasedBy.toString();
    const addonSub = await Subscription.findOne({
        channelId: channel._id,
        isAddon: true,
        status: { $in: ["active", "trialing", "past_due"] },
    });
    if (addonSub?.userId) return addonSub.userId.toString();
    const coreSub = await Subscription.findOne({ channelId: channel._id, isAddon: false }).sort({
        createdAt: -1,
    });
    if (coreSub?.userId) return coreSub.userId.toString();
    return null;
}

/**
 * Toggle the Picture Sharing add-on on a channel mid-cycle. Per Craig's
 * 2026-05-28 spec (#81/#82):
 *
 *  - Whoever toggles, pays. A toggler with an existing core subscription
 *    (the channel creator) gets the £4.99 add-on as a line item on that sub
 *    — single billing date preserved, charged today pro-rata.
 *  - A toggler with NO subscription (the joining user) can't be billed here;
 *    we return "checkout_required" and the caller routes them through Stripe
 *    Checkout (createPictureAddonCheckout) to create their OWN customer +
 *    standalone add-on subscription.
 *  - Turning OFF schedules removal at the period end the user already paid
 *    for (no refund, access kept until then) — `cancel_at_period_end` for a
 *    standalone add-on sub, or an immediate proration-free line-item
 *    decrement for the creator's bundled add-on. Either way the channel keeps
 *    pictureShareEnabled=true until `pictureShareRemoveAt`, reconciled by the
 *    cron sweep / subscription.deleted webhook.
 */
export async function toggleChannelPictureSharing(
    userId: string,
    channelId: string,
    enable: boolean
): Promise<PictureToggleResult> {
    await connectDB();

    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    const channel = await Channel.findById(channelId);
    if (!channel) throw new Error("Channel not found");
    if (!(channel.users as Types.ObjectId[]).some((id) => id.toString() === userId)) {
        throw new Error("Forbidden: not a channel member");
    }
    if (channel.state === "closed") {
        throw new Error("Cannot toggle picture sharing on a closed channel");
    }

    const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON;

    if (enable) {
        // Already on. If a removal was scheduled, cancel it (re-enable before
        // the period end). Otherwise nothing to do.
        if (channel.pictureShareEnabled) {
            if (channel.pictureShareRemoveAt) {
                await cancelScheduledPictureRemoval(channel);
                return { kind: "enabled" };
            }
            return { kind: "unchanged" };
        }

        // Toggler with a core sub (creator): add the add-on as a line item on
        // their existing subscription, charged today.
        if (user.activeStripeSubscriptionId) {
            if (!addonPriceId) throw new Error("STRIPE_PRICE_PICTURE_ADDON is not set");
            const subscription = await stripe.subscriptions.retrieve(user.activeStripeSubscriptionId);
            const addonItem = subscription.items.data.find((item) => item.price.id === addonPriceId);
            const targetQuantity = (await countBillablePictureChannels(user._id as Types.ObjectId)) + 1;
            await stripe.subscriptions.update(user.activeStripeSubscriptionId, {
                items: [
                    {
                        id: addonItem?.id,
                        price: addonItem ? undefined : addonPriceId,
                        quantity: Math.max(targetQuantity, 1),
                    },
                ],
                proration_behavior: "always_invoice",
            });
            channel.pictureShareEnabled = true;
            channel.pictureShareRemoveAt = null;
            channel.pictureAddonPurchasedBy = user._id as Types.ObjectId;
            await channel.save();
            await Subscription.updateMany(
                { channelId: channel._id, isAddon: false },
                { $set: { plan: "picture_addon" } }
            );
            return { kind: "enabled" };
        }

        // Toggler with no subscription (joining user): must pay for their own
        // add-on. Defer to Stripe Checkout — the flag stays off until the
        // checkout.session.completed / invoice.paid webhook flips it.
        return { kind: "checkout_required" };
    }

    // ── disable ──────────────────────────────────────────────────────────────
    if (!channel.pictureShareEnabled) return { kind: "unchanged" };
    // Only the paying user may cancel the add-on (#100). Either user can enable
    // it (#25), but turning it off acts on the payer's Stripe subscription, so
    // the non-payer must not be able to cancel the other user's billing. The UI
    // greys the toggle out for them; this is the server-side enforcement.
    const payerId = await resolvePicturePayerId(channel);
    if (payerId && payerId !== userId) {
        throw new Error(
            "Only the person paying for Picture Sharing can turn it off."
        );
    }
    const removeAt = await schedulePictureRemoval(channel, addonPriceId);
    return { kind: "disabled", removeAt };
}

/**
 * Schedule the channel's Picture Sharing add-on for removal at the end of the
 * period already paid for. Keeps `pictureShareEnabled=true` and stamps
 * `pictureShareRemoveAt`; the cron sweep / subscription.deleted webhook flips
 * it off once the date passes. No pro-rata refund (#82).
 */
async function schedulePictureRemoval(
    channel: InstanceType<typeof Channel>,
    addonPriceId: string | undefined
): Promise<Date | null> {
    // Standalone add-on subscription (joining user) → cancel_at_period_end.
    const addonSub = await Subscription.findOne({
        channelId: channel._id,
        isAddon: true,
        status: { $in: ["active", "trialing", "past_due"] },
    });
    if (addonSub?.stripeSubscriptionId) {
        const stripeSub = await stripe.subscriptions.update(addonSub.stripeSubscriptionId, {
            cancel_at_period_end: true,
        });
        const periodEnd = periodEndOf(stripeSub) ?? addonSub.currentPeriodEnd ?? null;
        addonSub.cancelAtPeriodEnd = true;
        if (periodEnd) addonSub.currentPeriodEnd = periodEnd;
        await addonSub.save();
        channel.pictureShareRemoveAt = periodEnd;
        await channel.save();
        return periodEnd;
    }

    // Otherwise it's a line item on the channel core-sub owner's subscription.
    // Decrement now with proration_behavior "none": stops next-period billing,
    // issues no credit, and the user keeps access until period end via the flag.
    const coreSub = await Subscription.findOne({ channelId: channel._id, isAddon: false }).sort({
        createdAt: -1,
    });
    const ownerId = (coreSub?.userId ?? (channel.users as Types.ObjectId[])[0]) as Types.ObjectId;
    const owner = await User.findById(ownerId);
    const stripeSubId = coreSub?.stripeSubscriptionId || owner?.activeStripeSubscriptionId || null;
    let periodEnd: Date | null = coreSub?.currentPeriodEnd ?? null;

    if (stripeSubId && addonPriceId) {
        const subscription = await stripe.subscriptions.retrieve(stripeSubId);
        const addonItem = subscription.items.data.find((item) => item.price.id === addonPriceId);
        if (addonItem) {
            const newQty = Math.max(0, (addonItem.quantity ?? 1) - 1);
            await stripe.subscriptions.update(stripeSubId, {
                items: [newQty === 0 ? { id: addonItem.id, deleted: true } : { id: addonItem.id, quantity: newQty }],
                proration_behavior: "none",
            });
        }
        periodEnd = periodEndOf(subscription) ?? periodEnd;
    }

    channel.pictureShareRemoveAt = periodEnd ?? new Date();
    await channel.save();
    return channel.pictureShareRemoveAt;
}

/**
 * Undo a scheduled Picture Sharing removal (user re-enabled before the period
 * end). Clears cancel_at_period_end on a standalone sub, or re-adds the
 * line-item quantity (no charge — they still have access this period).
 */
async function cancelScheduledPictureRemoval(
    channel: InstanceType<typeof Channel>
): Promise<void> {
    const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON;
    const addonSub = await Subscription.findOne({ channelId: channel._id, isAddon: true });
    if (addonSub?.stripeSubscriptionId) {
        await stripe.subscriptions.update(addonSub.stripeSubscriptionId, {
            cancel_at_period_end: false,
        });
        addonSub.cancelAtPeriodEnd = false;
        await addonSub.save();
    } else {
        const coreSub = await Subscription.findOne({ channelId: channel._id, isAddon: false }).sort({
            createdAt: -1,
        });
        const ownerId = (coreSub?.userId ?? (channel.users as Types.ObjectId[])[0]) as Types.ObjectId;
        const owner = await User.findById(ownerId);
        const stripeSubId = coreSub?.stripeSubscriptionId || owner?.activeStripeSubscriptionId || null;
        if (stripeSubId && addonPriceId) {
            const subscription = await stripe.subscriptions.retrieve(stripeSubId);
            const addonItem = subscription.items.data.find((item) => item.price.id === addonPriceId);
            const targetQuantity = (await countBillablePictureChannels(ownerId)) + 1;
            await stripe.subscriptions.update(stripeSubId, {
                items: [
                    {
                        id: addonItem?.id,
                        price: addonItem ? undefined : addonPriceId,
                        quantity: Math.max(targetQuantity, 1),
                    },
                ],
                proration_behavior: "none",
            });
        }
    }
    channel.pictureShareRemoveAt = null;
    await channel.save();
}

/**
 * Create a Stripe Checkout session for a user (typically the joining user with
 * no existing subscription) to pay for Picture Sharing on a channel via their
 * OWN customer + standalone add-on subscription (#81). The
 * checkout.session.completed / invoice.paid webhook (scenario "picture_addon")
 * flips Channel.pictureShareEnabled and records the standalone Subscription.
 */
export async function createPictureAddonCheckout(
    userId: string,
    channelId: string
): Promise<string> {
    await connectDB();
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    const channel = await Channel.findById(channelId);
    if (!channel) throw new Error("Channel not found");
    if (!(channel.users as Types.ObjectId[]).some((id) => id.toString() === userId)) {
        throw new Error("Forbidden: not a channel member");
    }
    const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON;
    if (!addonPriceId) throw new Error("STRIPE_PRICE_PICTURE_ADDON is not set");

    // The joining user usually has no Stripe customer yet — create their own.
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
        await User.updateOne({ _id: user._id }, { $set: { stripeCustomerId: customerId } });
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    const metadata = {
        userId: user._id.toString(),
        channelId,
        scenario: "picture_addon",
    };
    const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: addonPriceId, quantity: 1 }],
        success_url: `${appUrl}/channel/${channelId}/settings?picture=enabled`,
        cancel_url: `${appUrl}/channel/${channelId}/settings`,
        subscription_data: { metadata },
        metadata,
    });
    if (!session.url) throw new Error("Failed to create Picture Sharing checkout session");
    return session.url;
}

/**
 * Stripe-side cleanup when a channel is permanently closed: decrement the
 * core line-item quantity by 1 (and the picture line-item if the channel
 * had it). Stripe issues pro-rated credit on the next invoice.
 *
 * Safe to call when there's no Stripe sub (trial channels) — no-ops.
 */
export async function applyChannelCloseToStripe(
    userId: string,
    channelId: string,
    hadPictureShare: boolean
): Promise<{ coreDecremented: boolean; pictureDecremented: boolean }> {
    await connectDB();
    const user = await User.findById(userId);
    if (!user || !user.activeStripeSubscriptionId) {
        return { coreDecremented: false, pictureDecremented: false };
    }

    const corePriceId = process.env.STRIPE_PRICE_CORE;
    const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON;
    if (!corePriceId) throw new Error("STRIPE_PRICE_CORE is not set");

    const subscription = await stripe.subscriptions.retrieve(user.activeStripeSubscriptionId);
    const coreItem = subscription.items.data.find((item) => item.price.id === corePriceId);
    const addonItem = addonPriceId
        ? subscription.items.data.find((item) => item.price.id === addonPriceId)
        : undefined;

    const items: Stripe.SubscriptionUpdateParams.Item[] = [];
    let coreDecremented = false;
    let pictureDecremented = false;

    if (coreItem) {
        const newQty = Math.max(0, (coreItem.quantity ?? 0) - 1);
        if (newQty === 0) {
            // Last channel — cancelling subscription is the right move; spec
            // treats this as cancellation, not just a quantity tweak.
            await stripe.subscriptions.cancel(user.activeStripeSubscriptionId);
            return { coreDecremented: true, pictureDecremented: !!addonItem };
        }
        items.push({ id: coreItem.id, quantity: newQty });
        coreDecremented = true;
    }

    if (hadPictureShare && addonItem) {
        const newAddonQty = Math.max(0, (addonItem.quantity ?? 0) - 1);
        if (newAddonQty === 0) {
            items.push({ id: addonItem.id, deleted: true });
        } else {
            items.push({ id: addonItem.id, quantity: newAddonQty });
        }
        pictureDecremented = true;
    }

    if (items.length > 0) {
        await stripe.subscriptions.update(user.activeStripeSubscriptionId, {
            items,
            proration_behavior: "create_prorations",
        });
    }

    return { coreDecremented, pictureDecremented };
}
