import connectDB from "@/lib/db/connect";
import { Message } from "@/lib/db/models";
import type { Types } from "mongoose";

/**
 * Persist a Clancha system message (A1–A12 and similar) into the channel's
 * message history so it is visible in the portal chat.
 *
 * System messages are stored with state "delivered", isSystem = true, and no
 * senderId so they render as neutral notifications rather than belonging to
 * either participant.
 *
 * `at` lets the caller backdate the row so the system message appears
 * immediately *before* a specific user message (e.g. A1 above the very first
 * inbound rewrite). Without this, the system message lands at the bottom of
 * the timeline because it's stored after the user message has already been
 * created.
 *
 * `systemRecipientUserId` scopes the system message to a single channel member
 * so it is shown ONLY in that user's portal history. This is a privacy/security
 * requirement: per-user notices (A1 intro with B's join token, A2 queued, A8
 * approved-image, A9 denied-image, etc.) must never leak into the OTHER user's
 * timeline. Pass `null`/omit only for genuinely shared notices visible to all
 * channel members (e.g. "viewer left").
 */
export async function storeSystemMessage(
  channelId: string | Types.ObjectId,
  text: string,
  at?: Date,
  systemRecipientUserId?: string | Types.ObjectId | null
): Promise<void> {
  try {
    await connectDB();
    const ts = at ?? new Date();
    await Message.create({
      channelId,
      senderId: null,
      originalText: text,
      rewrittenText: text,
      state: "delivered",
      isSystem: true,
      isEmergency: false,
      systemRecipientUserId: systemRecipientUserId ?? null,
      deliveredAt: ts,
      ...(at ? { createdAt: ts, updatedAt: ts } : {}),
    });
  } catch (error) {
    // Never let system-message storage break the main flow
    console.error("[storeSystemMessage] failed to store:", error);
  }
}
