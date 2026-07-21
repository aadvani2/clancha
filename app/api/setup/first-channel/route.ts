import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import connectDB from "@/lib/db/connect";
import { Channel, User, PendingChannelRequest } from "@/lib/db/models";

/**
 * Persist the prefilled-details payload for a new user's first channel.
 *
 * Creates a single PendingChannelRequest carrying recipient name, email,
 * children, receiving hours, emergency bypass, and tone. The signup-mode
 * Stripe Checkout (driven separately from this endpoint) doesn't carry the
 * channel data — instead, the invoice.paid webhook reads this pending and
 * materialises a fully configured Channel + recipient User + preferences
 * in one transaction. Replaces the old "create a placeholder channel and
 * make the user fix it up via Settings" pattern.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    const body = await req.json();
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
      children?: Array<{ name?: string; dob?: string | null }>;
      receivingHoursStart?: string;
      receivingHoursEnd?: string;
      timezone?: string;
      emergencyBypassEnabled?: boolean;
      rewriteTone?: "calm_clear" | "firm_fair";
    };

    if (!otherUserPhone || typeof otherUserPhone !== "string") {
      return NextResponse.json({ error: "Recipient phone is required" }, { status: 400 });
    }
    if (!recipientName || typeof recipientName !== "string" || !recipientName.trim()) {
      return NextResponse.json({ error: "Recipient name is required" }, { status: 400 });
    }

    await connectDB();
    const user = await User.findById(payload.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Self-loop guard: reject if the recipient phone matches the user's own
    // phone. Without this check the user pays Stripe + the webhook silently
    // returns null at the createSubsequentChannelForUser self-loop check,
    // leaving an orphaned charge with no channel materialised.
    const ownDigits = (user.phone ?? "").replace(/\D/g, "");
    const otherDigits = otherUserPhone.replace(/\D/g, "");
    if (ownDigits && otherDigits && ownDigits === otherDigits) {
      return NextResponse.json(
        { error: "Recipient phone can't be your own number." },
        { status: 400 }
      );
    }

    // If the user already has a channel, route them through the normal
    // create-channel modal instead. This endpoint is signup-time only.
    const channelCount = await Channel.countDocuments({
      users: user._id,
      state: { $nin: ["closed"] },
    });
    if (channelCount > 0) {
      return NextResponse.json(
        { error: "You already have a channel. Use the dashboard to add another." },
        { status: 400 }
      );
    }

    const sanitizedChildren = Array.isArray(children)
      ? children
          .filter((c) => c && typeof c.name === "string" && c.name.trim())
          .map((c) => ({ name: c!.name!.trim(), dob: c.dob || null }))
          .slice(0, 12)
      : [];

    // Persist user-level receiving hours immediately so any inbound SMS that
    // arrives between Stripe Checkout and webhook completion already respects
    // them.
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
    }

    // Delete any previous pending for this user (re-running signup setup
    // before paying replaces the prior draft, doesn't accumulate them).
    await PendingChannelRequest.deleteMany({ userId: user._id });

    const pending = await PendingChannelRequest.create({
      userId: user._id,
      otherUserPhone: otherUserPhone.trim(),
      pictureShareEnabled: !!pictureShareEnabled,
      recipientName: recipientName.trim(),
      recipientEmail: recipientEmail?.trim() || null,
      emergencyBypassEnabled: emergencyBypassEnabled !== false,
      rewriteTone: rewriteTone === "firm_fair" ? "firm_fair" : "calm_clear",
      receivingHoursStart: receivingHoursStart || null,
      receivingHoursEnd: receivingHoursEnd || null,
      timezone: timezone || null,
      children: sanitizedChildren,
    });

    return NextResponse.json({ ok: true, pendingId: pending._id.toString() });
  } catch (err: any) {
    console.error("[setup/first-channel] error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to save channel setup" },
      { status: 500 }
    );
  }
}
