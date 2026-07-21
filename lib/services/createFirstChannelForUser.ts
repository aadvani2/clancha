import connectDB from "@/lib/db/connect";
import { Channel, User, UserChannelPreferences } from "@/lib/db/models";
import { reserveNumber, assignNumberToChannel } from "@/lib/services/numberPool";
import { createSubscriptionForChannel } from "@/lib/services/billing";
import mongoose from "mongoose";
import type { Types } from "mongoose";

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").trim();
}

/** Phone used for the "pending invite" placeholder user. No real user should have this. */
export const PLACEHOLDER_PHONE = "+00000000000";

/**
 * Get or create the global placeholder user (used as the "other" user for auto-created first channels).
 */
export async function getOrCreatePlaceholderUser(
  session: mongoose.mongo.ClientSession
): Promise<Types.ObjectId> {
  let placeholder = await User.findOne({ phone: PLACEHOLDER_PHONE }).session(session).lean();
  if (placeholder) return placeholder._id as Types.ObjectId;

  const created = await User.create(
    [
      {
        phone: PLACEHOLDER_PHONE,
        role: "user",
      },
    ],
    { session }
  );
  return created[0]._id as Types.ObjectId;
}

/**
 * After subscription purchase, if the user has no channels yet, create their first channel
 * with a placeholder "other" user. When they later add a contact (create channel with a phone),
 * we replace the placeholder with the real user in that channel.
 * Returns the new channel id or null if not created (e.g. no number available or user already has channels).
 */
