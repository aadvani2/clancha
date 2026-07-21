import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, User, Message, UserChannelPreferences, AuditLog } from "@/lib/db/models";
import type { Types } from "mongoose";
import { validateTwilioSignature, sendSmsWithRetry } from "@/lib/services/twilio";
import {
  normalizePhoneForMatch,
  isWithinReceivingHours,
  getInitialMessageState,
} from "@/lib/utils/routing";
import { processRewritingMessage } from "@/lib/services/rewritePipeline";
import {
  a2MessageQueuedOutsideHours,
  a3EmergencyDeliveryConfirmationSender,
  a4EmergencyDeliveryDeniedSender,
  a6MmsPictureSharingPortalOnly,
  a7MmsPictureSharingUpgrade,
  a10ChannelViewOnlyReactivate,
  a12VoiceCallMessage,
} from "@/lib/messaging/appendixA";
import { storeSystemMessage } from "@/lib/messaging/storeSystemMessage";
import { receivingHoursResumeTimeLabel } from "@/lib/utils/receivingHoursResume";

function getWebhookUrl(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || "";
  return `${proto}://${host}${request.nextUrl.pathname}`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = typeof value === "string" ? value : value.toString();
    });

    const signature = request.headers.get("x-twilio-signature") ?? "";
    const url = getWebhookUrl(request);
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    // ── Signature validation ──────────────────────────────────────────────────
    // if (accountSid && authToken && !validateTwilioSignature(signature, url, params)) {
    //   console.warn("[webhook] ✗ Invalid Twilio signature — rejecting request", { url });
    //   return new NextResponse("Invalid signature", {
    //     status: 403,
    //     headers: { "Content-Type": "text/plain" },
    //   });
    // }

    // ── Voice call — ignore ───────────────────────────────────────────────────
    if (params.CallSid) {
      console.log("[webhook] Voice call received — responding with SMS-only message", {
        callSid: params.CallSid,
      });
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapeXml(a12VoiceCallMessage())}</Say>
  <Hangup/>
