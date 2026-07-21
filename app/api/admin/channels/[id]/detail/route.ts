import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import connectDB from "@/lib/db/connect";
import { Channel, ChannelViewer, User, Subscription } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { PLACEHOLDER_PHONE } from "@/lib/services/createFirstChannelForUser";
import type { Types } from "mongoose";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2025-01-27.acacia" as any });
}

/**
 * Super admin: full detail view of a channel.
 * Bundles participants, structured subscription state, both users' receiving
 * hours, billing visibility, and (placeholder) linked children for the admin
 * channel detail page.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Channel id required" }, { status: 400 });

  try {
    await connectDB();

    const channel = await Channel.findById(id).lean();
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    const users = await User.find({
      _id: { $in: channel.users as Types.ObjectId[] },
    })
      .select("phone email name receivingHoursStart receivingHoursEnd timezone")
      .lean();

    // channel.users is [creator (User A), recipient (User B)] by convention
    // (see createChannelBetweenUsers / createSubsequentChannelForUser, where
    // the inviting user's id is pushed first). User.find() does not preserve
    // that order, so re-sort here so participants[0] is always the creator —
    // the heading and pair label below depend on it (M4 #87).
    const orderById = new Map(
      (channel.users as Types.ObjectId[]).map((id, i) => [id.toString(), i])
    );
    users.sort(
      (a, b) =>
        (orderById.get((a._id as Types.ObjectId).toString()) ?? 0) -
        (orderById.get((b._id as Types.ObjectId).toString()) ?? 0)
    );

    const participants = users.map((u) => {
      const ux = u as unknown as {
        _id: Types.ObjectId;
        phone?: string;
        email?: string | null;
        name?: string | null;
        receivingHoursStart?: string | null;
        receivingHoursEnd?: string | null;
        timezone?: string | null;
      };
      return {
        userId: ux._id.toString(),
        name: ux.name ?? "",
        email: ux.email ?? "",
        phone: ux.phone ?? "",
        receivingHoursStart: ux.receivingHoursStart ?? null,
        receivingHoursEnd: ux.receivingHoursEnd ?? null,
        timezone: ux.timezone ?? "Europe/London",
        // Internal-only: legacy auto-created first channels pair the creator
        // with a global placeholder "other" user. Not surfaced to the client,
        // but used to compose the pair label and the viewer consent state.
        isPlaceholder: (ux.phone ?? "") === PLACEHOLDER_PHONE,
      };
    });

    // Compose the channel heading / pair label, creator first (M4 #87).
    // Mirrors the admin list's formatPair: drop the placeholder "other" user
    // for legacy single-parent channels so the label reads as just the creator.
    const nameOfParticipant = (p: { name: string; phone: string }) =>
      (p.name && p.name.trim()) || (p.phone ? p.phone : "Unnamed");
    const realParticipants = participants.filter((p) => !p.isPlaceholder);
    const participantsLabel =
      realParticipants.length >= 2
        ? `${nameOfParticipant(realParticipants[0])} and ${nameOfParticipant(realParticipants[1])}`
        : realParticipants.length === 1
          ? nameOfParticipant(realParticipants[0])
          : (channel.name && channel.name.trim()) || "Unnamed";

    const subscription = channel.subscriptionId
      ? await Subscription.findById(channel.subscriptionId).lean()
      : null;

    // Fetch Stripe invoice history for failed-payment visibility
    type BillingHistory = {
      lastPaymentStatus: string | null;
      lastPaymentDate: string | null;
      failedCount: number;
    };
    let billingHistory: BillingHistory = { lastPaymentStatus: null, lastPaymentDate: null, failedCount: 0 };
    if (subscription?.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = getStripe();
        const invoices = await stripe.invoices.list({
          subscription: subscription.stripeSubscriptionId,
          limit: 12,
          expand: [],
        });
        const items = invoices.data;
        if (items.length > 0) {
          const latest = items[0];
          billingHistory.lastPaymentStatus = latest.status ?? null;
          billingHistory.lastPaymentDate = latest.created
            ? new Date(latest.created * 1000).toISOString()
            : null;
        }
        billingHistory.failedCount = items.filter(
          (inv) => inv.status === "void" ||
            (inv.status === "open" && inv.attempt_count > 0)
        ).length;
      } catch {
        // Non-fatal — Stripe may not be configured in test environments
      }
    }

    // Spec-shaped subscription label per milestone.txt:39:
    //   Trial / Active SMS only / Active SMS plus Picture Sharing / View-only / Closed
    let subscriptionLabel: string;
    switch (channel.state) {
      case "trial":
        subscriptionLabel = "Trial";
        break;
      case "active":
        subscriptionLabel = channel.pictureShareEnabled
          ? "Active SMS plus Picture Sharing"
          : "Active SMS only";
        break;
      case "view_only":
        subscriptionLabel = "View-only";
        break;
      case "closed":
        subscriptionLabel = "Closed";
        break;
      default:
        subscriptionLabel = String(channel.state);
    }

    // Per Craig 2026-05-22 (item 6): admin needs per-channel visibility on
    // attached viewers and their consent state for operational/compliance
    // purposes. Read-only; no control surface here.
    const channelViewers = await ChannelViewer.find({ channelId: id, status: "active" })
      .populate("userId", "name email")
      .lean();
    const viewerRows = channelViewers.map((v) => {
      const u = v.userId as unknown as { _id?: Types.ObjectId; name?: string | null; email?: string };
      const invitingParticipant = participants.find((p) => p.userId === v.grantedByUserId.toString());
      const otherParticipant = participants.find((p) => p.userId !== v.grantedByUserId.toString());
      // Consent state machine (ChannelViewer.otherParentApproved, driven by the
      // viewer_other_parent_approved / _restricted audit actions):
      //   approved        → both parents have opted in    → "Both parents approved"
      //   not approved yet → other parent has not opted in → "Awaiting <name>"
      //   no real other parent (placeholder / single-parent channel) →
      //                      viewer just has the inviting parent's default
      //                      scope → "Default access only"
      let consentLabel: string;
      if (v.otherParentApproved) {
        consentLabel = "Both parents approved";
      } else if (otherParticipant && !otherParticipant.isPlaceholder) {
        consentLabel = otherParticipant.name
          ? `Awaiting ${otherParticipant.name}`
          : "Awaiting the other parent";
      } else {
        consentLabel = "Default access only";
      }
      return {
        id: v._id.toString(),
        userId: u._id?.toString() ?? "",
        name: (u.name ?? null) as string | null,
        email: u.email ?? "",
        invitingParentUserId: v.grantedByUserId.toString(),
        invitingParentName: invitingParticipant?.name ?? null,
        otherParentApproved: !!v.otherParentApproved,
        consentLabel,
        grantedAt: v.createdAt ? new Date(v.createdAt).toISOString() : null,
        lastAccessedAt: v.lastAccessedAt ? new Date(v.lastAccessedAt).toISOString() : null,
      };
    });

    return NextResponse.json({
      channelId: id,
      channelName: channel.name ?? "",
      // Both participants, creator first, for the detail heading (M4 #87).
      participantsLabel,
      channelPhone: channel.clanchaNumber,
      state: channel.state,
      subscriptionLabel,
      pictureShareEnabled: !!channel.pictureShareEnabled,
      emergencyBypassEnabled: !!channel.emergencyBypassEnabled,
      // Drop the internal isPlaceholder flag from the client payload.
      participants: participants.map((p) => {
        const rest = { ...p } as Partial<typeof p>;
        delete rest.isPlaceholder;
        return rest;
      }),
      viewers: viewerRows,
      subscription: subscription
        ? {
            id: subscription._id.toString(),
            stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
            name: subscription.name ?? null,
            plan: subscription.plan,
            status: subscription.status,
            cancelAtPeriodEnd: !!(subscription as any).cancelAtPeriodEnd,
            currentPeriodEnd: subscription.currentPeriodEnd
              ? new Date(subscription.currentPeriodEnd).toISOString()
              : null,
          }
        : null,
      billingHistory,
      linkedChildren: ((channel as any).linkedChildren ?? []).map(
        (c: { _id: { toString(): string }; name: string; dob?: string | null }, i: number) => ({
          id: c._id?.toString() ?? String(i),
          name: c.name,
          dob: c.dob ?? undefined,
        })
      ),
      createdAt: channel.createdAt
        ? new Date(channel.createdAt).toISOString()
        : null,
    });
  } catch (error) {
    console.error("[admin/channels/[id]/detail] error:", error);
    return NextResponse.json({ error: "Failed to fetch channel detail" }, { status: 500 });
  }
}

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

  try {
    const body = await request.json();
    const { linkedChildren } = body as {
      linkedChildren: Array<{ name: string; dob?: string }>;
    };

    if (!Array.isArray(linkedChildren)) {
      return NextResponse.json({ error: "linkedChildren must be an array" }, { status: 400 });
    }

    for (const child of linkedChildren) {
      if (typeof child.name !== "string" || child.name.trim() === "") {
        return NextResponse.json({ error: "Each child must have a name" }, { status: 400 });
      }
    }

    await connectDB();

    const updated = await Channel.findByIdAndUpdate(
      id,
      { $set: { linkedChildren: linkedChildren.map((c) => ({ name: c.name.trim(), dob: c.dob ?? null })) } },
      { new: true }
    ).lean();

    if (!updated) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    return NextResponse.json({
      linkedChildren: ((updated as any).linkedChildren ?? []).map(
        (c: { _id: { toString(): string }; name: string; dob?: string | null }, i: number) => ({
          id: c._id?.toString() ?? String(i),
          name: c.name,
          dob: c.dob ?? undefined,
        })
      ),
    });
  } catch (error) {
    console.error("[admin/channels/[id]/detail PATCH] error:", error);
    return NextResponse.json({ error: "Failed to update children" }, { status: 500 });
  }
}
