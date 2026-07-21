import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import connectDB from "@/lib/db/connect";
import { User, Channel, Subscription } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import type { Types } from "mongoose";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia" as never,
});

/**
 * GET /api/billing/summary
 *
 * Returns the logged-in user's billing snapshot for the in-portal Billing
 * card. Mirrors what Stripe's customer portal would show, but inline so the
 * user doesn't have to open Stripe to see their next billing date / payment
 * method / recent invoices.
 *
 * Surfaces:
 *   - One row per channel subscription (channel name, plan, state, next bill)
 *   - Default payment method (brand + last4 + expiry) if a Stripe customer
 *     exists for the user
 *   - The 10 most recent invoices
 *
 * Stripe-side calls fail soft: if the user has no stripeCustomerId yet (e.g.
 * they're still in trial without payment), invoices/paymentMethod return
 * null and the UI degrades gracefully.
 */
export async function GET(_request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    await connectDB();

    const user = await User.findById(payload.userId)
      .select("_id stripeCustomerId")
      .lean();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Local subscriptions joined to channel names for display.
    const subs = await Subscription.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .lean();
    const channelIds = subs
      .map((s) => s.channelId)
      .filter((id): id is Types.ObjectId => !!id);
    const channels = await Channel.find({ _id: { $in: channelIds } })
      .select("_id name clanchaNumber pictureShareEnabled state")
      .lean();
    const channelMap = new Map(
      channels.map((c) => [c._id.toString(), c])
    );

    // Per Stripe Developer Handover (Doc 3 §3) the per-channel prices are
    // fixed: core £14.99/mo, picture add-on £4.99/mo. A "picture_addon"
    // local Subscription doc represents a channel that has BOTH core AND
    // add-on line items on the Stripe side — so its monthly cost is the
    // sum (£19.98), not just the add-on increment.
    const UNIT_AMOUNT_BY_PLAN: Record<string, number> = {
      core: 1499,
      picture_addon: 1499 + 499, // 1998 — core + add-on combined
    };

    const subscriptions = subs.map((s) => {
      const ch = s.channelId ? channelMap.get(s.channelId.toString()) : undefined;
      return {
        id: s._id.toString(),
        plan: s.plan,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: !!(s as { cancelAtPeriodEnd?: boolean }).cancelAtPeriodEnd,
        unitAmount: UNIT_AMOUNT_BY_PLAN[s.plan] ?? null,
        currency: "gbp",
        channel: ch
          ? {
              id: ch._id.toString(),
              name: ch.name ?? null,
              clanchaNumber: ch.clanchaNumber ?? null,
              state: ch.state ?? null,
              pictureShareEnabled: !!ch.pictureShareEnabled,
            }
          : null,
      };
    });

    // Stripe-side lookups — only meaningful if the user has a Stripe customer.
    let paymentMethod: {
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    } | null = null;
    let invoices: Array<{
      id: string;
      number: string | null;
      amount: number;
      currency: string;
      status: string;
      created: string;
      hostedUrl: string | null;
      pdfUrl: string | null;
    }> = [];
    let customerPortalUrl: string | null = null;

    if (user.stripeCustomerId) {
      try {
        const customer = await stripe.customers.retrieve(user.stripeCustomerId, {
          expand: ["invoice_settings.default_payment_method"],
        });
        if (customer && !("deleted" in customer)) {
          const pm = (customer.invoice_settings?.default_payment_method ??
            null) as Stripe.PaymentMethod | string | null;
          if (pm && typeof pm !== "string" && pm.card) {
            paymentMethod = {
              brand: pm.card.brand,
              last4: pm.card.last4,
              expMonth: pm.card.exp_month,
              expYear: pm.card.exp_year,
            };
          }
        }
      } catch (err) {
        console.error("[billing/summary] payment method fetch failed", err);
      }

      try {
        const invoiceList = await stripe.invoices.list({
          customer: user.stripeCustomerId,
          limit: 10,
        });
        invoices = invoiceList.data.map((inv) => ({
          id: inv.id,
          number: inv.number ?? null,
          amount: inv.amount_paid || inv.amount_due,
          currency: inv.currency,
          status: inv.status ?? "unknown",
          created: new Date(inv.created * 1000).toISOString(),
          hostedUrl: inv.hosted_invoice_url ?? null,
          pdfUrl: inv.invoice_pdf ?? null,
        }));
      } catch (err) {
        console.error("[billing/summary] invoice fetch failed", err);
      }

      try {
        const origin =
          process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
          _request.headers.get("origin") ||
          "https://example.com";
        const portal = await stripe.billingPortal.sessions.create({
          customer: user.stripeCustomerId,
          return_url: `${origin}/settings`,
        });
        customerPortalUrl = portal.url;
      } catch (err) {
        console.error("[billing/summary] portal session failed", err);
      }
    }

    return NextResponse.json({
      hasStripeCustomer: !!user.stripeCustomerId,
      paymentMethod,
      subscriptions,
      invoices,
      customerPortalUrl,
    });
  } catch (error) {
    console.error("billing/summary GET error:", error);
    return NextResponse.json({ error: "Failed to load billing" }, { status: 500 });
  }
}
