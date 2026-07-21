import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import connectDB from "@/lib/db/connect";
import { Channel, Subscription, User, AuditLog, ProcessedWebhookEvent } from "@/lib/db/models";
import { PendingChannelRequest } from "@/lib/db/models";
import { createFirstChannelForUser, createSubsequentChannelForUser } from "@/lib/services/createFirstChannelForUser";
import { updateSubscriptionForNewChannel } from "@/lib/services/billing";
import mongoose from "mongoose";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2025-01-27.acacia" as any });
}

/**
 * Pull the subscription id off an invoice across Stripe API revisions.
 *
 * In Stripe API ≥ 2025-01-27 the top-level `invoice.subscription` field is
 * deprecated; the subscription now lives at
 * `invoice.parent.subscription_details.subscription`. Reading only the
 * legacy field caused every invoice.paid / invoice.payment_failed event
 * from Craig's webhook to bail out at the early return — signature OK,
 * but the handler silently no-op'd, so channels never materialised after
 * payment.
 */
function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as Stripe.Invoice & { subscription?: string | { id: string } | null }).subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) return legacy.id;
  const parent = (invoice as Stripe.Invoice & {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } } | null;
  }).parent;
  const fromParent = parent?.subscription_details?.subscription;
  if (typeof fromParent === "string") return fromParent;
  if (fromParent && typeof fromParent === "object" && "id" in fromParent) return fromParent.id;
  return null;
}

/**
 * Propagate a subscription's payment method up to the customer's
 * invoice_settings.default_payment_method. Subscription-mode Checkout sets the
 * PM on the subscription but not the customer, so the portal billing page
 * (which reads the customer-level default) showed "No default payment method
 * set in Stripe" (#83). Falls back to the customer's first card.
 */
async function setCustomerDefaultPMFromSub(
  stripe: Stripe,
  customerId: string,
  sub: Stripe.Subscription
): Promise<void> {
  try {
    let paymentMethodId =
      typeof sub.default_payment_method === "string"
        ? sub.default_payment_method
        : sub.default_payment_method?.id ?? null;
    if (!paymentMethodId) {
      const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
      paymentMethodId = pms.data[0]?.id ?? null;
    }
    if (paymentMethodId) {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      console.log("[stripe webhook] set customer default payment method", {
        customerId: customerId.slice(0, 20) + "...",
        paymentMethodId,
      });
    } else {
      console.warn("[stripe webhook] no payment method found to set as default", { subId: sub.id });
    }
  } catch (err) {
    console.error("[stripe webhook] failed to set customer default PM", err);
  }
}

/**
 * Enable a channel's Picture Sharing add-on from a paid STANDALONE add-on
 * subscription (scenario "picture_addon", #81). Records the standalone
 * Subscription doc (isAddon=true), flips the channel flag, and stamps who
 * paid. Idempotent — safe from both checkout.session.completed and invoice.paid.
 */
