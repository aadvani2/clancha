import Twilio from "twilio";
import connectDB from "@/lib/db/connect";
import { SmsOutbox, AuditLog } from "@/lib/db/models";
import { assertTwilioOperational, SimulatedOutageError } from "./outageSimulation";
import { isValidE164 } from "@/lib/auth/twilio-verify";
import { toGsm7Safe } from "@/lib/messaging/gsm7";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

let client: Twilio.Twilio | null = null;

export function getTwilioClient(): Twilio.Twilio | null {
  if (!accountSid || !authToken) return null;
  if (!client) {
    client = Twilio(accountSid, authToken);
  }
  return client;
}

export interface SmsResult {
  success: boolean;
  sid?: string;
  status?: string;
  error?: string;
  /** Twilio error code, when the failure came back from the Twilio API. */
  code?: number;
  /**
   * True when the failure can never succeed on retry (malformed destination,
   * unroutable region, unsubscribed recipient). sendSmsWithRetry uses this to
   * skip the SmsOutbox retry schedule so a permanent failure does not burn
   * five attempts before dead-lettering (M4 tracker #57).
   */
  permanent?: boolean;
}

/**
 * Twilio error codes that represent a PERMANENT delivery failure — retrying
 * the exact same send can never succeed, so we must not queue it for the
 * five-attempt backoff. Sources: Twilio error reference.
 *   21211 — Invalid 'To' phone number
 *   21214 — 'To' number is not a valid mobile number
 *   21408 — Permission to send to this region is not enabled
 *   21610 — Recipient has unsubscribed (STOP)
 *   21612 — 'To' number is not currently reachable / not routable
 *   21614 — 'To' number is not a valid mobile number (cannot receive SMS)
 */
const PERMANENT_TWILIO_ERROR_CODES = new Set([21211, 21214, 21408, 21610, 21612, 21614]);

export function isPermanentTwilioError(code: number | undefined): boolean {
  return typeof code === "number" && PERMANENT_TWILIO_ERROR_CODES.has(code);
}

/**
 * Send outbound SMS/MMS. Returns an SmsResult object.
 * Non-US destinations: sends directly from `fromNumberOverride` (the channel's Clancha number).
 *   - Images are NOT supported via MMS for non-US numbers (UK +44 etc. don't support MMS).
 *   - Appends imageUrl to the body as a plain link.
 * US destinations: requires TWILIO_MESSAGING_SERVICE_SID (A2P 10DLC compliance).
 *   - MMS is supported: imageUrl is sent as mediaUrl (true MMS).
 */
