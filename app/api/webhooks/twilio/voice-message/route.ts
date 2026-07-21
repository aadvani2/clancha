import { NextRequest, NextResponse } from "next/server";
import { a12VoiceCallMessage } from "@/lib/messaging/appendixA";
// validateTwilioSignature is intentionally not imported while the signature
// check is commented out (parity with the SMS webhook). Re-import it from
// "@/lib/services/twilio" when enabling validation in both routes together.

/**
 * Twilio Voice webhook (M4 sign-off item 56).
 *
 * A voice call to a Clancha number must play the Appendix A message A12
 * verbatim and then terminate immediately — NO voicemail, NO recording, NO
 * routing/forwarding. The TwiML below is intentionally limited to <Say> +
 * <Hangup/>: there is deliberately no <Record>, <Dial>, <Gather> or any
 * voicemail/forwarding verb.
 *
 * Twilio POSTs to voice webhooks (application/x-www-form-urlencoded), so this
 * mirrors the SMS webhook's conventions: read params from formData, validate
 * the X-Twilio-Signature, and return TwiML with Content-Type: text/xml.
 *
 * NOTE (external config): the Clancha numbers' Voice webhook URL must be
 * pointed at this route (.../api/webhooks/twilio/voice-message) in the Twilio
 * Console — see getTwilioVoiceUrl() in lib/services/twilio.ts. That wiring is
 * a Twilio Console step Craig/Anas must perform; this file is only the handler.
 */

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

/**
 * TwiML that plays A12 (UK English voice) and hangs up. No voicemail, no
 * recording, no dial/forward, no gather.
 */
function buildHangupTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy" language="en-GB">${escapeXml(a12VoiceCallMessage())}</Say>
  <Hangup/>
</Response>`;
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
    // Parity with the SMS webhook: validation is wired up the same way and kept
    // commented in lock-step with that route. Enable in both routes together
    // once the production Twilio signing URL is confirmed.
    // if (accountSid && authToken && !validateTwilioSignature(signature, url, params)) {
    //   console.warn("[voice-webhook] ✗ Invalid Twilio signature — rejecting request", { url });
    //   return new NextResponse("Invalid signature", {
    //     status: 403,
    //     headers: { "Content-Type": "text/plain" },
    //   });
    // }
    void accountSid;
    void authToken;
    void signature;
    void url;

    console.log("[voice-webhook] ▶ Inbound voice call — playing A12 then hangup", {
      callSid: params.CallSid ?? "unknown",
    });

    return new NextResponse(buildHangupTwiml(), {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[voice-webhook] ✗ UNHANDLED EXCEPTION — falling back to A12 hangup", {
      errorMessage: err.message,
    });
    // Even on error, never offer voicemail/forwarding: still play A12 and hang up.
    return new NextResponse(buildHangupTwiml(), {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }
}
