import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, User, UserChannelPreferences, Subscription } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import {
  toggleChannelPictureSharing,
  createPictureAddonCheckout,
  resolvePicturePayerId,
} from "@/lib/services/billing";
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
    const isMember = (channel.users as Types.ObjectId[]).some(
      (id) => id.toString() === userIdStr
    );

    if (!isMember && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const targetUserIdStr = isAdmin && !isMember ? (channel.users[0] as Types.ObjectId).toString() : userIdStr;

    const prefs = await UserChannelPreferences.findOne({
      userId: targetUserIdStr,
      channelId,
    }).lean();

    const otherUserId = (channel.users as Types.ObjectId[]).find(
      (id) => id.toString() !== targetUserIdStr
    );
    const otherUser = otherUserId
      ? await User.findById(otherUserId).select("phone name").lean()
      : null;

    const subscription = channel.subscriptionId
      ? await Subscription.findById(channel.subscriptionId).lean()
      : await Subscription.findOne({
          userId: targetUserIdStr,
          status: "active",
        })
          .sort({ createdAt: -1 })
          .lean();

    const planLabels: Record<string, string> = {
      core: "Core",
      picture_addon: "Premium",
    };

    const user = await User.findById(targetUserIdStr)
      .select("receivingHoursStart receivingHoursEnd timezone activeStripeSubscriptionId")
      .lean();

    // Role-aware Picture Sharing context (#100/#101): who is billed for the
    // add-on, and — for the viewer enabling it — whether it would attach to
    // their existing core subscription (creator) or be a standalone sub
    // (joining user, charged on their own customer).
    const picturePayerId = channel.pictureShareEnabled
      ? await resolvePicturePayerId(channel as any)
      : null;
    const pictureAddonPurchasedByMe = picturePayerId
      ? picturePayerId === targetUserIdStr
      : false;
    const pictureAddonPayerName =
      picturePayerId && picturePayerId !== targetUserIdStr
        ? otherUser?.name?.trim() || "the other user"
        : null;
    const pictureAddonAttachesToCore = !!(user as { activeStripeSubscriptionId?: string })
      ?.activeStripeSubscriptionId;

    let participants: Array<{
      userId: string;
      name: string;
      phone: string;
      receivingHoursStart: string | null;
      receivingHoursEnd: string | null;
      timezone: string;
    }> | undefined;
    if (isAdmin) {
      const channelUsers = await User.find({
        _id: { $in: channel.users as Types.ObjectId[] },
      })
        .select("phone name receivingHoursStart receivingHoursEnd timezone")
        .lean();
      participants = channelUsers.map((u: any) => ({
        userId: u._id.toString(),
        name: u.name ?? "",
        phone: u.phone ?? "",
        receivingHoursStart: u.receivingHoursStart ?? null,
        receivingHoursEnd: u.receivingHoursEnd ?? null,
        timezone: u.timezone ?? "Europe/London",
      }));
    }

    return NextResponse.json({
      channelId,
      state: channel.state,
      channelName: channel.name ?? "",
      channelPhone: channel.clanchaNumber,
      participant: otherUser
        ? { phone: otherUser.phone, name: otherUser.name ?? "" }
        : null,
      ...(participants ? { participants } : {}),
      subscriptionName:
        subscription?.name ?? planLabels[subscription?.plan ?? "core"] ?? "Core",
      subscriptionExpiry: subscription?.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toISOString()
        : null,
      rewriteTone: prefs?.rewriteTone ?? "calm_clear",
      receivingHoursStart: (user as any)?.receivingHoursStart ?? null,
      receivingHoursEnd: (user as any)?.receivingHoursEnd ?? null,
      timezone: (user as any)?.timezone ?? "Europe/London",
      emergencyBypassEnabled: channel.emergencyBypassEnabled,
      pictureShareEnabled: channel.pictureShareEnabled,
      pictureShareRemoveAt: (channel as any).pictureShareRemoveAt
        ? new Date((channel as any).pictureShareRemoveAt).toISOString()
        : null,
      pictureAddonPurchasedByMe,
      pictureAddonPayerKnown: !!picturePayerId,
      pictureAddonPayerName,
      pictureAddonAttachesToCore,
      linkedChildren: ((channel as any).linkedChildren ?? []).map(
        (c: { name?: string; dob?: string | null }) => ({
          name: c.name ?? "",
          dob: c.dob ?? null,
        })
      ),
    });
  } catch (error) {
    console.error("channels [id]/settings GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
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
    const body = await request.json();
    const {
      channelName,
      rewriteTone,
      receivingHoursStart,
      receivingHoursEnd,
      timezone,
      emergencyBypassEnabled,
      subscriptionName,
      participantPhone,
      participantUpdates,
      pictureShareEnabled,
      linkedChildren,
    } = body;

    await connectDB();

    const channel = await Channel.findById(channelId);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const userIdStr = payload.userId;
    const isAdmin = payload.role === "admin" || payload.role === "super_admin";
    const isMember = channel.users.some((id) => id.toString() === userIdStr);

    if (!isMember && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (channel.state === "view_only" || channel.state === "closed") {
      return NextResponse.json(
        { error: "This channel is read-only and cannot be modified." },
        { status: 403 }
      );
    }

    const targetUserIdStr = isAdmin && !isMember ? (channel.users[0] as Types.ObjectId).toString() : userIdStr;

    const channelUpdate: any = {};
    const channelUnset: any = {};

    if (channelName !== undefined) {
      channelUpdate.name = typeof channelName === "string" ? channelName.trim() || null : null;
    }

    // Linked children — either channel member (or admin) may edit. Strip
    // empty rows, trim names, and bound the list so the UI doesn't smuggle in
    // a 10k-row array.
    if (linkedChildren !== undefined) {
      if (!Array.isArray(linkedChildren)) {
        return NextResponse.json(
          { error: "linkedChildren must be an array" },
          { status: 400 }
        );
      }
      const MAX_CHILDREN = 12;
      const cleaned: Array<{ name: string; dob: string | null }> = [];
      for (const c of linkedChildren) {
        if (!c || typeof c !== "object") continue;
        const name = typeof c.name === "string" ? c.name.trim() : "";
        if (!name) continue;
        const dob = typeof c.dob === "string" && c.dob.trim() ? c.dob.trim() : null;
        cleaned.push({ name, dob });
        if (cleaned.length >= MAX_CHILDREN) break;
      }
      channelUpdate.linkedChildren = cleaned;
    }
    
    // User profile updates
    const userUpdate: any = {};
    if (receivingHoursStart !== undefined) {
      userUpdate.receivingHoursStart = receivingHoursStart;
    }
    if (receivingHoursEnd !== undefined) {
      userUpdate.receivingHoursEnd = receivingHoursEnd;
    }
    if (timezone !== undefined) {
      userUpdate.timezone = timezone;
    }

    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(targetUserIdStr, { $set: userUpdate });
    }

    if (isAdmin && Array.isArray(participantUpdates)) {
      const channelUserIds = (channel.users as Types.ObjectId[]).map((id) => id.toString());
      for (const upd of participantUpdates) {
        if (!upd || typeof upd.userId !== "string") continue;
        if (!channelUserIds.includes(upd.userId)) continue;
        const fields: Record<string, unknown> = {};
        if (upd.receivingHoursStart !== undefined) fields.receivingHoursStart = upd.receivingHoursStart;
        if (upd.receivingHoursEnd !== undefined) fields.receivingHoursEnd = upd.receivingHoursEnd;
        if (Object.keys(fields).length > 0) {
          await User.findByIdAndUpdate(upd.userId, { $set: fields });
        }
      }
    }

    if (typeof emergencyBypassEnabled === "boolean") {
      channelUpdate.emergencyBypassEnabled = emergencyBypassEnabled;
    }

    // Mid-cycle picture-sharing toggle (#81/#82). Routed through billing.ts:
    //  - enable + toggler has a sub → line item added, charged today.
    //  - enable + toggler has NO sub (joining user) → returns
    //    "checkout_required"; we hand back a Stripe Checkout URL for them to
    //    pay on their own customer. The flag flips via the webhook.
    //  - disable → scheduled removal at period end; access kept until then.
    let pictureCheckoutUrl: string | undefined;
    let pictureRemoveAt: Date | null | undefined;
    // Also trigger when pictureShareEnabled is true but a removal is already scheduled
    // (user re-enables before period end) — channel.pictureShareEnabled stays true during
    // the scheduled-removal window, so the simple !== guard would silently skip it.
    const pictureToggleNeeded =
      typeof pictureShareEnabled === "boolean" &&
      (pictureShareEnabled !== channel.pictureShareEnabled ||
        (pictureShareEnabled === true && !!(channel as any).pictureShareRemoveAt));
    if (pictureToggleNeeded) {
      try {
        const result = await toggleChannelPictureSharing(targetUserIdStr, channelId, pictureShareEnabled);
        if (result.kind === "checkout_required") {
          pictureCheckoutUrl = await createPictureAddonCheckout(targetUserIdStr, channelId);
        } else if (result.kind === "disabled") {
          pictureRemoveAt = result.removeAt;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to toggle picture sharing";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    const updateOps: any = {};
    if (Object.keys(channelUpdate).length > 0) updateOps.$set = channelUpdate;
    if (Object.keys(channelUnset).length > 0) updateOps.$unset = channelUnset;

    if (Object.keys(updateOps).length > 0) {
      await Channel.findByIdAndUpdate(channelId, updateOps);
    }

    if (subscriptionName !== undefined) {
      const sub = channel.subscriptionId
        ? await Subscription.findById(channel.subscriptionId)
        : await Subscription.findOne({
            userId: targetUserIdStr,
            status: "active",
          }).sort({ createdAt: -1 });
      if (sub) {
        sub.name = typeof subscriptionName === "string" ? subscriptionName.trim() || undefined : undefined;
        await sub.save();
      }
    }

    if (rewriteTone !== undefined) {
      if (!["calm_clear", "firm_fair"].includes(rewriteTone)) {
        return NextResponse.json(
          { error: "Invalid rewriteTone" },
          { status: 400 }
        );
      }
      await UserChannelPreferences.findOneAndUpdate(
        { userId: targetUserIdStr, channelId },
        { $set: { rewriteTone } },
        { upsert: true }
      );
    }



    if (timezone !== undefined) {
      // Handled above in userUpdate
    }



    if (participantPhone !== undefined) {
      const newPhone = typeof participantPhone === "string" ? participantPhone.trim() : null;
      if (!newPhone) {
        return NextResponse.json(
          { error: "participantPhone is required when provided" },
          { status: 400 }
        );
      }
      const otherUserId = (channel.users as Types.ObjectId[]).find(
        (id) => id.toString() !== targetUserIdStr
      );
      if (otherUserId) {
        const existingWithPhone = await User.findOne({
          phone: newPhone,
          _id: { $ne: otherUserId },
        });
        if (existingWithPhone) {
          return NextResponse.json(
            { error: "Phone number is already in use by another account" },
            { status: 400 }
          );
        }
        await User.findByIdAndUpdate(otherUserId, { $set: { phone: newPhone } });
      }
    }

    const prefs = await UserChannelPreferences.findOne({
      userId: targetUserIdStr,
      channelId,
    }).lean();
    const ch = await Channel.findById(channelId).lean();
    const updatedUser = await User.findById(targetUserIdStr)
      .select("receivingHoursStart receivingHoursEnd timezone activeStripeSubscriptionId")
      .lean();

    const otherUserId = (ch!.users as Types.ObjectId[]).find(
      (id) => id.toString() !== targetUserIdStr
    );
    const otherUser = otherUserId
      ? await User.findById(otherUserId).select("phone name").lean()
      : null;

    let participants: Array<{
      userId: string;
      name: string;
      phone: string;
      receivingHoursStart: string | null;
      receivingHoursEnd: string | null;
      timezone: string;
    }> | undefined;
    if (isAdmin) {
      const channelUsers = await User.find({
        _id: { $in: ch!.users as Types.ObjectId[] },
      })
        .select("phone name receivingHoursStart receivingHoursEnd timezone")
        .lean();
      participants = channelUsers.map((u: any) => ({
        userId: u._id.toString(),
        name: u.name ?? "",
        phone: u.phone ?? "",
        receivingHoursStart: u.receivingHoursStart ?? null,
        receivingHoursEnd: u.receivingHoursEnd ?? null,
        timezone: u.timezone ?? "Europe/London",
      }));
    }
    const subscription = ch!.subscriptionId
      ? await Subscription.findById(ch!.subscriptionId).lean()
      : await Subscription.findOne({
          userId: targetUserIdStr,
          status: "active",
        })
          .sort({ createdAt: -1 })
          .lean();
    const planLabels: Record<string, string> = {
      core: "Core",
      picture_addon: "Premium",
    };

    const picturePayerId = ch!.pictureShareEnabled
      ? await resolvePicturePayerId(ch as any)
      : null;
    const pictureAddonPurchasedByMe = picturePayerId
      ? picturePayerId === targetUserIdStr
      : false;
    const pictureAddonPayerName =
      picturePayerId && picturePayerId !== targetUserIdStr
        ? otherUser?.name?.trim() || "the other user"
        : null;
    const pictureAddonAttachesToCore = !!(updatedUser as { activeStripeSubscriptionId?: string })
      ?.activeStripeSubscriptionId;

    return NextResponse.json({
      channelId,
      channelName: ch!.name ?? "",
      channelPhone: ch!.clanchaNumber,
      participant: otherUser
        ? { phone: otherUser.phone, name: otherUser.name ?? "" }
        : null,
      ...(participants ? { participants } : {}),
      subscriptionName:
        subscription?.name ?? planLabels[subscription?.plan ?? "core"] ?? "Core",
      subscriptionExpiry: subscription?.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toISOString()
        : null,
      rewriteTone: prefs?.rewriteTone ?? "calm_clear",
      receivingHoursStart: (updatedUser as any)?.receivingHoursStart ?? null,
      receivingHoursEnd: (updatedUser as any)?.receivingHoursEnd ?? null,
      timezone: (updatedUser as any)?.timezone ?? "Europe/London",
      emergencyBypassEnabled: ch!.emergencyBypassEnabled,
      pictureShareEnabled: ch!.pictureShareEnabled,
      pictureShareRemoveAt: (ch as any).pictureShareRemoveAt
        ? new Date((ch as any).pictureShareRemoveAt).toISOString()
        : null,
      pictureAddonPurchasedByMe,
      pictureAddonPayerKnown: !!picturePayerId,
      pictureAddonPayerName,
      pictureAddonAttachesToCore,
      // Present when the joining user must pay for their own add-on — the
      // client redirects to Stripe Checkout (#81).
      ...(pictureCheckoutUrl ? { pictureCheckoutUrl } : {}),
      // Present when the add-on was scheduled for removal at period end (#82).
      ...(pictureRemoveAt ? { pictureRemoveAt: new Date(pictureRemoveAt).toISOString() } : {}),
      linkedChildren: ((ch as any).linkedChildren ?? []).map(
        (c: { name?: string; dob?: string | null }) => ({
          name: c.name ?? "",
          dob: c.dob ?? null,
        })
      ),
    });
  } catch (error) {
    console.error("channels [id]/settings PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
