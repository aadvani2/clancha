import connectDB from "@/lib/db/connect";
import { Image, Message, Channel, User, AuditLog, ModeratorAssignment } from "@/lib/db/models";
import type { Types } from "mongoose";
import { sendSmsWithRetry } from "@/lib/services/twilio";
import { a8PictureUploadApprovedRecipient, a9PictureUploadDeniedSender } from "@/lib/messaging/appendixA";
import { storeSystemMessage } from "@/lib/messaging/storeSystemMessage";

export type ModeratorImageDecision = "approve" | "deny";

export async function applyModeratorImageDecision(params: {
  imageId: string;
  moderatorId: Types.ObjectId;
  action: ModeratorImageDecision;
  notes?: string;
}): Promise<{ ok: true; state: string; messageId?: string } | { ok: false; error: string; status: number }> {
  const { imageId, moderatorId, action, notes } = params;

  await connectDB();

  const image = await Image.findById(imageId);
  if (!image || image.state !== "pending") {
    return { ok: false, error: "Image not found or not pending moderation", status: 400 };
  }

  if (action === "approve") {
    image.state = "approved";
    image.moderatorId = moderatorId;
    if (typeof notes === "string") image.moderatorNotes = notes;
    await image.save();

    // For image messages the caption shown next to the picture must be friendly
    // text — not the raw S3 URL. Use "[Image]" as a neutral placeholder. The
    // actual image is rendered from the imageId/imageUrl resolution in the
    // messages route, not from this text field.
    const msg = await Message.create({
      channelId: image.channelId,
      senderId: image.senderId,
      originalText: "[Image]",
      rewrittenText: "[Image]",
      state: "delivered",
      deliveredAt: new Date(),
      imageId: image._id,
    });

    await ModeratorAssignment.updateMany(
      { channelId: image.channelId, unsafeMessageCount: { $gt: 0 } },
      { $inc: { unsafeMessageCount: -1 } }
    );

    const channel = await Channel.findById(image.channelId).lean();
    if (channel) {
      const recipientUserId = (channel.users as Types.ObjectId[]).find(
        (id) => id.toString() !== image.senderId.toString()
      );
      const a8Body = a8PictureUploadApprovedRecipient({ imageId });
      if (recipientUserId) {
        const recipient = await User.findById(recipientUserId).select("phone").lean();
        if (recipient?.phone) {
          await sendSmsWithRetry(recipient.phone, a8Body, channel.clanchaNumber ?? undefined);
        }
      }
      // A8 (approved-image) is a recipient-only notice → scope to the
      // recipient (the user who can now view the picture), never the sender.
      await storeSystemMessage(image.channelId, a8Body, undefined, recipientUserId ?? null);
    }

    await AuditLog.create({
      action: "image_moderator_approved",
      channelId: image.channelId,
      actorUserId: moderatorId,
      metadata: { imageId, messageId: msg._id.toString() },
    });

    return { ok: true, state: image.state, messageId: msg._id.toString() };
  }

  image.state = "denied";
  image.expiresAt = new Date();
  image.expiresAt.setDate(image.expiresAt.getDate() + 30);
  image.moderatorId = moderatorId;
  if (typeof notes === "string") image.moderatorNotes = notes;
  await image.save();

  await ModeratorAssignment.updateMany(
    { channelId: image.channelId, unsafeMessageCount: { $gt: 0 } },
    { $inc: { unsafeMessageCount: -1 } }
  );

  const sender = await User.findById(image.senderId).select("phone").lean();
  const channel = await Channel.findById(image.channelId).select("clanchaNumber").lean();
  const a9Body = a9PictureUploadDeniedSender();
  if (sender?.phone) {
    await sendSmsWithRetry(sender.phone, a9Body, channel?.clanchaNumber ?? undefined);
  }
  // A9 (denied-image) is a sender-only notice → scope to the sender whose
  // picture was declined (item 29: must NOT leak to the recipient).
  await storeSystemMessage(image.channelId, a9Body, undefined, image.senderId ?? null);

  await AuditLog.create({
    action: "image_moderator_denied",
    channelId: image.channelId,
    actorUserId: moderatorId,
    metadata: { imageId },
  });

  return { ok: true, state: image.state };
}
