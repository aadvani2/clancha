import connectDB from "@/lib/db/connect";
import { Channel, UserChannelPreferences } from "@/lib/db/models";
import { canCreateChannel, reserveNumber, assignNumberToChannel } from "@/lib/services/numberPool";
import { createTrialSubscriptionForChannel } from "@/lib/services/billing";
import mongoose from "mongoose";
import type { Types } from "mongoose";

/**
 * Create a channel between two users and allocate a Clancha number.
 * Returns the created channel (lean) or null if limit reached or no number available.
 */
export async function createChannelBetweenUsers(
  inviterUserId: string,
  otherUserId: string
): Promise<{ id: string; clanchaNumber: string; state: string } | null> {
  const allowed = await canCreateChannel(inviterUserId);
  if (!allowed) return null;

  await connectDB();
  const myId = new mongoose.Types.ObjectId(inviterUserId);
  const otherId = new mongoose.Types.ObjectId(otherUserId);

  const existing = await Channel.findOne({
    users: { $all: [myId, otherId] },
    state: { $nin: ["closed"] },
  });
  if (existing) return null;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const reserved = await reserveNumber(session, inviterUserId);
    if (!reserved) {
      await session.abortTransaction();
      return null;
    }

    const channel = await Channel.create(
      [
        {
          users: [myId, otherId],
          clanchaNumber: reserved.number,
          state: "trial",
          pictureShareEnabled: false,
          emergencyBypassEnabled: true,
        },
      ],
      { session }
    );
    const newChannel = channel[0];

    await assignNumberToChannel(session, reserved.id, newChannel._id as Types.ObjectId);

    await createTrialSubscriptionForChannel(session, myId, newChannel._id as Types.ObjectId);

    for (const uid of [myId, otherId]) {
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

    const c = await Channel.findById(newChannel._id).lean();
    if (!c) return null;
    return {
      id: c._id.toString(),
      clanchaNumber: c.clanchaNumber,
      state: c.state,
    };
  } catch {
    await session.abortTransaction().catch(() => {});
    return null;
  } finally {
    session.endSession();
  }
}