</Response>`;
      return new NextResponse(twiml, {
        headers: { "Content-Type": "text/xml" },
      });
    }

    const fromPhone = params.From ?? "";
    const toPhone = params.To ?? "";
    const body = (params.Body ?? "").trim();
    const numMedia = parseInt(params.NumMedia || "0", 10);

    console.log("[webhook] ▶ Inbound SMS received", {
      from: fromPhone.length >= 4 ? `***${fromPhone.slice(-4)}` : "***",
      to: toPhone.length >= 4 ? `***${toPhone.slice(-4)}` : "***",
      bodyLength: body.length,
      numMedia,
      messageSid: params.MessageSid ?? "unknown",
    });

    if (!body && numMedia === 0) {
      console.warn("[webhook] ✗ Empty body — ignoring");
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    await connectDB();

    const toNorm = toPhone.startsWith("+") ? toPhone : `+${toPhone}`;
    const senderPhoneNorm = normalizePhoneForMatch(fromPhone);
    const twilioSid = params.MessageSid;

    if (numMedia > 0) {
      console.log("[webhook] MMS received — rejecting with Appendix A6/A7", { fromPhone });
      const allUsers = await User.find({ phone: { $exists: true, $ne: "" } }).select("_id phone").lean();
      const mmsSender = allUsers.find(
        (u) => normalizePhoneForMatch(u.phone ?? "") === senderPhoneNorm
      );
      // Prefer the active/trial channel for the MMS pictureShareEnabled lookup
      // — same disambiguation rule as the main routing below.
      const mmsMatch = mmsSender
        ? {
            users: mmsSender._id,
            $or: [{ clanchaNumber: toPhone }, { clanchaNumber: toNorm }],
          }
        : null;
      const mmsChannel = mmsMatch
        ? ((await Channel.findOne({ ...mmsMatch, state: { $in: ["trial", "active"] } })
            .select("pictureShareEnabled clanchaNumber")
            .lean()) ??
          (await Channel.findOne(mmsMatch).select("pictureShareEnabled clanchaNumber").lean()))
        : null;
      const mmsBody = mmsChannel?.pictureShareEnabled
        ? a6MmsPictureSharingPortalOnly()
        : a7MmsPictureSharingUpgrade();
      const res = await sendSmsWithRetry(fromPhone, mmsBody, mmsChannel?.clanchaNumber ?? params.To);
      console.log("[webhook] MMS rejection SMS sent", { success: res.success, sid: res.sid });
      if (mmsChannel?._id) {
        // A6/A7 MMS rejection is a sender-only notice → scope to the sender.
        await storeSystemMessage(mmsChannel._id, mmsBody, undefined, mmsSender?._id ?? null);
      }
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    if (!body) {
      console.warn("[webhook] ✗ Empty body — ignoring");
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    // ── Step 1: Find sender user by phone ─────────────────────────────────────
    // Look up the sender first so we can find THEIR specific channel, not just
    // any channel on this Clancha number (multiple channels can share a number).
    const allUsers = await User.find({ phone: { $exists: true, $ne: "" } }).select("_id phone").lean();
    const sender = allUsers.find(
      (u) => normalizePhoneForMatch(u.phone ?? "") === senderPhoneNorm
    );

    console.log("[webhook] Step 1 — sender lookup by phone", {
      fromNorm: senderPhoneNorm,
      found: !!sender,
      senderId: sender?._id?.toString() ?? "none",
    });

    if (!sender) {
      console.warn("[webhook] Step 1 — ✗ Sender phone not found in any user", {
        fromNorm: senderPhoneNorm,
      });
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    // ── Step 2: Find the channel that belongs to this sender + Clancha number ──
    // Invariant: a user should only have ONE channel per clanchaNumber (enforced
    // at allocation time in numberPool.reserveNumber). If duplicates slip in
    // (E2E test artefacts, hand-crafted seeds), prefer trial/active over
    // view_only/closed so inbound routes to the channel that can actually
    // receive. Falls back to ANY matching channel so the view_only / closed
    // reactivation reply still fires when that's the only match.
    const matchFilter = {
      users: sender._id,
      $or: [{ clanchaNumber: toPhone }, { clanchaNumber: toNorm }],
    };
    const channelAny =
      (await Channel.findOne({ ...matchFilter, state: { $in: ["trial", "active"] } }).lean()) ??
      (await Channel.findOne(matchFilter).lean());

    console.log("[webhook] Step 2 — channel lookup for sender", {
      senderId: sender._id.toString(),
      toNorm,
      found: !!channelAny,
      channelId: channelAny?._id?.toString() ?? "none",
      channelState: channelAny?.state ?? "none",
    });

    if (!channelAny) {
      console.warn("[webhook] Step 2 — ✗ No channel found for this sender + Clancha number", {
        senderId: sender._id.toString(),
        toNorm,
      });
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    // ── Step 3: Block if channel is paused/closed ─────────────────────────────
    if (channelAny.state === "view_only" || channelAny.state === "closed") {
      console.log("[webhook] Step 3 — channel is paused/closed, sending reactivation SMS", {
        channelId: channelAny._id.toString(),
        channelState: channelAny.state,
      });
      const reactivationMsg = a10ChannelViewOnlyReactivate();
      const res = await sendSmsWithRetry(fromPhone, reactivationMsg, channelAny.clanchaNumber ?? undefined);
      console.log("[webhook] Reactivation SMS sent", { success: res.success, sid: res.sid });
      // A10 reactivation prompt is sent to (and concerns) the sender who tried
      // to message on a view-only/closed channel → scope to the sender.
      await storeSystemMessage(channelAny._id, reactivationMsg, undefined, sender._id ?? null);
      await AuditLog.create({
        action: "message_channel_blocked",
        channelId: channelAny._id,
        metadata: {
          reason: "view_only_or_closed",
          senderPhone: fromPhone,
          state: channelAny.state,
          smsSid: res.sid,
        },
      });
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    const channel = channelAny;
    console.log("[webhook] Step 3 — active channel confirmed", {
      channelId: channel._id.toString(),
      channelState: channel.state,
      clanchaNumber: channel.clanchaNumber ? `***${channel.clanchaNumber.slice(-4)}` : "not set",
      userCount: (channel.users as Types.ObjectId[]).length,
      emergencyBypassEnabled: channel.emergencyBypassEnabled,
    });

    console.log("[webhook] Step 4 — sender confirmed in channel", {
      channelId: channel._id.toString(),
      senderId: sender._id.toString(),
    });

    // ── Step 5: Identify recipient ────────────────────────────────────────────
    const userIds = channel.users as Types.ObjectId[];
    const recipientUserId = userIds.find(
      (id) => id.toString() !== sender._id.toString()
    );
    if (!recipientUserId) {
      console.warn("[webhook] Step 5 — ✗ No recipient in channel (only one user?)", {
        channelId: channel._id.toString(),
        senderId: sender._id.toString(),
        allUserIds: userIds.map((id) => id.toString()),
      });
      return new NextResponse("<Response/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }
    console.log("[webhook] Step 5 — recipient identified", {
      channelId: channel._id.toString(),
      recipientUserId: recipientUserId.toString(),
    });

    // ── Step 6: Load recipient prefs + receiving hours ────────────────────────
    // const recipientPrefs = await UserChannelPreferences.findOne({
    //   userId: recipientUserId,
    //   channelId: channel._id,
    // }).lean();

    const recipient: any = await User.findById(recipientUserId);

    // CHANNEL IS THE ABSOLUTE SOURCE OF TRUTH: 
    // If channel receiving hours are null, it means ALWAYS OPEN (24/7).
    const hStart = recipient?.receivingHoursStart ?? null;
    const hEnd = recipient?.receivingHoursEnd ?? null;

    // Use London as the master clock for channel settings to guarantee symmetry
    const effectiveTz = recipient?.timezone ?? "Europe/London";

    const withinHours = isWithinReceivingHours({
      receivingHoursStart: hStart,
      receivingHoursEnd: hEnd,
      timezone: effectiveTz,
    });

    console.log("[webhook] Step 6 — receiving hours check (Channel Priority)", {
      channelId: channel._id.toString(),
      recipientUserId: recipientUserId.toString(),
      effectiveStart: hStart ?? "always open",
      effectiveEnd: hEnd ?? "always open",
      withinHours,
    });

    // ── Step 7: Decide initial state ──────────────────────────────────────────
    const decision = getInitialMessageState(
      body,
      channel.emergencyBypassEnabled,
      withinHours
    );
    const initialState = decision.state as "queued" | "rewriting";

    console.log("[webhook] Step 7 — routing decision", {
      channelId: channel._id.toString(),
      initialState,
      isEmergency: decision.isEmergency,
      isTrigger: decision.isTrigger,
      withinHours,
      emergencyBypassEnabled: channel.emergencyBypassEnabled,
    });

    // ── Step 7.5: Handle Emergency Triggers ───────────────────────────────────
    if (decision.isTrigger) {
      console.log("[webhook] Emergency trigger received. Processing...", {
        channelId: channel._id.toString(),
        senderId: sender._id.toString(),
        body
      });

      // IDEMPOTENCY: Ensure we don't process the same trigger twice (Twilio retries)
      if (twilioSid) {
        const existingTrigger = await AuditLog.findOne({
          action: { $in: ["message_emergency_delivered", "message_emergency_trigger_ignored"] },
          "metadata.triggerSid": twilioSid
        }).lean();
        if (existingTrigger) {
          console.warn("[webhook] Duplicate trigger detected, skipping", { twilioSid });
          return new NextResponse("<Response/>", { status: 200, headers: { "Content-Type": "text/xml" } });
        }
      }

      if (channel.emergencyBypassEnabled) {
        // SENIOR EXPERT FIX: Use atomic findOneAndUpdate to claim the message immediately
        // This prevents race conditions and duplicate delivery if triggers are sent back-to-back.
        const lastQueued = await Message.findOneAndUpdate(
          {
            channelId: channel._id,
            senderId: sender._id,
            state: "queued"
          },
          {
            $set: {
              state: "rewriting",
              isEmergency: true, // Triggering AI rewrite for delivery (no bypass anymore)
            }
          },
          {
            sort: { createdAt: -1 },
            new: true
          }
        );

        if (lastQueued) {
          // FIRST: Send confirmation back to sender for immediate response
          const confirmationMsg = a3EmergencyDeliveryConfirmationSender();
          const res = await sendSmsWithRetry(fromPhone, confirmationMsg, channel.clanchaNumber ?? undefined);
          console.log("[webhook] Emergency confirmation SMS sent", { success: res.success, sid: res.sid });
          // A3 emergency-delivery confirmation is a sender-only notice → scope to the sender.
          await storeSystemMessage(channel._id, confirmationMsg, undefined, sender._id ?? null);

          // SECOND: Deliver the actual message (this part handles AI rewrite)
          await processRewritingMessage(lastQueued._id.toString());

          await AuditLog.create({
            action: "message_emergency_delivered",
            channelId: channel._id,
            actorUserId: sender._id,
            metadata: { 
              originalMessageId: lastQueued._id.toString(),
              smsSid: res.sid,
              smsSuccess: res.success,
              triggerBody: body,
              triggerSid: twilioSid
            },
          });
        } else {
          console.log("[webhook] Emergency trigger received but queue is empty", {
            channelId: channel._id.toString(),
            senderId: sender._id.toString()
          });
          const emptyQueueMsg = "No pending messages to deliver";
          const res = await sendSmsWithRetry(fromPhone, emptyQueueMsg, channel.clanchaNumber ?? undefined);
          console.log("[webhook] Empty queue notification sent", { success: res.success });
          
          await AuditLog.create({
            action: "message_emergency_trigger_ignored",
            channelId: channel._id,
            actorUserId: sender._id,
            metadata: { 
              reason: "empty_queue",
              triggerSid: twilioSid
            },
          });
        }
      } else {
        console.log("[webhook] Emergency trigger received but bypass NOT enabled", {
          channelId: channel._id.toString()
        });
        const recipientForName = await User.findById(recipientUserId).select("name receivingHoursStart receivingHoursEnd timezone").lean();
        const resumeLabel = receivingHoursResumeTimeLabel({
          receivingHoursStart: recipientForName?.receivingHoursStart,
          receivingHoursEnd: recipientForName?.receivingHoursEnd,
          timezone: recipientForName?.timezone,
        });
        const disabledMsg = a4EmergencyDeliveryDeniedSender({
          recipientName: recipientForName?.name?.trim() || "The recipient",
          resumeTimeLabel: resumeLabel,
        });
        await sendSmsWithRetry(fromPhone, disabledMsg, channel.clanchaNumber ?? undefined);
        // A4 emergency-denied notice is a sender-only notice → scope to the sender.
        await storeSystemMessage(channel._id, disabledMsg, undefined, sender._id ?? null);
        
        await AuditLog.create({
          action: "message_emergency_trigger_ignored",
          channelId: channel._id,
          actorUserId: sender._id,
          metadata: { 
            reason: "bypass_disabled",
            triggerSid: twilioSid
          },
        });
      }

      // Triggers are never stored as messages in DB
      return new NextResponse("<Response/>", { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    // ── Step 8: Create message (IDEMPOTENT) ──────────────────────────────────
    if (twilioSid) {
      const existing = await Message.findOne({ providerSid: twilioSid }).lean();
      if (existing) {
        console.warn("[webhook] Step 8 — ⚠ Duplicate Twilio message (retry) — skipping", { 
          twilioSid, 
          existingId: existing._id 
        });
        return new NextResponse("<Response/>", { status: 200, headers: { "Content-Type": "text/xml" } });
      }
    }

    const newMessageData: any = {
      channelId: channel._id,
      senderId: sender._id,
      originalText: body,
      rewrittenText: body,
      state: initialState,
      isEmergency: decision.isEmergency,
    };
    // Only include providerSid if it's a valid string (not 'unknown' or falsy)
    if (typeof twilioSid === "string" && twilioSid !== "unknown") {
      newMessageData.providerSid = twilioSid;
    }
    const newMessage = await Message.create(newMessageData);
    console.log("[webhook] Step 8 — message created in DB", {
      messageId: newMessage._id.toString(),
      channelId: channel._id.toString(),
      state: initialState,
    });

    // ── Step 9: Route message ─────────────────────────────────────────────────
    // WE ONLY send a notification SMS if this is a REAL message, not a trigger command.
    if (initialState === "queued" && !decision.isTrigger) {
      console.log("[webhook] Step 9 — message QUEUED (outside receiving hours)", {
        messageId: newMessage._id.toString(),
        channelId: channel._id.toString(),
      });
      const resumeLabel = receivingHoursResumeTimeLabel({
        receivingHoursStart: recipient?.receivingHoursStart,
        receivingHoursEnd: recipient?.receivingHoursEnd,
        timezone: recipient?.timezone,
      });
      const recipientDisplayName =
        (typeof recipient?.name === "string" && recipient.name.trim()) || "The recipient";
      const queuedMsg = a2MessageQueuedOutsideHours({
        resumeTimeLabel: resumeLabel,
        recipientName: recipientDisplayName,
      });

      const res = await sendSmsWithRetry(fromPhone, queuedMsg, channel.clanchaNumber ?? undefined);
      console.log("[webhook] Queued notification SMS sent", { success: res.success, sid: res.sid });
      // A2 queued notice is delivered to and addressed to the SENDER (it tells
      // them their own message is held until the recipient's hours resume) →
      // scope to the sender so it never appears in the recipient's history.
      await storeSystemMessage(channel._id, queuedMsg, undefined, sender._id ?? null);
      
      await AuditLog.create({
        action: "message_queued",
        channelId: channel._id,
        actorUserId: sender._id,
        metadata: { 
          messageId: newMessage._id.toString(), 
          reason: "outside_receiving_hours",
          smsSid: res.sid,
          smsSuccess: res.success
        },
      });
      await AuditLog.create({
        action: "message_queued_notification_sent",
        channelId: channel._id,
        actorUserId: sender._id,
        metadata: { 
          messageId: newMessage._id.toString(),
          smsSid: res.sid 
        },
      });
    } else if (initialState === "rewriting") {
      console.log("[webhook] Step 9 — handing off to rewritePipeline", {
        messageId: newMessage._id.toString(),
      });
      const pipelineResult = await processRewritingMessage(newMessage._id.toString());
      console.log("[webhook] Step 9 — rewritePipeline completed", {
        messageId: newMessage._id.toString(),
        outcome: pipelineResult.outcome,
        error: pipelineResult.error ?? null,
      });
    }

    console.log("[webhook] ✓ Done");
    return new NextResponse("<Response/>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[webhook] ✗ UNHANDLED EXCEPTION", {
      errorMessage: err.message,
      stack: err.stack?.split("\n").slice(0, 5).join(" | "),
    });
    return new NextResponse("<Response/>", {
      status: 500,
      headers: { "Content-Type": "text/xml" },
    });
  }
}
