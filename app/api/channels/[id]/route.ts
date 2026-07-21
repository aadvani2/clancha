import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, User, Subscription } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { canAccessChannel } from "@/lib/auth/viewerAuth";
import type { Types } from "mongoose";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  const { id: channelId } = await params;
  if (!channelId) {
    return NextResponse.json({ error: "Channel ID required" }, { status: 400 });
  }

  try {
    await connectDB();

    const channel = await Channel.findById(channelId).lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const userIdStr = payload.userId;
    const isAdmin = payload.role === "admin" || payload.role === "super_admin";
    const memberIds = channel.users as Types.ObjectId[];
    const isMember = memberIds.some((id) => id.toString() === userIdStr);

    // Third-party viewers (read-only invitees) may read channel metadata so
    // their portal can render the header with BOTH parents' names (#41c/#41d).
    // Without this the GET 403'd for viewers, the channel page fell back to a
    // generic "Channel <id>" heading, and the post-signup redirect appeared to
    // hang (#41a). Viewers are never members — they only ever get the read-only
    // `base` shape below (display names only, no phone, no subscription block).
    let isViewer = false;
    if (!isMember && !isAdmin) {
      const access = await canAccessChannel(userIdStr, channelId);
      if (!access.canAccess) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      isViewer = access.isViewer;
    }

    // Resolve member display names once. Order mirrors the admin portal:
    // channel.users[0] is the creator, shown first.
    const memberUsers = await User.find({ _id: { $in: memberIds } })
      .select("_id name phone")
      .lean();
    const nameById = new Map<string, string | null>();
    const phoneById = new Map<string, string | null>();
    for (const u of memberUsers) {
      nameById.set(
        u._id.toString(),
        (typeof u.name === "string" && u.name.trim()) || null
      );
      phoneById.set(u._id.toString(), u.phone ?? null);
    }

    let otherUserPhone: string | null = null;
    let otherUserName: string | null = null;
    if (isViewer) {
      // Viewers observe BOTH parents, so the header shows both names (creator
      // first), like the admin portal. Phone is intentionally withheld.
      const both = memberIds
        .map((id) => nameById.get(id.toString()))
        .filter((n): n is string => !!n);
      otherUserName = both.length ? both.join(" & ") : null;
    } else {
      const targetUserIdStr =
        isAdmin && !isMember ? memberIds[0].toString() : userIdStr;
      const otherUserId = memberIds.find(
        (id) => id.toString() !== targetUserIdStr
      );
      if (otherUserId) {
        otherUserName = nameById.get(otherUserId.toString()) ?? null;
        otherUserPhone = phoneById.get(otherUserId.toString()) ?? null;
      }
    }

    const base = {
      id: channel._id.toString(),
      clanchaNumber: channel.clanchaNumber,
      name: channel.name ?? null,
      state: channel.state,
      pictureShareEnabled: channel.pictureShareEnabled,
      emergencyBypassEnabled: channel.emergencyBypassEnabled,
      otherUserPhone: otherUserPhone ? "***" + otherUserPhone.slice(-4) : null,
      otherUserName,
      createdAt: channel.createdAt,
      isMember,
    };

    if (isAdmin) {
      const participants = await User.find({ _id: { $in: channel.users as Types.ObjectId[] } })
        .select(
          "_id name phone email receivingHoursStart receivingHoursEnd timezone suspended role isPictureAddonEnabled activeStripeSubscriptionId"
        )
        .lean();

      let subscription: Record<string, unknown> | null = null;
      if (channel.subscriptionId) {
        const sub = await Subscription.findById(channel.subscriptionId)
          .select("status plan name currentPeriodEnd stripeSubscriptionId")
          .lean();
        if (sub) {
          subscription = {
            id: sub._id.toString(),
            status: sub.status,
            plan: sub.plan,
            name: sub.name ?? null,
            currentPeriodEnd: sub.currentPeriodEnd
              ? new Date(sub.currentPeriodEnd).toISOString()
              : null,
            stripeSubscriptionId: sub.stripeSubscriptionId ?? null,
          };
        }
      }

      return NextResponse.json({
        ...base,
        participants: participants.map((u) => ({
          id: u._id.toString(),
          name: u.name ?? null,
          phone: u.phone,
          email: u.email ?? null,
          role: u.role,
          suspended: !!(u as { suspended?: boolean }).suspended,
          receivingHoursStart: (u as { receivingHoursStart?: string | null }).receivingHoursStart ?? null,
          receivingHoursEnd: (u as { receivingHoursEnd?: string | null }).receivingHoursEnd ?? null,
          timezone: (u as { timezone?: string | null }).timezone ?? "Europe/London",
          isPictureAddonEnabled: !!(u as { isPictureAddonEnabled?: boolean }).isPictureAddonEnabled,
          hasActiveSubscription: !!(u as { activeStripeSubscriptionId?: string | null })
            .activeStripeSubscriptionId,
        })),
        subscription,
      });
    }

    return NextResponse.json(base);
  } catch (error) {
    console.error("channels [id] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch channel" }, { status: 500 });
  }
}
