import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Message, AuditLog, Channel, User, ModeratorAssignment, UserChannelPreferences } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import mongoose, { Types } from "mongoose";
import { sendSmsWithRetry } from "@/lib/services/twilio";
import { canAccessModeration } from "@/lib/auth/moderatorAccess";
import { applyModeratorImageDecision } from "@/lib/services/moderatorImageReview";
import { a5MessageBlockedSms } from "@/lib/messaging/appendixA";
import { storeSystemMessage } from "@/lib/messaging/storeSystemMessage";
import { classifyAndRewrite } from "@/lib/services/openai";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  if (!canAccessModeration(payload.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { type, id, action, notes } = body;

    if (!type || !id || !action) {
      return NextResponse.json(
        { error: "type, id, and action are required" },
        { status: 400 }
      );
    }
    if (!["approve", "deny", "retry_rewrite"].includes(action)) {
      return NextResponse.json(
        { error: "action must be approve, deny, or retry_rewrite" },
        { status: 400 }
      );
    }

    await connectDB();
    const moderatorId = new mongoose.Types.ObjectId(payload.userId);

    if (type === "message") {
      const message = await Message.findById(id);
      if (!message || message.state !== "held") {
        return NextResponse.json(
          { error: "Message not found or not in held state" },
          { status: 400 }
        );
      }
      if (action === "retry_rewrite") {
        const channel = await Channel.findById(message.channelId).lean();
        if (!channel) {
          return NextResponse.json({ error: "Channel not found" }, { status: 400 });
        }
        const recipientUserId = (channel.users as Types.ObjectId[]).find(
          (uid) => uid.toString() !== message.senderId?.toString()
        );
        const prefs = recipientUserId
          ? await UserChannelPreferences.findOne({
              userId: recipientUserId,
              channelId: message.channelId,
            }).lean()
          : null;
        const tone = (prefs?.rewriteTone ?? "calm_clear") as "calm_clear" | "firm_fair";

        const result = await classifyAndRewrite(message.originalText, tone, false);
        // noSafeRewrite: the rewriter could not produce a usable softening.
        // This happens when safeguard blocks (classification=unsafe + null rewrite),
        // the classifier returns unsafe (early-returns with null rewrite), or the
        // rewriter emits the HOLD_FOR_MODERATION sentinel (uncertain + null rewrite).
        // In all these cases the moderator should deny — no version of this message
        // can be safely delivered.
        const noSafeRewrite = result.rewrittenText === null;
        const newRewrite = result.rewrittenText ?? message.originalText;

        message.rewrittenText = newRewrite;
        message.classification = result.classification;
        message.violationTags = result.violationTags;
        message.moderatorId = moderatorId;
        await message.save();

        await AuditLog.create({
          action: "message_moderator_retry_rewrite",
          channelId: message.channelId,
          actorUserId: moderatorId,
          targetUserId: message.senderId ?? undefined,
          metadata: {
            messageId: id,
            classification: result.classification,
            violationTags: result.violationTags,
            noSafeRewrite,
            tone,
          },
        });

        return NextResponse.json({
          success: true,
          state: message.state,
          rewrittenText: newRewrite,
          classification: result.classification,
          violationTags: result.violationTags,
          noSafeRewrite,
        });
      }
      if (action === "approve") {
        // Server-side safety guard: never approve a message the classifier
        // marked unsafe, regardless of UI state. Approving would deliver
        // raw abuse to the recipient. The moderator must deny instead.
        if (message.classification === "unsafe") {
          return NextResponse.json(
            {
              error:
                "Cannot approve: this message was classified as unsafe and has no acceptable rewrite. Deny instead.",
            },
            { status: 400 }
          );
        }
        // Guard: if no acceptable rewrite was produced (rewrittenText fell back
        // to originalText after a HOLD_SENTINEL or OpenAI error), block approval
        // so raw content is never delivered to the recipient.
        if (
          message.classification &&
          message.classification !== "safe" &&
          message.rewrittenText === message.originalText
        ) {
          return NextResponse.json(
            {
              error:
                "Cannot approve: no acceptable rewrite was produced for this message. Use 'Request rewrite retry' to generate one, or Deny.",
            },
            { status: 400 }
          );
        }
        message.state = "delivered";
        message.deliveredAt = new Date();
        message.moderatorId = moderatorId;
        if (typeof notes === "string") message.moderatorNotes = notes;
        await message.save();

        // Post-approval side-effects (SMS + audit). These run after the DB
        // commit so a downstream failure must not roll back the approval or
        // return an error to the moderator — the message is already delivered.
        try {
          await ModeratorAssignment.updateMany(
            { channelId: message.channelId, unsafeMessageCount: { $gt: 0 } },
            { $inc: { unsafeMessageCount: -1 } }
          );

          // Send SMS to recipient
          const channel = await Channel.findById(message.channelId).lean();
          if (channel) {
            const recipientUserId = (channel.users as Types.ObjectId[]).find(
              (uid) => uid.toString() !== message.senderId?.toString()
            );
            if (recipientUserId) {
              const recipient = await User.findById(recipientUserId).select("phone").lean();
              const finalText = message.rewrittenText ?? message.originalText;
              if (recipient?.phone) {
                console.log("[moderator/review] Sending SMS after approval", {
                  messageId: id,
                  toMasked: recipient.phone.length >= 4 ? `***${recipient.phone.slice(-4)}` : "***",
                });
                const smsSent = await sendSmsWithRetry(recipient.phone, finalText, channel.clanchaNumber ?? undefined);
                console.log("[moderator/review] SMS result", { messageId: id, smsSent });
                await AuditLog.create({
                  action: "message_moderator_approved",
                  channelId: message.channelId,
                  actorUserId: moderatorId,
                  targetUserId: message.senderId ?? undefined,
                  metadata: { messageId: id, smsSent, approvedByModerator: true },
                });
              } else {
                console.warn("[moderator/review] Recipient has no phone — SMS skipped", { messageId: id });
              }
            } else {
              console.warn("[moderator/review] No recipient found in channel — SMS skipped", { messageId: id });
            }
          } else {
            console.warn("[moderator/review] Channel not found — SMS skipped", { messageId: id });
          }
        } catch (postApproveErr) {
          // The message is already marked delivered — log and continue so the
          // moderator receives a 200. The cron sweep will retry any failed SMS.
          console.error("[moderator/review] Post-approve side-effect failed (message already delivered)", {
            messageId: id,
            error: postApproveErr instanceof Error ? postApproveErr.message : String(postApproveErr),
          });
        }
      } else {
        message.state = "blocked";
        message.moderatorId = moderatorId;
        if (typeof notes === "string") message.moderatorNotes = notes;
        await message.save();

        await ModeratorAssignment.updateMany(
          { channelId: message.channelId, unsafeMessageCount: { $gt: 0 } },
          { $inc: { unsafeMessageCount: -1 } }
        );

        // Notify sender
        const sender = await User.findById(message.senderId).select("phone").lean();
        const channel = await Channel.findById(message.channelId).select("clanchaNumber").lean();
        const a5Body = a5MessageBlockedSms();
        if (sender?.phone) {
          await sendSmsWithRetry(sender.phone, a5Body, channel?.clanchaNumber ?? undefined);
        }
        // A5 (blocked) is a sender-only notice → scope to the sender.
        await storeSystemMessage(message.channelId, a5Body, undefined, message.senderId ?? null);

        await AuditLog.create({
          action: "message_moderator_denied",
          channelId: message.channelId,
          actorUserId: moderatorId,
          targetUserId: message.senderId ?? undefined,
          metadata: { messageId: id },
        });
      }
      return NextResponse.json({ success: true, state: message.state });
    }

    if (type === "image") {
      if (action === "retry_rewrite") {
        return NextResponse.json(
          { error: "retry_rewrite is not supported for images" },
          { status: 400 }
        );
      }
      const decision = await applyModeratorImageDecision({
        imageId: id,
        moderatorId,
        action: action === "approve" ? "approve" : "deny",
        notes: typeof notes === "string" ? notes : undefined,
      });
      if (!decision.ok) {
        return NextResponse.json({ error: decision.error }, { status: decision.status });
      }
      return NextResponse.json({
        success: true,
        state: decision.state,
        ...(decision.messageId ? { messageId: decision.messageId } : {}),
      });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error) {
    console.error("moderator/review error:", error);
    return NextResponse.json(
      { error: "Failed to review" },
      { status: 500 }
    );
  }
}