export async function sendSms(
  toE164: string,
  body: string,
  fromNumberOverride?: string,
  imageUrl?: string
): Promise<SmsResult> {
  const twilio = getTwilioClient();
  if (!twilio) {
    return { success: false, error: "Twilio client not initialized (check env)" };
  }

  const to = toE164.startsWith("+") ? toE164 : `+${toE164}`;
  const toMasked = to.length >= 4 ? `***${to.slice(-4)}` : "***";

  // Validate the destination up front (M4 tracker #57). An obviously malformed
  // number can never be delivered, so reject it here rather than handing it to
  // Twilio and letting sendSmsWithRetry queue it for five doomed retries. This
  // runs BEFORE the outage check so a bad number is rejected even mid-outage.
  if (!isValidE164(to)) {
    console.error("[twilio] sendSms rejected — invalid destination", { to: toMasked });
    await AuditLog.create({
      action: "service_failure_twilio",
      metadata: {
        operation: "invalid_destination",
        toMasked,
        message: "Destination is not a valid E.164 number — not sent, not queued.",
      },
    }).catch(() => {});
    return {
      success: false,
      error: "Invalid destination number (must be E.164, e.g. +447911123456)",
      status: "invalid_destination",
      permanent: true,
    };
  }

  const isUsDestination = to.startsWith("+1");
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID ?? "").trim();

  // Wire-level GSM-7 guard (Craig, M4 feedback 05/07/26 §1.2): every
  // outbound body is normalised here, whatever produced it, so one stray
  // curly quote or dash can never flip the message into the expensive
  // UCS-2 encoding. Rendering only — wording is never changed.
  let finalBody = toGsm7Safe(body);

  // Non-US destinations: Append image URL to body since MMS isn't supported
  if (!isUsDestination && imageUrl && !finalBody.includes(imageUrl)) {
    finalBody = `${finalBody}\n\n${imageUrl}`; // Double newline for clarity
  }

  try {
    // Admin-toggleable outage simulation (M4 tracker #57). When the flag is
    // on, throw the same way a Twilio outage would so sendSmsWithRetry queues
    // the message into SmsOutbox and the cron sweep resumes delivery once the
    // flag is cleared. Real Twilio calls are skipped entirely.
    await assertTwilioOperational();

    let msg;
    if (!isUsDestination && fromNumberOverride) {
      // Direct send from channel number (UK/International)
      console.log("[twilio] sendSms direct (non-US)", { to: toMasked, from: `***${fromNumberOverride.slice(-4)}` });
      msg = await twilio.messages.create({ from: fromNumberOverride, to, body: finalBody });
    } else if (messagingServiceSid.startsWith("MG")) {
      // Messaging Service send (US A2P 10DLC)
      console.log("[twilio] sendSms via Messaging Service", { to: toMasked, isUs: isUsDestination });
      msg = await twilio.messages.create({
        messagingServiceSid,
        to,
        body: finalBody,
        ...(isUsDestination && imageUrl ? { mediaUrl: [imageUrl] } : {}),
      });
    } else {
      const error = isUsDestination
        ? "US destination requires TWILIO_MESSAGING_SERVICE_SID (A2P 10DLC)"
        : "No fromNumberOverride provided for non-US destination";
      console.error(`[twilio] sendSms skipped: ${error}`, { to: toMasked });
      return { success: false, error };
    }

    console.log("[twilio] sendSms success", {
      sid: msg.sid,
      status: msg.status,
      to: toMasked,
    });

    return {
      success: ["queued", "sent", "delivered"].includes(msg.status),
      sid: msg.sid,
      status: msg.status,
    };
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string; status?: number };
    const simulated = err instanceof SimulatedOutageError;
    const permanent = isPermanentTwilioError(e.code);
    console.error("[twilio] sendSms exception", {
      to: toMasked,
      code: e.code,
      message: e.message,
      simulated,
      permanent,
    });
    // Audit the failure so it shows up on the Activity feed alongside business
    // events. Not channel-scoped — sendSms is called from many places and we
    // don't know the channel here. Caller-side audit (rewritePipeline,
    // moderator/review) already logs the message-level context separately.
    await AuditLog.create({
      action: "service_failure_twilio",
      metadata: {
        operation: "sendSms",
        toMasked,
        code: e.code,
        message: e.message,
        twilioStatus: e.status,
        simulated,
        permanent,
      },
    }).catch(() => {});
    return { success: false, error: e.message, status: "failed", code: e.code, permanent };
  }
}

export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!authToken) return false;
  return Twilio.validateRequest(authToken, signature, url, params);
}

export function getTwilioVoiceUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://example.com";
  return `${base}/api/webhooks/twilio/voice-message`;
}

const RETRY_BACKOFF_MINUTES = [5, 10, 20, 40, 80];

/**
 * Send SMS with durable retry on transient failure.
 *
 * Tries the immediate send; if it fails, persists an SmsOutbox row and
 * returns a queued result so callers see the message as "in flight" rather
 * than a hard error. The /api/cron sweep retries due outbox rows with
 * exponential backoff and dead-letters after maxAttempts (default 5).
 *
 * Use this for outbound SMS where loss is not acceptable per spec
 * ("for Twilio outages, outbound messages must be queued with no data
 * lost, and delivery must auto-resume on recovery").
 *
 * Permanent failures (malformed destination, unroutable region, unsubscribed
 * recipient) are NOT queued — retrying can never succeed and would only burn
 * the five-attempt backoff before dead-lettering. They were already audited in
 * sendSms; we surface them straight back to the caller (M4 tracker #57).
 */
