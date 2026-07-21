import connectDB from "@/lib/db/connect";
import { Message, UserChannelPreferences, Channel, User, AuditLog, ModeratorAssignment } from "@/lib/db/models";
import { classifyAndRewrite } from "./openai";
import { sendSmsWithRetry } from "./twilio";
import { SimulatedOutageError } from "./outageSimulation";
import type { Types } from "mongoose";
import {
  messageHeldForModerationSender,
  a5MessageBlockedSms,
  a1InitialIntroductionUserB,
  getShortLinkBaseUrl,
} from "@/lib/messaging/appendixA";
import { storeSystemMessage } from "@/lib/messaging/storeSystemMessage";
import { createJoinTokenForUserChannel, buildJoinLink } from "@/lib/auth/joinToken";

export type RewriteOutcome = "delivered" | "held" | "blocked";

/**
 * Process a message in state 'rewriting': classify, rewrite, update state.
 * On OpenAI failure, sets state to 'held' (fail-safe: never send raw).
 */
export async function processRewritingMessage(
  messageId: string
): Promise<{ outcome: RewriteOutcome; error?: string }> {
  console.log("[rewritePipeline] ▶ START", { messageId });

  await connectDB();

  // ── Step 1: Atomically claim message (guards against Twilio webhook retries) ─
  // findOneAndUpdate with state:"rewriting" → "processing" ensures only ONE
  // concurrent execution proceeds. A retry hitting this will find state≠"rewriting"
  // and exit immediately.
  const message = await Message.findOneAndUpdate(
    { _id: messageId, state: "rewriting" },
    { $set: { state: "processing" } },
    { new: false } // return original doc so we can log original state
  );
  if (!message) {
    // Either not found or already claimed by another execution (Twilio retry)
    const existing = await Message.findById(messageId).lean();
    console.log("[rewritePipeline] ✗ Could not claim message — not found or already processing", {
      messageId,
      currentState: existing?.state ?? "not found",
    });
    return { outcome: "held", error: "Message not found or already being processed" };
  }
  console.log("[rewritePipeline] Step 1 — message claimed", {
    messageId,
    state: message.state,
    channelId: message.channelId?.toString(),
    senderId: message.senderId?.toString(),
    originalTextLength: message.originalText?.length,
  });

  // ── Step 2: Load channel ──────────────────────────────────────────────────
  const channel = await Channel.findById(message.channelId).lean();
  if (!channel) {
    console.error("[rewritePipeline] ✗ Channel not found — holding message", {
      messageId,
      channelId: message.channelId?.toString(),
    });
    await message.updateOne({ state: "held" });
    return { outcome: "held" };
  }
  console.log("[rewritePipeline] Step 2 — channel loaded", {
    messageId,
    channelId: channel._id.toString(),
    channelState: channel.state,
    clanchaNumber: channel.clanchaNumber ? `***${channel.clanchaNumber.slice(-4)}` : "not set",
    userCount: (channel.users as Types.ObjectId[]).length,
  });

  // ── Step 3: Identify recipient ────────────────────────────────────────────
  const recipientUserId = (channel.users as Types.ObjectId[]).find(
    (id) => id.toString() !== message.senderId?.toString()
  );
  if (!recipientUserId) {
    console.error("[rewritePipeline] ✗ No recipient in channel — holding message", {
      messageId,
      channelId: channel._id.toString(),
      senderId: message.senderId?.toString(),
      allUserIds: (channel.users as Types.ObjectId[]).map((id) => id.toString()),
    });
    await message.updateOne({ state: "held" });
    return { outcome: "held" };
  }
  console.log("[rewritePipeline] Step 3 — recipient identified", {
    messageId,
    recipientUserId: recipientUserId.toString(),
  });

  // ── Step 4: Load recipient prefs (tone) ───────────────────────────────────
  const prefs = await UserChannelPreferences.findOne({
    userId: recipientUserId,
    channelId: message.channelId,
  }).lean();
  const tone = prefs?.rewriteTone ?? "calm_clear";
  console.log("[rewritePipeline] Step 4 — recipient prefs", {
    messageId,
    tone,
    prefsFound: !!prefs,
  });

  // ── Step 5: OpenAI classify + rewrite ─────────────────────────────────────
  try {
    let result: { classification: string; rewrittenText: string | null; flags: string[]; violationTags: string[] };

    console.log("[rewritePipeline] Step 5 — calling OpenAI classifyAndRewrite", {
      messageId,
      tone,
      originalTextLength: message.originalText?.length,
    });
    // Defense in depth: safeguard.ts blocks obvious threats/slurs at the regex layer,
    // the classifier flags subtler unsafe content (semantic threats, harassment), and
    // the rewriter handles tone (sarcasm, passive-aggressive, blame). The classifier
    // prompt is intentionally narrow (threats/slurs/harassment only — NOT sarcasm or
    // blame) so normal-but-charged messages don't pile up in the moderation queue.
    result = await classifyAndRewrite(message.originalText, tone, false);
    console.log("[rewritePipeline] Step 5 — OpenAI result", {
      messageId,
      classification: result.classification,
      flags: result.flags ?? [],
      rewrittenTextLength: result.rewrittenText?.length ?? 0,
      wasRewritten: result.rewrittenText !== message.originalText,
    });

    // Routing per spec:
    //   unsafe    → block (A5 SMS to sender, never delivered, not in moderator queue)
    //   uncertain → hold for moderator review
    //   safe      → deliver
    const isUnsafe = result.classification === "unsafe";
    const isUncertain = result.classification === "uncertain";
    const newDbState: "blocked" | "held" | "delivered" = isUnsafe
      ? "blocked"
      : isUncertain
        ? "held"
        : "delivered";
    const deliveredAtDate = newDbState === "delivered" ? new Date() : null;

    const finalText = result.rewrittenText ?? message.originalText;
    const wasRewritten = finalText !== message.originalText;

    console.log("[rewritePipeline] Step 7 — updating message state in DB", {
      messageId,
      wasRewritten,
      newDbState,
      classification: result.classification,
      finalTextLength: finalText?.length,
    });

    await message.updateOne({
      rewrittenText: finalText,
      state: newDbState,
      deliveredAt: deliveredAtDate,
      classification: result.classification,
      violationTags: result.violationTags,
    });

    if (isUnsafe) {
      const sender = await User.findById(message.senderId).select("phone").lean();
      const a5Body = a5MessageBlockedSms();
      if (sender?.phone) {
        await sendSmsWithRetry(sender.phone, a5Body, channel.clanchaNumber ?? undefined);
      }
      // A5 (blocked) is a sender-only notice → scope to the sender.
      await storeSystemMessage(message.channelId, a5Body, undefined, message.senderId ?? null);

      await AuditLog.create({
        action: "message_blocked",
        channelId: message.channelId,
        actorUserId: message.senderId ?? undefined,
        // Sender is also recorded as the target so the activity row shows who
        // sent the auto-blocked message (M4 tracker #89 — entries previously
        // surfaced only the action + System actor with no context).
        targetUserId: message.senderId ?? undefined,
        metadata: {
          messageId,
          senderId: message.senderId ? message.senderId.toString() : null,
          // Short, redacted preview so a moderator can see what was blocked
          // without opening the full message history.
          preview:
            typeof message.originalText === "string"
              ? message.originalText.slice(0, 140)
              : null,
          classification: result.classification,
          violationTags: result.violationTags,
          flags: result.flags,
          reason: "classifier_unsafe",
        },
      });

      console.log("[rewritePipeline] ✓ DONE — Message blocked (unsafe)", { messageId });
      return { outcome: "blocked" };
    }

    if (isUncertain) {
      await ModeratorAssignment.updateMany(
        { channelId: message.channelId },
        { $inc: { unsafeMessageCount: 1 } }
      );

      const sender = await User.findById(message.senderId).select("phone").lean();
      const heldBody = messageHeldForModerationSender();
      if (sender?.phone) {
        await sendSmsWithRetry(sender.phone, heldBody, channel.clanchaNumber ?? undefined);
      }
      // Held-for-moderation ping is a sender-only notice → scope to the sender.
      await storeSystemMessage(message.channelId, heldBody, undefined, message.senderId ?? null);

      await AuditLog.create({
        action: "message_held",
        channelId: message.channelId,
        actorUserId: message.senderId ?? undefined,
        metadata: {
          messageId,
          classification: result.classification,
          violationTags: result.violationTags,
          flags: result.flags,
          reason: "classifier_uncertain",
          originalText: message.originalText,
        },
      });

      console.log("[rewritePipeline] ✓ DONE — Message held for moderation (uncertain)", { messageId });
      return { outcome: "held" };
    }

    // ── Step 8: Load recipient user (phone & settings) ─────────────────────
    const recipient = await User.findById(recipientUserId).select("phone receivingHoursStart receivingHoursEnd timezone").lean();
    console.log("[rewritePipeline] Step 8 — recipient user loaded", {
      messageId,
      recipientFound: !!recipient,
      hasPhone: !!recipient?.phone,
      phoneMasked: recipient?.phone
        ? recipient.phone.length >= 4
          ? `***${recipient.phone.slice(-4)}`
          : "***"
        : "none",
      receivingHoursStart: recipient?.receivingHoursStart ?? "not set",
      receivingHoursEnd: recipient?.receivingHoursEnd ?? "not set",
      timezone: recipient?.timezone ?? "not set",
    });

    // ── Step 9: Send SMS ─────────────────────────────────────────────────────
    let smsSent = false;
    let smsSid: string | undefined;
    let smsStatus: string | undefined;
    let smsSkipReason: string | undefined;

    if (recipient?.phone) {
      const toMasked =
        recipient.phone.length >= 4 ? `***${recipient.phone.slice(-4)}` : "***";
      const isUsDest = recipient.phone.replace(/^\+/, "").startsWith("1");
      const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID ?? "").trim();
      console.log("[rewritePipeline] Step 9 — attempting SMS", {
        messageId,
        toMasked,
        isUsDest,
        clanchaNumber: channel.clanchaNumber
          ? `***${channel.clanchaNumber.slice(-4)}`
          : "not set",
        messagingServiceConfigured: messagingServiceSid.startsWith("MG"),
        finalTextLength: finalText?.length,
      });

      // ── A1 first-contact intro ────────────────────────────────────────────
      // Per spec Doc 3 Appendix A1 ("Initial System Introduction (User B)"),
      // the intro is for the NON-creating party only — the channel creator
      // (User A) already signed up and has a portal account, so they must
      // never receive it. We therefore fire A1 only when the recipient is the
      // non-creator AND this is the first message ever delivered to them on
      // this channel.
      //
      // Creator convention: every channel-creation path stores
      // `users: [creator, other]`, so users[0] is always the creator. Without
      // the creator guard, A1 incorrectly fired to the creator the first time
      // the joining user replied (#80).
      //
      // The current message was just stamped state="delivered" above, so
      // exclude it from the count — otherwise A1 never fires (the recipient
      // looks like they already have 1 prior delivered inbound).
      const creatorUserId = (channel.users as Types.ObjectId[])[0];
      const recipientIsCreator =
        creatorUserId?.toString() === recipientUserId.toString();
      const priorInboundToRecipient = await Message.countDocuments({
        _id: { $ne: message._id },
        channelId: message.channelId,
        isSystem: false,
        state: "delivered",
        senderId: { $ne: recipientUserId },
      });
      // Persistent once-per-recipient claim (Craig, M4 feedback 05/07/26
      // §1.5). The delivered-count check above handles channels that predate
      // the a1SentTo field; this atomic $addToSet closes the concurrency
      // window where two "first" messages processed in parallel would both
      // observe a zero count and double-send A1.
      const a1Claim =
        !recipientIsCreator && priorInboundToRecipient === 0
          ? await Channel.findOneAndUpdate(
              { _id: message.channelId, a1SentTo: { $ne: recipientUserId } },
              { $addToSet: { a1SentTo: recipientUserId } }
            )
          : null;
      if (!recipientIsCreator && priorInboundToRecipient === 0 && a1Claim) {
        const senderUser = await User.findById(message.senderId).select("name").lean();
        const senderDisplayName =
          (typeof senderUser?.name === "string" && senderUser.name.trim()) ||
          "another Clancha user";
        // Issue a one-shot join token bound to (recipient, channel) so the
        // A1 "create an online account" link drops B straight into an
        // OTP-only claim flow. Token is hashed at rest; only the plaintext
        // form leaves the server in the SMS body. Failure to mint a token
        // must not block A1 — fall back to the generic /login link.
        let joinLink: string | undefined;
        try {
          const token = await createJoinTokenForUserChannel(
            recipientUserId,
            message.channelId
          );
          joinLink = buildJoinLink(token, getShortLinkBaseUrl());
        } catch (err) {
          console.error("[rewritePipeline] Step 9 — failed to mint join token", {
            messageId,
            recipientUserId: recipientUserId.toString(),
            err: err instanceof Error ? err.message : String(err),
          });
        }
        const a1Body = a1InitialIntroductionUserB({
          senderName: senderDisplayName,
          joinLink,
        });
        await sendSmsWithRetry(recipient.phone, a1Body, channel.clanchaNumber ?? undefined);
        // Backdate by 1ms so the portal timeline shows A1 immediately
        // *above* the inbound message it's introducing. Without the
        // backdate the system row lands at the bottom of the channel
        // because it's stored after the user message's createdAt was
        // locked in at inbound-webhook time.
        const a1At = new Date(new Date(message.createdAt).getTime() - 1);
        // SECURITY: A1 embeds B's one-shot /join token — it must be visible
        // ONLY to the joining user (the recipient), never to the sender (A).
        await storeSystemMessage(message.channelId, a1Body, a1At, recipientUserId);
        console.log("[rewritePipeline] Step 9 — A1 first-contact intro sent", { messageId, toMasked });
      }

      const result = await sendSmsWithRetry(recipient.phone, finalText, channel.clanchaNumber ?? undefined);
      // Note: when Twilio is unreachable, sendSmsWithRetry returns success=true
      // with status="queued_for_retry" — the cron sweep will redeliver.
      smsSent = result.success;
      smsSid = result.sid;
      smsStatus = result.status;

      if (smsSent) {
        console.log("[rewritePipeline] Step 9 — ✓ SMS sent", { messageId, toMasked, sid: smsSid, status: smsStatus });
      } else {
        smsSkipReason = result.error || "Unknown Twilio error";
        console.error("[rewritePipeline] Step 9 — ✗ SMS not sent", {
          messageId,
          toMasked,
          reason: smsSkipReason,
          sid: smsSid,
          status: smsStatus,
        });
      }
    } else {
      smsSkipReason = "no recipient phone on record";
      console.error("[rewritePipeline] Step 9 — ✗ SMS skipped: recipient has no phone", {
        messageId,
        recipientUserId: recipientUserId.toString(),
      });
    }

    // ── Step 10: Audit log ───────────────────────────────────────────────────
    await AuditLog.create({
      action: "message_delivered",
      channelId: message.channelId,
      actorUserId: message.senderId ?? undefined,
      targetUserId: recipientUserId,
      metadata: {
        messageId,
        smsSent,
        smsSid,
        smsStatus,
        classification: result.classification,
        violationTags: result.violationTags,
        originalText: message.originalText,
        rewrittenText: finalText,
        ...(smsSkipReason ? { smsSkipReason } : {}),
      },
    });

    console.log("[rewritePipeline] ✓ DONE", { messageId, outcome: "delivered", smsSent });
    return { outcome: "delivered" };

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[rewritePipeline] ✗ EXCEPTION — holding message", {
      messageId,
      errorMessage: err.message,
      errorName: err.name,
      stack: err.stack?.split("\n").slice(0, 5).join(" | "),
    });
    if (err.message.includes("not configured")) {
      console.error(
        "[rewritePipeline] Ensure OPENAI_API_KEY (or OPENAI_API_KEY_LIVE) is set in .env and restart the server."
      );
    }
    await message.updateOne({
      state: "held",
      rewrittenText: message.originalText,
    });
    // The user-visible outcome is "held"; tag the underlying infra failure
    // separately so an admin can distinguish business holds (uncertain
    // classifier) from OpenAI outages on the Activity feed.
    await AuditLog.create({
      action: "service_failure_openai",
      channelId: message.channelId,
      metadata: {
        operation: "classifyAndRewrite",
        messageId,
        error: err.message,
        errorName: err.name,
        simulated: err instanceof SimulatedOutageError,
      },
    }).catch(() => {});
    await AuditLog.create({
      action: "message_held",
      channelId: message.channelId,
      actorUserId: message.senderId ?? undefined,
      metadata: {
        messageId,
        reason: "error",
        error: err.message,
      },
    });
    return { outcome: "held", error: err.message };
  }
}