export async function createFirstChannelForUser(
  userId: string,
  stripeSubscriptionId: string,
  plan: "core" | "picture_addon",
  currentPeriodEnd: Date
): Promise<string | null> {
  await connectDB();

  const user = await User.findById(userId);
  if (!user) return null;

  const existingCount = await Channel.countDocuments({
    users: user._id,
    state: { $nin: ["closed"] },
  });
  if (existingCount > 0) {
    console.log("[createFirstChannelForUser] User already has channels, skipping", {
      userId,
      existingCount,
    });
    return null;
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const placeholderId = await getOrCreatePlaceholderUser(session);
    const myId = user._id as Types.ObjectId;

    const reserved = await reserveNumber(session, userId);
    if (!reserved) {
      await session.abortTransaction();
      console.warn("[createFirstChannelForUser] No number available in pool for user", {
        userId,
        hint: "Add PhoneNumber documents with isActive: true to create channels.",
      });
      return null;
    }

    const channel = await Channel.create(
      [
        {
          users: [myId, placeholderId],
          clanchaNumber: reserved.number,
          state: "active",
          pictureShareEnabled: plan === "picture_addon",
          emergencyBypassEnabled: true,
        },
      ],
      { session }
    );
    const newChannel = channel[0];

    await assignNumberToChannel(session, reserved.id, newChannel._id as Types.ObjectId);
    await createSubscriptionForChannel(
      session,
      myId,
      newChannel._id as Types.ObjectId,
      stripeSubscriptionId,
      plan,
      currentPeriodEnd
    );

    for (const uid of [myId, placeholderId]) {
      await UserChannelPreferences.create(
        [
          {
            userId: uid,
            channelId: newChannel._id,
            rewriteTone: "calm_clear",
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();
    console.log("[createFirstChannelForUser] Created first channel for user", {
      userId,
      channelId: newChannel._id.toString(),
      clanchaNumber: reserved.number,
    });
    return newChannel._id.toString();
  } catch (err) {
    await session.abortTransaction().catch(() => {});
    console.error("[createFirstChannelForUser] Error:", err);
    return null;
  } finally {
    session.endSession();
  }
}

export type SubsequentChannelExtras = {
  recipientName?: string | null;
  recipientEmail?: string | null;
  emergencyBypassEnabled?: boolean;
  rewriteTone?: "calm_clear" | "firm_fair";
  receivingHoursStart?: string | null;
  receivingHoursEnd?: string | null;
  timezone?: string | null;
  children?: Array<{ name: string; dob?: string | null }>;
};

/**
 * Create a subsequent channel (2nd, 3rd, ...) for a user after their payment has succeeded.
 * Used from invoice.paid when processing PendingChannelRequest(s).
 * otherUserPhone: contact phone; user will be found or created.
 * extras carries the prefilled-details payload from the PendingChannelRequest
 * (recipient name/email, children, emergency bypass, tone, receiving hours)
 * so the resulting channel is fully configured at materialisation time.
 */
export async function createSubsequentChannelForUser(
  userId: string,
  stripeSubscriptionId: string,
  plan: "core" | "picture_addon",
  currentPeriodEnd: Date,
  otherUserPhone: string,
  pictureShareEnabled: boolean,
  extras: SubsequentChannelExtras = {}
): Promise<string | null> {
  await connectDB();

  const user = await User.findById(userId);
  if (!user) return null;

  const otherPhoneNorm = normalizePhone(otherUserPhone);
  let otherUser = await User.findOne({
    phone: { $regex: new RegExp(`^\\+?${otherPhoneNorm}$`) },
  });
  const recipientName = extras.recipientName?.trim() || null;
  const recipientEmail = extras.recipientEmail?.trim() || null;
  if (!otherUser) {
    otherUser = await User.create({
      phone: otherPhoneNorm.startsWith("+") ? otherPhoneNorm : `+${otherPhoneNorm}`,
      email: recipientEmail || `clancha_${otherPhoneNorm.replace(/\+/g, "")}@invited.com`,
      name: recipientName || undefined,
      role: "user",
    });
  } else {
    const upd: Record<string, unknown> = {};
    if (recipientName && !otherUser.name) upd.name = recipientName;
    if (
      recipientEmail &&
      (!otherUser.email || otherUser.email.endsWith("@invited.com"))
    ) {
      upd.email = recipientEmail;
    }
    if (Object.keys(upd).length > 0) {
      await User.updateOne({ _id: otherUser._id }, { $set: upd });
      Object.assign(otherUser, upd);
    }
  }

  const myId = user._id as Types.ObjectId;
  const otherId = otherUser._id as Types.ObjectId;
  if (otherId.equals(myId)) {
    console.warn(
      "[createSubsequentChannelForUser] Rejected — recipient phone matches sender's own phone (self-loop)",
      { userId, otherUserPhone }
    );
    return null;
  }

  const existing = await Channel.findOne({
    users: { $all: [myId, otherId] },
    state: { $nin: ["closed"] },
  });
  if (existing) {
    console.warn(
      "[createSubsequentChannelForUser] Rejected — channel between these two users already exists",
      { userId, otherUserPhone, existingChannelId: existing._id.toString() }
    );
    return null;
  }

  // Persist user-level receiving hours / timezone from the pending payload.
  const userUpd: Record<string, unknown> = {};
  if (extras.receivingHoursStart) userUpd.receivingHoursStart = extras.receivingHoursStart;
  if (extras.receivingHoursEnd) userUpd.receivingHoursEnd = extras.receivingHoursEnd;
  if (extras.timezone) userUpd.timezone = extras.timezone;
  if (Object.keys(userUpd).length > 0) {
    await User.updateOne({ _id: user._id }, { $set: userUpd });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const reserved = await reserveNumber(session, userId);
    if (!reserved) {
      await session.abortTransaction();
      console.warn("[createSubsequentChannelForUser] No number available for user", userId);
      return null;
    }

    const cleanChildren = Array.isArray(extras.children)
      ? extras.children
          .filter((c) => c && typeof c.name === "string" && c.name.trim())
          .map((c) => ({ name: c.name.trim(), dob: c.dob || null }))
          .slice(0, 12)
      : [];

    const channel = await Channel.create(
      [
        {
          users: [myId, otherId],
          clanchaNumber: reserved.number,
          state: "active",
          name: recipientName || undefined,
          pictureShareEnabled: user.isPictureAddonEnabled || pictureShareEnabled,
          emergencyBypassEnabled: extras.emergencyBypassEnabled !== false,
          linkedChildren: cleanChildren,
        },
      ],
      { session }
    );
    const newChannel = channel[0];

    await assignNumberToChannel(session, reserved.id, newChannel._id as Types.ObjectId);
    await createSubscriptionForChannel(
      session,
      myId,
      newChannel._id as Types.ObjectId,
      stripeSubscriptionId,
      plan,
      currentPeriodEnd
    );

    const myTone: "calm_clear" | "firm_fair" =
      extras.rewriteTone === "firm_fair" ? "firm_fair" : "calm_clear";
    await UserChannelPreferences.create(
      [{ userId: myId, channelId: newChannel._id, rewriteTone: myTone }],
      { session }
    );
    await UserChannelPreferences.create(
      [{ userId: otherId, channelId: newChannel._id, rewriteTone: "calm_clear" }],
      { session }
    );

    await session.commitTransaction();
    console.log("[createSubsequentChannelForUser] Created channel for user", {
      userId,
      channelId: newChannel._id.toString(),
      clanchaNumber: reserved.number,
    });
    return newChannel._id.toString();
  } catch (err) {
    await session.abortTransaction().catch(() => {});
    console.error("[createSubsequentChannelForUser] Error:", err);
    return null;
  } finally {
    session.endSession();
  }
}

/**
 * Returns true if the given user id is the placeholder (pending invite) user.
 */
export function isPlaceholderUserId(userId: Types.ObjectId, placeholderUserId: Types.ObjectId): boolean {
  return userId.equals(placeholderUserId);
}
