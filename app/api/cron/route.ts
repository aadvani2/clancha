import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, Message, User, Image, AuditLog, Subscription } from "@/lib/db/models";
import { processRewritingMessage } from "@/lib/services/rewritePipeline";
import { isWithinReceivingHours } from "@/lib/utils/routing";
import { deleteObjectFromS3 } from "@/lib/services/s3";
import { processSmsOutbox, sendSmsWithRetry } from "@/lib/services/twilio";
import { a10ChannelViewOnlyReactivate } from "@/lib/messaging/appendixA";
import { storeSystemMessage } from "@/lib/messaging/storeSystemMessage";
import type { Types } from "mongoose";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Vercel Cron (or external cron) calls this to:
 * 1. Expire trials (7 days) → set channel view_only
 * 2. Process queued messages when recipient's receiving hours resume
 * Protect with CRON_SECRET or Vercel's Authorization: Bearer <token>.
 */
export async function GET(request: NextRequest) {
  if (CRON_SECRET && request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectDB();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const trialChannels = await Channel.find({
      state: "trial",
      createdAt: { $lt: sevenDaysAgo },
    })
      .select("_id users clanchaNumber")
      .lean();

    for (const ch of trialChannels) {
      // A throw in trial-expiry notification (e.g. a Twilio blip in
      // sendSmsWithRetry) must NOT abort the whole cron before queued messages
      // are released — otherwise a transient SMS failure here silently strands
      // every parked message. Isolate each trial channel.
      try {
        await Channel.updateOne({ _id: ch._id }, { $set: { state: "view_only" } });
        await AuditLog.create({
          action: "channel_trial_expired",
          channelId: ch._id,
          metadata: { reason: "trial_age_exceeded_7_days" },
        });

        // Notify both users so they don't have to discover via a failed send.
        const userIds = (ch.users ?? []) as Types.ObjectId[];
        const users = await User.find({ _id: { $in: userIds } })
          .select("phone")
          .lean();
        const message = a10ChannelViewOnlyReactivate();
        for (const u of users) {
          const phone = (u as { phone?: string }).phone;
          if (phone) {
            await sendSmsWithRetry(phone, message, ch.clanchaNumber ?? undefined);
          }
        }
        // Trial-expired / view-only notice concerns BOTH members equally →
        // genuinely shared notice (systemRecipientUserId = null).
        await storeSystemMessage(ch._id, message, undefined, null);
      } catch (err) {
        console.error("[cron] Trial-expiry notification failed — continuing", {
          channelId: ch._id?.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // SAFETY NET: a queued message must NEVER be silently lost. Even if the
    // recipient's receiving window is somehow never satisfied (clock skew,
    // timezone drift, a window that was edited to an unreachable value), any
    // message that has waited longer than this is force-released so it always
    // eventually delivers. The spec requires that a queued message that never
    // releases cannot happen.
    const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    const forceReleaseBefore = new Date(Date.now() - MAX_QUEUE_AGE_MS);

    const queuedMessages = await Message.find({ state: "queued" })
      .select("_id channelId senderId createdAt")
      .sort({ createdAt: 1 }) // oldest first so long-parked messages are handled first
      .limit(50)
      .lean();

    let queuedProcessed = 0;
    let queuedForceReleased = 0;
    for (const m of queuedMessages) {
      try {
        const channel = await Channel.findById(m.channelId).lean();
        if (!channel) continue;
        const recipientUserId = (channel.users as Types.ObjectId[]).find(
          (id) => id.toString() !== (m.senderId as Types.ObjectId).toString()
        );
        if (!recipientUserId) continue;
        const recipient = await User.findById(recipientUserId)
          .select("receivingHoursStart receivingHoursEnd timezone")
          .lean<{
            receivingHoursStart?: string | null;
            receivingHoursEnd?: string | null;
            timezone?: string | null;
          } | null>();
        // CHANNEL IS THE ABSOLUTE SOURCE OF TRUTH:
        // If receiving hours are null, it means ALWAYS OPEN (24/7).
        const hStart = recipient?.receivingHoursStart ?? null;
        const hEnd = recipient?.receivingHoursEnd ?? null;

        // Use the SAME clock the inbound webhook used to QUEUE the message so
        // the queue decision and the release decision can never disagree. The
        // webhook queues with `recipient.timezone ?? "Europe/London"`; the cron
        // previously hardcoded "Europe/London", which meant a non-London
        // recipient could be queued (outside their local hours) yet never
        // released (cron evaluating London hours) — a silently lost message.
        const effectiveTz = recipient?.timezone ?? "Europe/London";

        const withinHours = isWithinReceivingHours({
          receivingHoursStart: hStart,
          receivingHoursEnd: hEnd,
          timezone: effectiveTz,
        });

        const isStale =
          m.createdAt instanceof Date && m.createdAt < forceReleaseBefore;

        if (!withinHours && !isStale) continue;

        // ATOMIC CLAIM: Ensuring multiple crons don't process the same message
        const claimed = await Message.findOneAndUpdate(
          { _id: m._id, state: "queued" },
          { $set: { state: "rewriting" } },
          { new: false }
        );
        if (!claimed) {
          console.log("[cron] Message already claimed by another run", { messageId: m._id.toString() });
          continue;
        }

        if (isStale && !withinHours) {
          queuedForceReleased++;
          console.warn("[cron] Force-releasing stale queued message (safety net)", {
            messageId: m._id.toString(),
            channelId: m.channelId?.toString(),
            queuedAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : null,
            reason: "max_queue_age_exceeded",
          });
        }

        await processRewritingMessage(m._id.toString());
        queuedProcessed++;
      } catch (err) {
        // One bad message must not strand the rest of the queue. Log and move
        // on — the message stays "queued" and is retried next cron run.
        console.error("[cron] Failed to process queued message — leaving queued for retry", {
          messageId: m._id?.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Delete denied images older than 30 days (spec: retain 30 days, then permanent removal).
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const expiredDenied = await Image.find({
      state: "denied",
      updatedAt: { $lt: thirtyDaysAgo },
    })
      .select("_id channelId storageUrl senderId")
      .limit(50)
      .lean();

    let deniedImagesDeleted = 0;
    for (const img of expiredDenied) {
      const key = img.storageUrl as string | undefined;
      if (key) {
        await deleteObjectFromS3(key);
      }
      await Image.deleteOne({ _id: img._id });
      await AuditLog.create({
        action: "image_retention_purge",
        channelId: img.channelId,
        targetUserId: img.senderId,
        metadata: {
          imageId: img._id.toString(),
          reason: "30_day_retention_expired",
          storageKey: key ?? null,
        },
      });
      deniedImagesDeleted++;
    }

    // 4. Retry SMS Outbox — durable retry for outbound SMS that hit Twilio
    //    transient failures. Sweep due rows; success → mark sent, failure
    //    → requeue with backoff or dead-letter after maxAttempts.
    const outboxResult = await processSmsOutbox(25);

    // 5. Reconcile scheduled Picture Sharing removals (#82). A mid-cycle
    //    toggle-off keeps access until pictureShareRemoveAt; once that passes
    //    the add-on switches off here. Standalone add-on subs also self-cancel
    //    via the customer.subscription.deleted webhook — this is the catch-all
    //    and the path for the creator's bundled line-item add-on.
    const nowTs = new Date();
    const expiredPicture = await Channel.find({
      pictureShareEnabled: true,
      pictureShareRemoveAt: { $ne: null, $lte: nowTs },
    })
      .select("_id")
      .lean();
    let pictureSharingRemoved = 0;
    for (const ch of expiredPicture) {
      await Channel.updateOne(
        { _id: ch._id },
        {
          $set: {
            pictureShareEnabled: false,
            pictureShareRemoveAt: null,
            pictureAddonPurchasedBy: null,
          },
        }
      );
      await Subscription.updateMany(
        { channelId: ch._id, isAddon: false },
        { $set: { plan: "core" } }
      );
      await AuditLog.create({
        action: "picture_sharing_removed",
        channelId: ch._id,
        metadata: { reason: "scheduled_period_end_cron" },
      });
      pictureSharingRemoved++;
    }

    // 6. Safety net: expire per-channel cancelled subscriptions whose billing
    //    period has ended. Normally handled by the invoice.paid webhook; this
    //    catches any events that were missed or delivered out of order.
    const expiredCancelled = await Subscription.find({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { $lt: nowTs },
      status: { $in: ["active", "trialing"] },
    }).lean();
    let channelCancellationsExpired = 0;
    for (const sub of expiredCancelled) {
      await Subscription.updateOne(
        { _id: sub._id },
        { $set: { status: "canceled", cancelAtPeriodEnd: false } }
      );
      if (sub.channelId) {
        await Channel.updateOne(
          { _id: sub.channelId },
          { $set: { state: "view_only" } }
        );
        await AuditLog.create({
          action: "channel_subscription_expired",
          channelId: sub.channelId,
          metadata: {
            subscriptionId: sub._id.toString(),
            reason: "per_channel_cancel_period_end_cron",
          },
        });
      }
      channelCancellationsExpired++;
    }

    return NextResponse.json({
      trialExpired: trialChannels.length,
      queuedProcessed,
      queuedForceReleased,
      deniedImagesDeleted,
      pictureSharingRemoved,
      channelCancellationsExpired,
      sms: outboxResult,
    });
  } catch (error) {
    console.error("cron error:", error);
    return NextResponse.json(
      { error: "Cron failed" },
      { status: 500 }
    );
  }
}