async function enablePictureAddonFromStripe(sub: Stripe.Subscription): Promise<void> {
  const channelId = sub.metadata?.channelId;
  const userId = sub.metadata?.userId;
  if (!channelId || !userId) {
    console.warn("[stripe webhook] picture_addon sub missing channelId/userId metadata", {
      subId: sub.id,
    });
    return;
  }
  const periodEndTs = (sub as unknown as { current_period_end?: number }).current_period_end;
  const currentPeriodEnd = new Date(
    typeof periodEndTs === "number" ? periodEndTs * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000
  );
  await Subscription.findOneAndUpdate(
    { stripeSubscriptionId: sub.id },
    {
      $set: {
        userId: new mongoose.Types.ObjectId(userId),
        channelId: new mongoose.Types.ObjectId(channelId),
        plan: "picture_addon",
        status: "active",
        isAddon: true,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        currentPeriodEnd,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  await Channel.updateOne(
    { _id: channelId },
    {
      $set: {
        pictureShareEnabled: true,
        pictureAddonPurchasedBy: new mongoose.Types.ObjectId(userId),
        pictureShareRemoveAt: null,
      },
    }
  );
  console.log("[stripe webhook] picture_addon enabled", { channelId, userId, subId: sub.id });
}

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  console.log("[stripe webhook] POST request received at", new Date().toISOString());

  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  // Stripe requires the exact raw body for signature verification — do not parse as JSON first
  const body = await request.arrayBuffer().then((buf) =>
    Buffer.from(buf).toString("utf-8")
  );
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("[stripe webhook] Signature verification failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    await connectDB();

    // Idempotency: Stripe retries deliveries (and signed events can be
    // replayed). Atomically claim this event id; if we've seen it before,
    // ack with 200 and skip. Unique index on (source, eventId) makes this
    // safe under concurrent deliveries.
    try {
      await ProcessedWebhookEvent.create({
        source: "stripe",
        eventId: event.id,
        eventType: event.type,
      });
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e.code === 11000) {
        console.log("[stripe webhook] Duplicate event — skipping", {
          type: event.type,
          id: event.id,
        });
        return NextResponse.json({ received: true, duplicate: true });
      }
      throw err;
    }

    console.log("[stripe webhook] Event received", {
      type: event.type,
      id: event.id,
    });

    switch (event.type) {
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = getInvoiceSubscriptionId(invoice);
        if (!subId) {
          console.warn("[stripe webhook] invoice.paid: missing or invalid subscription id", {
            legacy: (invoice as Stripe.Invoice & { subscription?: unknown }).subscription,
            parent: (invoice as Stripe.Invoice & { parent?: unknown }).parent,
          });
          break;
        }

        const customerId = invoice.customer as string;
        console.log("[stripe webhook] invoice.paid: fetching Stripe subscription", {
          subId,
          customerId: customerId?.slice(0, 20) + "...",
        });

        const stripe = getStripe();
        const sub = await stripe.subscriptions.retrieve(subId);

        // Standalone Picture Sharing add-on subscription (#81): enable the
        // add-on on its channel and stop — it must NOT run the core
        // channel-materialisation path below (which would create core
        // Subscription docs for all the buyer's channels).
        if (sub.metadata?.scenario === "picture_addon") {
          await enablePictureAddonFromStripe(sub);
          const addonCustomerId = invoice.customer as string | null;
          if (addonCustomerId) {
            await setCustomerDefaultPMFromSub(stripe, addonCustomerId, sub);
          }
          break;
        }

        const hasPictureAddon = sub.items.data.some(
          (item) => item.price.id === process.env.STRIPE_PRICE_PICTURE_ADDON
        );

        const user = await User.findOne({ stripeCustomerId: customerId }).lean();
        console.log("[stripe webhook] invoice.paid: user lookup", {
          customerId: customerId?.slice(0, 20) + "...",
          userFound: !!user,
          userId: user?._id?.toString(),
        });

        if (user) {
          // Set activeStripeSubscriptionId only after payment succeeds (was
          // previously set in /api/create-payment-intent which left abandoned
          // checkouts pointing at incomplete subs).
          //
          // Do NOT set User.isPictureAddonEnabled here. Picture sharing is
          // per-channel per spec; the previous global flag caused future
          // channels to auto-enable picture sharing, contradicting the
          // "opt-in per channel" rule.
          await User.updateOne(
            { stripeCustomerId: customerId },
            {
              $set: {
                activeStripeSubscriptionId: subId,
              },
            }
          );
          console.log("[stripe webhook] invoice.paid: User updated", { userId: user._id.toString() });
        } else {
          console.warn("[stripe webhook] invoice.paid: no user found for customerId", {
            customerId: customerId?.slice(0, 20) + "...",
          });
        }

        // Default plan label used only for orphaned/new sub docs where we
        // don't yet have a channel — the per-channel plan is computed below
        // from each channel's actual pictureShareEnabled flag.
        const fallbackPlan: "core" | "picture_addon" = hasPictureAddon ? "picture_addon" : "core";
        const periodEndTs = (sub as unknown as { current_period_end?: number }).current_period_end;
        const currentPeriodEnd = new Date(
          typeof periodEndTs === "number" ? periodEndTs * 1000 : Date.now()
        );

        const subDocs = await Subscription.find({ stripeSubscriptionId: subId });
        console.log("[stripe webhook] invoice.paid: Subscription lookup", {
          subId,
          count: subDocs.length,
        });

        if (subDocs.length > 0) {
          // On renewal, channels that were per-channel cancelled (cancelAtPeriodEnd=true)
          // have already had their Stripe items removed. Transition them to view_only
          // before reactivating the remaining channels.
          const cancelledDocs = subDocs.filter((s) => s.cancelAtPeriodEnd);
          if (cancelledDocs.length > 0) {
            const cancelledSubIds = cancelledDocs.map((s) => s._id);
            const cancelledChannelIds = cancelledDocs
              .map((s) => s.channelId)
              .filter((id): id is mongoose.Types.ObjectId => id != null);
            await Subscription.updateMany(
              { _id: { $in: cancelledSubIds } },
              { $set: { status: "canceled", cancelAtPeriodEnd: false } }
            );
            if (cancelledChannelIds.length > 0) {
              await Channel.updateMany(
                { _id: { $in: cancelledChannelIds } },
                { $set: { state: "view_only" } }
              );
            }
            console.log("[stripe webhook] invoice.paid: per-channel cancelled → view_only", {
              subId,
              count: cancelledDocs.length,
              channelIds: cancelledChannelIds.map((id) => id.toString()),
            });
          }

          // Reactivate non-cancelled subscriptions and their channels.
          // Update period + status without flattening plan. Each Subscription
          // doc's plan reflects ITS OWN channel's picture-share state, not
          // the parent Stripe sub's aggregate.
          await Subscription.updateMany(
            { stripeSubscriptionId: subId, cancelAtPeriodEnd: false, status: { $ne: "canceled" } },
            { $set: { status: "active", currentPeriodEnd } }
          );
          const activeDocs = subDocs.filter((s) => !s.cancelAtPeriodEnd);
          const allChannelIds = subDocs
            .map((s) => s.channelId)
            .filter((id): id is mongoose.Types.ObjectId => id != null);
          const channelIds = activeDocs
            .map((s) => s.channelId)
            .filter((id): id is mongoose.Types.ObjectId => id != null);
          if (channelIds.length > 0) {
            await Channel.updateMany(
              { _id: { $in: channelIds } },
              { $set: { state: "active" } }
            );
            // Set each Subscription doc's plan from its channel's flag.
            const channels = await Channel.find({ _id: { $in: channelIds } })
              .select("_id pictureShareEnabled")
              .lean();
            for (const ch of channels) {
              const channelPlan: "core" | "picture_addon" = ch.pictureShareEnabled
                ? "picture_addon"
                : "core";
              await Subscription.updateMany(
                { stripeSubscriptionId: subId, channelId: ch._id },
                { $set: { plan: channelPlan } }
              );
            }
            console.log("[stripe webhook] invoice.paid: Channels activated", {
              channelIds: channelIds.map((id) => id.toString()),
            });
          } else if (allChannelIds.length === 0 && user) {
            // All existing sub docs are orphaned (channelId: null) — phone pool was previously empty.
            // Try to create the first channel now and link it to the orphaned subscription doc.
            console.log("[stripe webhook] invoice.paid: Found orphaned sub docs, attempting to create first channel", {
              userId: user._id.toString(),
            });
            const channelId = await createFirstChannelForUser(
              user._id.toString(),
              subId,
              fallbackPlan,
              currentPeriodEnd
            );
            if (channelId) {
              // createFirstChannelForUser already created a new Subscription doc for the channel.
              // Delete the orphaned docs to avoid duplicates.
              await Subscription.deleteMany({ stripeSubscriptionId: subId, channelId: null });
              console.log("[stripe webhook] invoice.paid: Created channel from orphaned sub docs", {
                userId: user._id.toString(),
                channelId,
              });
            }
          }
        } else if (user) {
          // No Subscription docs yet for this Stripe sub ID.
          // Check if user already has channels (e.g. repurchase after cancellation or trial).
          const existingChannels = await Channel.find({
            users: user._id,
            state: { $nin: ["closed"] },
          }).lean();

          if (existingChannels.length > 0) {
            // Reactivate existing channels with the new subscription. Each
            // channel keeps its own plan based on its pictureShareEnabled flag.
            for (const ch of existingChannels) {
              const channelPlan: "core" | "picture_addon" = ch.pictureShareEnabled
                ? "picture_addon"
                : "core";
              await Subscription.create({
                userId: user._id,
                channelId: ch._id,
                stripeSubscriptionId: subId,
                plan: channelPlan,
                status: "active",
                currentPeriodEnd,
              });
              await Channel.updateOne({ _id: ch._id }, { $set: { state: "active" } });
            }
            console.log("[stripe webhook] invoice.paid: Existing channels reactivated with new subscription", {
              userId: user._id.toString(),
              channelCount: existingChannels.length,
            });
          } else {
            // Brand new subscriber with no channels yet. Prefer materialising
            // from a PendingChannelRequest (signup-setup flow) so the channel
            // is fully configured. Only fall back to the placeholder-channel
            // pattern when no pending exists (e.g. invite-acceptance path or
            // legacy users that bypassed the setup page).
            const pending = await PendingChannelRequest.findOne({ userId: user._id })
              .sort({ createdAt: 1 })
              .lean();

            if (pending) {
              const pendingPlan: "core" | "picture_addon" = pending.pictureShareEnabled
                ? "picture_addon"
                : "core";
              const channelId = await createSubsequentChannelForUser(
                user._id.toString(),
                subId,
                pendingPlan,
                currentPeriodEnd,
                pending.otherUserPhone,
                pending.pictureShareEnabled,
                {
                  recipientName: pending.recipientName ?? null,
                  recipientEmail: pending.recipientEmail ?? null,
                  emergencyBypassEnabled: pending.emergencyBypassEnabled,
                  rewriteTone: pending.rewriteTone,
                  receivingHoursStart: pending.receivingHoursStart ?? null,
                  receivingHoursEnd: pending.receivingHoursEnd ?? null,
                  timezone: pending.timezone ?? null,
                  children: pending.children ?? [],
                }
              );
              if (channelId) {
                await PendingChannelRequest.findByIdAndDelete(pending._id);
                console.log(
                  "[stripe webhook] invoice.paid: First channel materialised from pending setup",
                  { userId: user._id.toString(), channelId }
                );
              }
            } else {
              const channelId = await createFirstChannelForUser(
                user._id.toString(),
                subId,
                fallbackPlan,
                currentPeriodEnd
              );
              if (!channelId) {
                // Fallback: phone pool empty – create an orphaned subscription doc so checkout
                // polling resolves and the user can create their channel manually from the dashboard.
                await Subscription.create({
                  userId: user._id,
                  channelId: null,
                  stripeSubscriptionId: subId,
                  plan: fallbackPlan,
                  status: "active",
                  currentPeriodEnd,
                });
                console.log("[stripe webhook] invoice.paid: Fallback orphaned subscription doc created (no phone available)", {
                  userId: user._id.toString(),
                  plan: fallbackPlan,
                });
              }
            }
          }
        } else {
          console.warn("[stripe webhook] invoice.paid: skipped creating Subscription (no user)");
        }

        // Create subsequent channels from pending requests (user paid for extra channel quantity)
        if (user) {
          const corePriceId = process.env.STRIPE_PRICE_CORE;
          const coreItem = corePriceId
            ? sub.items.data.find((item) => item.price.id === corePriceId)
            : null;
          const stripeQuantity = typeof coreItem?.quantity === "number" ? coreItem.quantity : 0;
          const channelCount = await Channel.countDocuments({
            users: user._id,
            state: { $in: ["active", "trial"] },
          });
          const toCreate = Math.max(0, stripeQuantity - channelCount);
          if (toCreate > 0) {
            const pendings = await PendingChannelRequest.find({ userId: user._id })
              .sort({ createdAt: 1 })
              .limit(toCreate)
              .lean();
            for (const p of pendings) {
              // Per-pending-channel plan reflects the addon flag of THAT
              // channel — not the parent Stripe sub's aggregate.
              const pendingPlan: "core" | "picture_addon" = p.pictureShareEnabled
                ? "picture_addon"
                : "core";
              const channelId = await createSubsequentChannelForUser(
                user._id.toString(),
                subId,
                pendingPlan,
                currentPeriodEnd,
                p.otherUserPhone,
                p.pictureShareEnabled,
                {
                  recipientName: p.recipientName ?? null,
                  recipientEmail: p.recipientEmail ?? null,
                  emergencyBypassEnabled: p.emergencyBypassEnabled,
                  rewriteTone: p.rewriteTone,
                  receivingHoursStart: p.receivingHoursStart ?? null,
                  receivingHoursEnd: p.receivingHoursEnd ?? null,
                  timezone: p.timezone ?? null,
                  children: p.children ?? [],
                }
              );
              if (channelId) {
                await PendingChannelRequest.findByIdAndDelete(p._id);
                console.log("[stripe webhook] invoice.paid: Subsequent channel created from pending", {
                  userId: user._id.toString(),
                  channelId,
                });
              }
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = getInvoiceSubscriptionId(invoice);
        if (!subId) break;

        const subDocs = await Subscription.find({ stripeSubscriptionId: subId }).lean();
        await Subscription.updateMany(
          { stripeSubscriptionId: subId },
          { $set: { status: "past_due" } }
        );

        // Per spec (milestone.txt:14): failed payments must move channels to
        // view-only. Previously this only marked the Subscription doc past_due,
        // so the channel stayed sendable until the next webhook cycle.
        const channelIds = subDocs
          .map((s) => s.channelId)
          .filter((id): id is mongoose.Types.ObjectId => id != null);
        if (channelIds.length > 0) {
          await Channel.updateMany(
            { _id: { $in: channelIds }, state: { $nin: ["closed"] } },
            { $set: { state: "view_only" } }
          );
          for (const channelId of channelIds) {
            await AuditLog.create({
              action: "channel_payment_failed_view_only",
              channelId,
              metadata: {
                stripeSubscriptionId: subId,
                stripeInvoiceId: invoice.id ?? null,
              },
            });
          }
        }

        // A proration invoice for a "new channel" can fail too. Without
        // intervention the PendingChannelRequest sits forever and the
        // CreateChannelModal spins indefinitely. Record the failure with the
        // Stripe-hosted invoice URL so the client can offer the user a way to
        // enter a new card and pay (the pending stays so the webhook can
        // create the channel once invoice.paid fires for that same invoice).
        const customerId = invoice.customer as string | null;
        const hostedInvoiceUrl = (invoice as Stripe.Invoice & { hosted_invoice_url?: string | null })
          .hosted_invoice_url ?? null;
        if (customerId) {
          const user = await User.findOne({ stripeCustomerId: customerId }).lean();
          if (user) {
            await AuditLog.create({
              action: "channel_creation_payment_failed",
              actorUserId: user._id,
              metadata: {
                stripeSubscriptionId: subId,
                stripeInvoiceId: invoice.id ?? null,
                hostedInvoiceUrl,
              },
            });
            console.log("[stripe webhook] invoice.payment_failed: recorded failure", {
              userId: user._id.toString(),
              hostedInvoiceUrl: hostedInvoiceUrl ? "present" : "missing",
            });
          }
        }

        console.log("[stripe webhook] invoice.payment_failed", {
          subId,
          subDocCount: subDocs.length,
          channelsMoved: channelIds.length,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        // Standalone Picture Sharing add-on sub reached its scheduled end
        // (#82): switch the add-on off — do NOT move the channel to view-only
        // (the core sub is unaffected).
        if (subscription.metadata?.scenario === "picture_addon") {
          await Subscription.updateMany(
            { stripeSubscriptionId: subscription.id },
            { $set: { status: "canceled", cancelAtPeriodEnd: false } }
          );
          const channelId = subscription.metadata?.channelId;
          if (channelId) {
            await Channel.updateOne(
              { _id: channelId },
              {
                $set: {
                  pictureShareEnabled: false,
                  pictureAddonPurchasedBy: null,
                  pictureShareRemoveAt: null,
                },
              }
            );
            await AuditLog.create({
              action: "picture_sharing_removed",
              channelId: new mongoose.Types.ObjectId(channelId),
              metadata: { stripeSubscriptionId: subscription.id, reason: "addon_sub_period_end" },
            });
          }
          console.log("[stripe webhook] picture_addon sub deleted — add-on switched off", {
            subscriptionId: subscription.id,
            channelId,
          });
          break;
        }

        const subDocs = await Subscription.find({
          stripeSubscriptionId: subscription.id,
        });
        console.log("[stripe webhook] customer.subscription.deleted", {
          subscriptionId: subscription.id,
          subDocCount: subDocs.length,
        });
        if (subDocs.length > 0) {
          await Subscription.updateMany(
            { stripeSubscriptionId: subscription.id },
            { $set: { status: "canceled" } }
          );
          const channelIds = subDocs
            .map((s) => s.channelId)
            .filter((id): id is mongoose.Types.ObjectId => id != null);
          if (channelIds.length > 0) {
            await Channel.updateMany(
              { _id: { $in: channelIds } },
              { $set: { state: "view_only" } }
            );
            console.log("[stripe webhook] customer.subscription.deleted: channels set to view_only", {
              channelIds: channelIds.map((id) => id.toString()),
            });
          }
        }
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const scenario = session.metadata?.scenario;
        const customerId = session.customer as string | null;

        // Setup-mode Checkout for an add-channel flow when the customer had
        // no default PM on file. Attach the collected PM as default, then
        // bump the subscription quantity — the resulting invoice auto-pays
        // and invoice.paid creates the channel from the pending request.
        if (session.mode === "setup" && scenario === "add_channel") {
          const setupIntentId = session.setup_intent as string | null;
          const userId = session.metadata?.userId;
          const pictureShareEnabled =
            session.metadata?.pictureShareEnabled === "1";

          if (!setupIntentId || !customerId || !userId) {
            console.warn(
              "[stripe webhook] checkout.session.completed (setup): missing setup_intent, customer, or userId"
            );
            break;
          }

          const stripe = getStripe();
          const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
          const paymentMethodId =
            typeof setupIntent.payment_method === "string"
              ? setupIntent.payment_method
              : setupIntent.payment_method?.id;

          if (!paymentMethodId) {
            console.warn(
              "[stripe webhook] checkout.session.completed (setup): no payment method on setup intent",
              { setupIntentId }
            );
            break;
          }

          await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
          });

          try {
            await updateSubscriptionForNewChannel(userId, pictureShareEnabled);
          } catch (err) {
            console.error(
              "[stripe webhook] checkout.session.completed (setup): subscription update failed",
              err
            );
          }

          await AuditLog.create({
            action: "payment_method_attached_via_checkout",
            actorUserId: new mongoose.Types.ObjectId(userId),
            metadata: {
              setupIntentId,
              paymentMethodId,
              pictureShareEnabled,
            },
          });
          break;
        }

        const sessionSubscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        // Subscription-mode Checkout for signup: customer.subscription.created
        // and invoice.paid handle activation. We additionally set the
        // customer-level default payment method here (#83).
        if (session.mode === "subscription" && scenario === "signup") {
          console.log("[stripe webhook] signup checkout completed", {
            customerId: customerId?.slice(0, 20) + "...",
            sessionId: session.id,
          });
          if (customerId && sessionSubscriptionId) {
            const stripe = getStripe();
            const sub = await stripe.subscriptions.retrieve(sessionSubscriptionId);
            await setCustomerDefaultPMFromSub(stripe, customerId, sub);
          }
        }

        // Subscription-mode Checkout for a standalone Picture Sharing add-on
        // (#81): the joining user paid for their own add-on. Enable it now
        // (idempotent with invoice.paid) and set their customer default PM.
        if (session.mode === "subscription" && scenario === "picture_addon") {
          console.log("[stripe webhook] picture_addon checkout completed", {
            customerId: customerId?.slice(0, 20) + "...",
            channelId: session.metadata?.channelId,
          });
          if (customerId && sessionSubscriptionId) {
            const stripe = getStripe();
            const sub = await stripe.subscriptions.retrieve(sessionSubscriptionId);
            await enablePictureAddonFromStripe(sub);
            await setCustomerDefaultPMFromSub(stripe, customerId, sub);
          }
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const userId = paymentIntent.metadata?.userId;
        const planName = (paymentIntent.metadata?.planName as string) || "";
        console.log("[stripe webhook] payment_intent.succeeded", {
          paymentIntentId: paymentIntent.id,
          metadataUserId: userId ?? null,
          metadataPlanName: planName || null,
        });
        if (!userId) {
          console.warn("[stripe webhook] payment_intent.succeeded: no userId in metadata, skipping");
          break;
        }
        const stripeSubscriptionId = paymentIntent.id;
        const existing = await Subscription.findOne({ stripeSubscriptionId });
        if (existing) {
          console.log("[stripe webhook] payment_intent.succeeded: Subscription already exists", {
            stripeSubscriptionId,
          });
          break;
        }
        const plan =
          planName.toLowerCase().includes("picture") || planName === "picture_addon"
            ? "picture_addon"
            : "core";
        const currentPeriodEnd = new Date();
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
        const created = await Subscription.create({
          userId: new mongoose.Types.ObjectId(userId),
          channelId: null,
          stripeSubscriptionId,
          plan,
          status: "active",
          currentPeriodEnd,
        });
        console.log("[stripe webhook] payment_intent.succeeded: Subscription created", {
          subDocId: created._id.toString(),
          userId,
          plan,
        });
        break;
      }

      case "customer.subscription.updated": {
        // Sync currentPeriodEnd always (billing period shifts on renewal).
        //
        // cancelAtPeriodEnd is now a per-channel local flag managed by our own
        // cancel/uncancel API routes. We NEVER clear it from this webhook —
        // doing so would wipe per-channel cancellations every time a quantity
        // change fires customer.subscription.updated.
        //
        // Exception: when Stripe itself marks the whole subscription for
        // cancellation (e.g. via the Stripe portal) we propagate that flag to
        // all docs, since that's a wholesale cancellation the user initiated
        // outside our UI.
        const subscription = event.data.object as Stripe.Subscription;
        const cape = !!subscription.cancel_at_period_end;
        const cpe = typeof (subscription as any).current_period_end === "number"
          ? new Date((subscription as any).current_period_end * 1000)
          : null;

        const update: Record<string, unknown> = {};
        if (cpe) update.currentPeriodEnd = cpe;
        // Only propagate cancellation TO local docs, never clear it via webhook.
        if (cape) update.cancelAtPeriodEnd = true;

        if (Object.keys(update).length > 0) {
          const res = await Subscription.updateMany(
            { stripeSubscriptionId: subscription.id },
            { $set: update }
          );
          console.log("[stripe webhook] customer.subscription.updated: synced", {
            subscriptionId: subscription.id,
            cancelAtPeriodEnd: cape,
            docsUpdated: res.modifiedCount,
          });
        }
        break;
      }

      default:
        console.log("[stripe webhook] Unhandled event type", { type: event.type });
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[stripe webhook] Handler error", {
      message: err.message,
      stack: err.stack,
      eventType: event?.type,
      eventId: event?.id,
    });
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}
