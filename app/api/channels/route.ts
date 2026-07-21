import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import connectDB from "@/lib/db/connect";
import { Channel, ChannelViewer, User, UserChannelPreferences, PendingChannelRequest, Subscription } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { canCreateChannel, reserveNumber, assignNumberToChannel } from "@/lib/services/numberPool";
import { updateSubscriptionForNewChannel, createSubscriptionForChannel, getStripeSubscriptionPeriodEnd, getOpenInvoiceForSubscription } from "@/lib/services/billing";
import { PLACEHOLDER_PHONE } from "@/lib/services/createFirstChannelForUser";
import { formatBothPartiesLabel } from "@/lib/utils/formatChannelLabel";
import mongoose from "mongoose";
import type { Types } from "mongoose";

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2025-01-27.acacia" as any });
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").trim();
}

export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    await connectDB();

    let query: Record<string, unknown>;
    if (payload.role === "admin" || payload.role === "super_admin") {
      query = { state: { $nin: ["closed"] } };
    } else {
      // Regular users see channels they're a member of. Viewers see channels
      // they have an active ChannelViewer record on. A single user can be
      // both (member on one channel, viewer on another) so we union the two.
      const viewerRows = await ChannelViewer.find({
        userId: payload.userId,
        status: "active",
      })
        .select("channelId")
        .lean();
      const viewerChannelIds = viewerRows.map((v) => v.channelId);
      query = {
        $or: [{ users: payload.userId }, { _id: { $in: viewerChannelIds } }],
        state: { $nin: ["closed"] },
      };
    }

    const channels = await Channel.find(query)
      .select("_id clanchaNumber name state pictureShareEnabled emergencyBypassEnabled createdAt users")
      .populate<{ users: Array<{ _id: Types.ObjectId; name?: string | null; phone?: string | null }> }>({
        path: "users",
        select: "name phone",
      })
      .lean();

    // Each member sees the channel labelled with the OTHER party's name
    // (standard messaging-app convention — #84). Computed per-viewer.
    // Viewers aren't channel members, so "other party" doesn't apply to them
    // — they instead get both parents' names, same composition as the admin
    // list (#41), since a viewer (e.g. a solicitor) needs to tell channels
    // apart by both parents, not by "the other party" relative to themself.
    const meId = payload.userId;
    const items = channels.map((c) => {
      const members = (c.users ?? []) as Array<{
        _id: Types.ObjectId;
        name?: string | null;
        phone?: string | null;
      }>;
      const isMember = members.some((u) => u && u._id?.toString() === meId);
      let otherPartyName: string | null = null;
      if (isMember) {
        const other = members.find((u) => u && u._id?.toString() !== meId);
        if (other && other.phone !== PLACEHOLDER_PHONE) {
          const nm = (typeof other.name === "string" && other.name.trim()) || null;
          otherPartyName = nm || (other.phone ? "•••" + other.phone.slice(-4) : null);
        }
      } else {
        otherPartyName = formatBothPartiesLabel(members, c.name);
      }
      return {
        id: c._id.toString(),
        clanchaNumber: c.clanchaNumber,
        name: c.name ?? null,
        otherPartyName,
        state: c.state,
        pictureShareEnabled: c.pictureShareEnabled,
        emergencyBypassEnabled: c.emergencyBypassEnabled,
        createdAt: c.createdAt,
      };
    });

    return NextResponse.json({ channels: items });
  } catch (error) {
    console.error("channels list error:", error);
    return NextResponse.json(
      { error: "Failed to list channels" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    const body = await request.json();
    const {
      otherUserPhone,
      pictureShareEnabled,
      recipientName,
      recipientEmail,
      children,
      receivingHoursStart,
      receivingHoursEnd,
      timezone,
      emergencyBypassEnabled,
      rewriteTone,
    } = body as {
      otherUserPhone?: string;
      pictureShareEnabled?: boolean;
      recipientName?: string;
      recipientEmail?: string;
      children?: Array<{ name: string; dob?: string | null }>;
      receivingHoursStart?: string;
      receivingHoursEnd?: string;
      timezone?: string;
      emergencyBypassEnabled?: boolean;
      rewriteTone?: "calm_clear" | "firm_fair";
    };

    if (!otherUserPhone || typeof otherUserPhone !== "string") {
      return NextResponse.json(
        { error: "otherUserPhone is required" },
        { status: 400 }
      );
    }

    const sanitizedChildren = Array.isArray(children)
      ? children
          .filter((c) => c && typeof c.name === "string" && c.name.trim().length > 0)
          .map((c) => ({ name: c.name.trim(), dob: c.dob || null }))
          .slice(0, 12)
      : [];
    const cleanRecipientName = typeof recipientName === "string" ? recipientName.trim() : "";
    const cleanRecipientEmail = typeof recipientEmail === "string" ? recipientEmail.trim() : "";
    const cleanTone: "calm_clear" | "firm_fair" =
      rewriteTone === "firm_fair" ? "firm_fair" : "calm_clear";
    const emergencyBypass = emergencyBypassEnabled !== false;

    await connectDB();
    const user = await User.findById(payload.userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Persist receiving hours + timezone on the signing-up user — these are
    // user-level settings per spec (Doc 2 §receiving hours), not channel.
    const userUpdates: Record<string, unknown> = {};
    if (typeof receivingHoursStart === "string" && receivingHoursStart) {
      userUpdates.receivingHoursStart = receivingHoursStart;
    }
    if (typeof receivingHoursEnd === "string" && receivingHoursEnd) {
      userUpdates.receivingHoursEnd = receivingHoursEnd;
    }
    if (typeof timezone === "string" && timezone) {
      userUpdates.timezone = timezone;
    }
    if (Object.keys(userUpdates).length > 0) {
      await User.updateOne({ _id: user._id }, { $set: userUpdates });
      Object.assign(user, userUpdates);
    }

    // Defensive: if the user's Stripe IDs are stale (e.g. after a Stripe
    // account swap on staging — see scripts/clear-stale-stripe-refs.mjs and
    // M4 tracker recovery 2026-05-22), Stripe returns `resource_missing` and
    // the entire create-channel pipeline crashes with a generic
    // "Failed to create channel". Verify both IDs upfront; if either is
    // stale, clear it from the user record and treat the user as if they had
    // no Stripe state — i.e. route them through fresh Stripe Checkout
    // signup mode instead of trying to bump a sub that doesn't exist.
    const stripeClient = getStripeClient();
    if (user.stripeCustomerId) {
      try {
        const cust = (await stripeClient.customers.retrieve(user.stripeCustomerId)) as Stripe.Customer;
        if (cust.deleted) {
          await User.updateOne(
            { _id: user._id },
            { $set: { stripeCustomerId: null, activeStripeSubscriptionId: null } }
          );
          user.stripeCustomerId = undefined;
          user.activeStripeSubscriptionId = undefined;
        }
      } catch (err: any) {
        if (err?.code === "resource_missing" || err?.statusCode === 404) {
          await User.updateOne(
            { _id: user._id },
            { $set: { stripeCustomerId: null, activeStripeSubscriptionId: null } }
          );
          user.stripeCustomerId = undefined;
          user.activeStripeSubscriptionId = undefined;
          console.warn("[channels] cleared stale Stripe customer ID", { userId: user._id.toString() });
        } else {
          throw err;
        }
      }
    }
    if (user.activeStripeSubscriptionId) {
      try {
        await stripeClient.subscriptions.retrieve(user.activeStripeSubscriptionId);
      } catch (err: any) {
        if (err?.code === "resource_missing" || err?.statusCode === 404) {
          await User.updateOne(
            { _id: user._id },
            { $set: { activeStripeSubscriptionId: null } }
          );
          user.activeStripeSubscriptionId = undefined;
          console.warn("[channels] cleared stale Stripe subscription ID", { userId: user._id.toString() });
        } else {
          throw err;
        }
      }
    }

    // No Stripe customer yet (brand-new user OR cleared above) → route them
    // to Stripe Checkout in subscription mode, carrying the full channel
    // payload in a PendingChannelRequest. The invoice.paid webhook
    // materialises the channel after payment.
    if (!user.stripeCustomerId || !user.activeStripeSubscriptionId) {
      await PendingChannelRequest.deleteMany({ userId: user._id });
      const pending = await PendingChannelRequest.create({
        userId: user._id,
        otherUserPhone: otherUserPhone.trim(),
        pictureShareEnabled: !!pictureShareEnabled,
        recipientName: cleanRecipientName || null,
        recipientEmail: cleanRecipientEmail || null,
        emergencyBypassEnabled: emergencyBypass,
        rewriteTone: cleanTone,
        receivingHoursStart: receivingHoursStart || null,
        receivingHoursEnd: receivingHoursEnd || null,
        timezone: timezone || null,
        children: sanitizedChildren,
      });

      // Lazy customer creation: only if needed for Checkout. If the user
      // doesn't have one yet, Stripe Checkout will create it on first paid
      // session, but we attach the customer to the session up-front when we
      // can so subsequent flows reuse the same ID.
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customerName = user.name?.trim() ||
          (typeof user.email === "string" && user.email.includes("@")
            ? user.email.split("@")[0]
            : "Clancha User");
        const created = await stripeClient.customers.create({
          email: user.email || undefined,
          name: customerName,
          metadata: { userId: user._id.toString() },
        });
        customerId = created.id;
        await User.updateOne({ _id: user._id }, { $set: { stripeCustomerId: customerId } });
      }

      const corePriceId = process.env.STRIPE_PRICE_CORE;
      const addonPriceId = process.env.STRIPE_PRICE_PICTURE_ADDON;
      if (!corePriceId) throw new Error("STRIPE_PRICE_CORE is not set");
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        { price: corePriceId, quantity: 1 },
      ];
      if (pictureShareEnabled) {
        if (!addonPriceId) throw new Error("STRIPE_PRICE_PICTURE_ADDON is not set");
        lineItems.push({ price: addonPriceId, quantity: 1 });
      }

      const session = await stripeClient.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: lineItems,
        success_url: `${appUrl()}/dashboard?welcome=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl()}/dashboard`,
        subscription_data: {
          metadata: {
            userId: user._id.toString(),
            scenario: "signup",
            pendingChannelRequestId: pending._id.toString(),
            pictureAddon: pictureShareEnabled ? "1" : "0",
          },
        },
        metadata: {
          userId: user._id.toString(),
          scenario: "signup",
          pendingChannelRequestId: pending._id.toString(),
          pictureAddon: pictureShareEnabled ? "1" : "0",
        },
      });

      return NextResponse.json({
        redirectUrl: session.url,
        reason: "no_subscription_yet",
      });
    }

    const myChannels = await Channel.find({
      users: payload.userId,
      state: { $nin: ["closed"] },
    }).lean();

    // First channel (0 channels): create immediately — subscription already covers it. Same "Create channel" flow for all.
    if (myChannels.length === 0) {
      const otherPhoneNorm = normalizePhone(otherUserPhone);
      let otherUser = await User.findOne({
        phone: { $regex: new RegExp(`^\\+?${otherPhoneNorm}$`) },
      });
      const recipientFallbackEmail = `clancha_${otherPhoneNorm.replace(/\+/g, "")}@invited.com`;
      if (!otherUser) {
        otherUser = await User.create({
          phone: otherPhoneNorm.startsWith("+") ? otherPhoneNorm : `+${otherPhoneNorm}`,
          email: cleanRecipientEmail || recipientFallbackEmail,
          name: cleanRecipientName || undefined,
          role: "user",
        });
      } else {
        // Fill in name/email if not already set — never overwrite an existing real value.
        const update: Record<string, unknown> = {};
        if (cleanRecipientName && !otherUser.name) update.name = cleanRecipientName;
        if (
          cleanRecipientEmail &&
          (!otherUser.email || otherUser.email.endsWith("@invited.com"))
        ) {
          update.email = cleanRecipientEmail;
        }
        if (Object.keys(update).length > 0) {
          await User.updateOne({ _id: otherUser._id }, { $set: update });
          Object.assign(otherUser, update);
        }
      }
      const otherId = otherUser._id as Types.ObjectId;
      const myId = new mongoose.Types.ObjectId(payload.userId);
      if (otherId.equals(myId)) {
        return NextResponse.json(
          { error: "Cannot create channel with yourself" },
          { status: 400 }
        );
      }
      const existing = await Channel.findOne({
        users: { $all: [myId, otherId] },
        state: { $nin: ["closed"] },
      });
      if (existing) {
        return NextResponse.json(
          { error: "Channel already exists with this user" },
          { status: 400 }
        );
      }
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const reserved = await reserveNumber(session, payload.userId);
        if (!reserved) {
          await session.abortTransaction();
          return NextResponse.json(
            { error: "No Clancha number available. Please try again later." },
            { status: 503 }
          );
        }
        const channelName = cleanRecipientName || undefined;
        const channel = await Channel.create(
          [
            {
              users: [myId, otherId],
              clanchaNumber: reserved.number,
              state: "active",
              name: channelName,
              pictureShareEnabled: !!pictureShareEnabled,
              emergencyBypassEnabled: emergencyBypass,
              linkedChildren: sanitizedChildren,
            },
          ],
          { session }
        );
        const newChannel = channel[0];
        await assignNumberToChannel(session, reserved.id, newChannel._id as Types.ObjectId);
        const plan: "core" | "picture_addon" = pictureShareEnabled ? "picture_addon" : "core";
        const currentPeriodEnd = await getStripeSubscriptionPeriodEnd(user.activeStripeSubscriptionId);
        // Reuse the orphaned subscription doc created by the webhook (channelId: null),
        // or create a new one if it doesn't exist.
        const orphaned = await Subscription.findOne(
          { userId: myId, stripeSubscriptionId: user.activeStripeSubscriptionId, channelId: null },
          null,
          { session }
        );
        if (orphaned) {
          await Subscription.updateOne(
            { _id: orphaned._id },
            { $set: { channelId: newChannel._id, plan, currentPeriodEnd } },
            { session }
          );
          await newChannel.updateOne(
            { $set: { subscriptionId: orphaned._id } },
            { session }
          );
        } else {
          await createSubscriptionForChannel(
            session,
            myId,
            newChannel._id as Types.ObjectId,
            user.activeStripeSubscriptionId,
            plan,
            currentPeriodEnd
          );
        }
        // Signing user picks their own tone; the recipient defaults to
        // calm_clear and can change it later.
        await UserChannelPreferences.create(
          [{ userId: myId, channelId: newChannel._id, rewriteTone: cleanTone }],
          { session }
        );
        await UserChannelPreferences.create(
          [{ userId: otherId, channelId: newChannel._id, rewriteTone: "calm_clear" }],
          { session }
        );
        await session.commitTransaction();
        const c = await Channel.findById(newChannel._id).lean();
        return NextResponse.json({
          id: c!._id.toString(),
          clanchaNumber: c!.clanchaNumber,
          name: c!.name ?? null,
          state: c!.state,
          pictureShareEnabled: c!.pictureShareEnabled,
          emergencyBypassEnabled: c!.emergencyBypassEnabled,
          createdAt: c!.createdAt,
        });
      } finally {
        session.endSession();
      }
    }

    // Subsequent channels (1+): require payment, then webhook creates channel from pending
    const allowed = await canCreateChannel(payload.userId);
    if (!allowed) {
      return NextResponse.json(
        { error: "Maximum of 5 active channels per user" },
        { status: 400 }
      );
    }

    const otherPhoneNorm = normalizePhone(otherUserPhone);
    let otherUser = await User.findOne({
      phone: { $regex: new RegExp(`^\\+?${otherPhoneNorm}$`) },
    });
    if (!otherUser) {
      otherUser = await User.create({
        phone: otherPhoneNorm.startsWith("+") ? otherPhoneNorm : `+${otherPhoneNorm}`,
        email: `clancha_${otherPhoneNorm.replace(/\+/g, "")}@invited.com`,
        role: "user",
      });
    }
    const otherId = otherUser._id as Types.ObjectId;
    const myId = new mongoose.Types.ObjectId(payload.userId);
    if (otherId.equals(myId)) {
      return NextResponse.json(
        { error: "Cannot create channel with yourself" },
        { status: 400 }
      );
    }
    const existing = await Channel.findOne({
      users: { $all: [myId, otherId] },
      state: { $nin: ["closed"] },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Channel already exists with this user" },
        { status: 400 }
      );
    }

    // If the user already has an open (unpaid) invoice on the active sub from
    // a previous failed attempt, do not bump quantity again — that would only
    // create another failing invoice. Send the user to the Stripe-hosted
    // invoice URL so they can update their card and pay it.
    const openInvoice = await getOpenInvoiceForSubscription(user.activeStripeSubscriptionId);
    if (openInvoice && openInvoice.hostedInvoiceUrl) {
      return NextResponse.json(
        {
          error: "Your previous payment is still unpaid. Please update your payment method to continue.",
          hostedInvoiceUrl: openInvoice.hostedInvoiceUrl,
          openInvoiceId: openInvoice.id,
        },
        { status: 402 }
      );
    }

    // No-PM precheck: if the customer has no default payment method, the
    // upcoming `subscriptions.update` would silently leave an open invoice
    // (Craig's 5-min "Payment Processing" hang). Hand the user to Stripe
    // Checkout in setup mode so Stripe collects a card; the
    // checkout.session.completed webhook then attaches it as default PM and
    // bumps the subscription quantity.
    const pendingFields = {
      userId: payload.userId,
      otherUserPhone: otherUserPhone.trim(),
      pictureShareEnabled: !!pictureShareEnabled,
      recipientName: cleanRecipientName || null,
      recipientEmail: cleanRecipientEmail || null,
      emergencyBypassEnabled: emergencyBypass,
      rewriteTone: cleanTone,
      receivingHoursStart: receivingHoursStart || null,
      receivingHoursEnd: receivingHoursEnd || null,
      timezone: timezone || null,
      children: sanitizedChildren,
    } as const;
    const customer = (await getStripeClient().customers.retrieve(user.stripeCustomerId)) as Stripe.Customer;
    const hasDefaultPM = !!customer.invoice_settings?.default_payment_method;
    if (!hasDefaultPM) {
      const pendingForPM = await PendingChannelRequest.create(pendingFields);
      const session = await getStripeClient().checkout.sessions.create({
        mode: "setup",
        customer: user.stripeCustomerId,
        payment_method_types: ["card"],
        success_url: `${appUrl()}/dashboard?channel_pending=1`,
        cancel_url: `${appUrl()}/dashboard`,
        metadata: {
          userId: payload.userId,
          scenario: "add_channel",
          pendingChannelRequestId: pendingForPM._id.toString(),
          pictureShareEnabled: pictureShareEnabled ? "1" : "0",
        },
      });
      return NextResponse.json({
        redirectUrl: session.url,
        reason: "no_payment_method",
      });
    }

    // Subsequent channel: create pending request and trigger Stripe (invoice). Channel is created in webhook after payment succeeds.
    const pending = await PendingChannelRequest.create(pendingFields);
    try {
      await updateSubscriptionForNewChannel(payload.userId, !!pictureShareEnabled);
    } catch (billingError: any) {
      await PendingChannelRequest.findByIdAndDelete(pending._id);
      console.error("Billing error:", billingError);
      return NextResponse.json(
        { error: billingError.message || "Subscription update failed. Please check your payment method." },
        { status: 402 }
      );
    }
    return NextResponse.json({
      pending: true,
      message: "Payment initiated for your new channel. The channel will be created once payment succeeds.",
    });
  } catch (error) {
    console.error("channels create error:", error);
    return NextResponse.json(
      { error: "Failed to create channel" },
      { status: 500 }
    );
  }
}