export async function sendSmsWithRetry(
  toE164: string,
  body: string,
  fromNumberOverride?: string,
  imageUrl?: string
): Promise<SmsResult> {
  const result = await sendSms(toE164, body, fromNumberOverride, imageUrl);
  if (result.success) return result;

  if (result.permanent) {
    console.warn("[twilio] sendSmsWithRetry — permanent failure, not queued for retry", {
      reason: result.error,
      code: result.code,
    });
    return { success: false, error: result.error, status: "failed", code: result.code, permanent: true };
  }

  // Persist for retry. We catch DB errors here because we'd rather log loudly
  // than throw out of an SMS code path.
  try {
    await connectDB();
    const firstBackoff = RETRY_BACKOFF_MINUTES[0] ?? 5;
    const nextAttemptAt = new Date(Date.now() + firstBackoff * 60_000);
    await SmsOutbox.create({
      to: toE164.startsWith("+") ? toE164 : `+${toE164}`,
      body,
      fromNumberOverride: fromNumberOverride ?? null,
      imageUrl: imageUrl ?? null,
      attempts: 1,
      nextAttemptAt,
      status: "pending",
      lastError: result.error ?? null,
    });
    console.warn("[twilio] sendSmsWithRetry — direct send failed, queued for retry", {
      reason: result.error,
      retryInMin: firstBackoff,
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[twilio] sendSmsWithRetry — failed to enqueue retry, message LOST", {
      reason: result.error,
      enqueueError: e.message,
    });
    return { success: false, error: result.error ?? "send failed and outbox unavailable", status: "failed" };
  }

  return {
    success: true,
    sid: undefined,
    status: "queued_for_retry",
  };
}

/**
 * Process due SmsOutbox rows. Called by /api/cron.
 * Returns counts of sent, retrying, dead-lettered.
 */
export async function processSmsOutbox(maxToProcess: number = 25): Promise<{
  sent: number;
  retrying: number;
  deadLettered: number;
}> {
  await connectDB();
  const now = new Date();

  const due = await SmsOutbox.find({
    status: "pending",
    nextAttemptAt: { $lte: now },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(maxToProcess);

  let sent = 0;
  let retrying = 0;
  let deadLettered = 0;

  for (const row of due) {
    const attempt = await sendSms(
      row.to,
      row.body,
      row.fromNumberOverride ?? undefined,
      row.imageUrl ?? undefined
    );

    row.attempts = (row.attempts ?? 0) + 1;
    if (attempt.success) {
      row.status = "sent";
      row.sid = attempt.sid ?? null;
      row.lastError = null;
      sent++;
    } else if (attempt.permanent || row.attempts >= row.maxAttempts) {
      // Permanent failure → dead-letter immediately (don't keep retrying a
      // send that can never succeed). Otherwise dead-letter once the attempt
      // budget is exhausted (M4 tracker #57).
      row.status = "failed";
      row.lastError = attempt.error ?? "max retries exceeded";
      deadLettered++;
      console.error("[twilio] outbox dead-letter", {
        outboxId: row._id.toString(),
        attempts: row.attempts,
        permanent: !!attempt.permanent,
        lastError: row.lastError,
      });
      // Surface the dead-letter (max retries exhausted) on the Activity feed
      // so an admin can spot SMS that went permanently un-delivered.
      await AuditLog.create({
        action: "service_failure_twilio",
        metadata: {
          operation: "outbox_dead_letter",
          outboxId: row._id.toString(),
          attempts: row.attempts,
          permanent: !!attempt.permanent,
          code: attempt.code,
          lastError: row.lastError,
        },
      }).catch(() => {});
    } else {
      const backoffIdx = Math.min(row.attempts - 1, RETRY_BACKOFF_MINUTES.length - 1);
      const minutes = RETRY_BACKOFF_MINUTES[backoffIdx];
      row.nextAttemptAt = new Date(Date.now() + minutes * 60_000);
      row.lastError = attempt.error ?? null;
      retrying++;
    }
    await row.save();
  }

  return { sent, retrying, deadLettered };
}
