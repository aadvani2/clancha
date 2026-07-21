import connectDB from "@/lib/db/connect";
import { PhoneNumber, Channel } from "@/lib/db/models";
import mongoose from "mongoose";
import type { Types } from "mongoose";

const MAX_ACTIVE_CHANNELS = 5;

export async function countActiveChannelsForUser(userId: string): Promise<number> {
  await connectDB();
  return Channel.countDocuments({
    users: userId,
    state: { $in: ["trial", "active"] },
  });
}

export async function canCreateChannel(userId: string): Promise<boolean> {
  const count = await countActiveChannelsForUser(userId);
  return count < MAX_ACTIVE_CHANNELS;
}

/**
 * Reserve a Clancha number for a new channel.
 *
 * Allocation rule (M4 tracker #105):
 *   - The pool is walked in a fixed order (oldest number first), so a user's
 *     FIRST channel lands on the first pool number, their SECOND on the next
 *     number they don't already use, their THIRD on the one after that, etc.
 *   - One number can be shared across MANY users' channels, but a single user
 *     never gets two channels on the same number — the usedByUser guard skips
 *     any number this user is already on.
 *   - Because every user starts from the top of the same ordered pool, the
 *     first number carries everyone's first channel (highest load), the second
 *     number carries everyone's second channel, and so on — counts decrease
 *     down the pool, which is exactly the order the admin pool list shows.
 *
 * Call within a transaction. Does not exclusively assign the number (no
 * assignNumberToChannel needed).
 */
export async function reserveNumber(
  session: mongoose.mongo.ClientSession,
  userId: string
): Promise<{ number: string; id: Types.ObjectId } | null> {
  // Sort oldest-first so allocation order is deterministic and matches the
  // admin pool ordering (without an explicit sort Mongo's order is incidental).
  const pool = await PhoneNumber.find(
    { isActive: true },
    { number: 1, createdAt: 1 },
    { session }
  )
    .sort({ createdAt: 1 })
    .lean();

  if (!pool.length) return null;

  const userClanchaNumbers = await Channel.find(
    { users: new mongoose.Types.ObjectId(userId) },
    { clanchaNumber: 1 },
    { session }
  )
    .lean();

  const usedByUser = new Set(userClanchaNumbers.map((c) => c.clanchaNumber));

  const available = pool.find((p) => !usedByUser.has(p.number));
  if (!available) return null;

  return { number: available.number, id: available._id as Types.ObjectId };
}

/**
 * No-op: numbers are shared across users; we do not exclusively assign a number to a channel.
 * Kept for API compatibility; call is optional.
 */
export async function assignNumberToChannel(
  _session: mongoose.mongo.ClientSession,
  _phoneNumberId: Types.ObjectId,
  _channelId: Types.ObjectId
): Promise<void> {
  // Intentional no-op: one Clancha number can be used by multiple users' channels
}

/** Allocate an available phone number for a channel (shared pool; same number can be used by other users). */
export async function allocateNumber(
  session: mongoose.mongo.ClientSession,
  userId: string
): Promise<string | null> {
  const reserved = await reserveNumber(session, userId);
  return reserved?.number ?? null;
}

export async function deallocateNumber(
  session: mongoose.mongo.ClientSession,
  channelId: Types.ObjectId
): Promise<void> {
  await PhoneNumber.updateMany(
    { channelId },
    { $set: { channelId: null } },
    { session }
  );
}
