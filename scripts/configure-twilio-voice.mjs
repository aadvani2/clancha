/**
 * Configure Twilio Voice webhook for every number in the Clancha phone pool.
 *
 * Background: Craig's M4 tracker item 56 — calling a Clancha number played a
 * Twilio default greeting rather than the A12 verbatim message. Our code DOES
 * have the correct A12 wired in the webhook handler at /api/webhooks/twilio,
 * but the Twilio numbers themselves weren't pointed at it for Voice. They
 * only had SMS webhooks configured; Voice fell back to the Twilio default.
 *
 * This script:
 *   1. Reads every active phone number from the `phonenumbers` collection.
 *   2. Looks up the matching Twilio IncomingPhoneNumber resource.
 *   3. Sets voiceUrl + voiceMethod to point at our webhook so inbound calls
 *      trigger the A12 Say + Hangup TwiML response.
 *
 * Usage:
 *   node scripts/configure-twilio-voice.mjs
 *   WEBHOOK_BASE='https://clancha.stagingenv.app' node scripts/configure-twilio-voice.mjs
 *
 * Idempotent — running it again on an already-configured number is a no-op
 * on the Twilio side beyond a fresh API call.
 */
import "dotenv/config";
import mongoose from "mongoose";
import twilio from "twilio";

const WEBHOOK_BASE = (process.env.WEBHOOK_BASE || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const VOICE_PATH = "/api/webhooks/twilio";

if (!WEBHOOK_BASE) {
  console.error("WEBHOOK_BASE / NEXT_PUBLIC_APP_URL must be set (e.g. https://clancha.stagingenv.app)");
  process.exit(1);
}

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
if (!accountSid || !authToken) {
  console.error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing from env");
  process.exit(1);
}

const client = twilio(accountSid, authToken);

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI missing");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.name}\n`);

  const col = mongoose.connection.db.collection("phonenumbers");
  const pool = await col.find({}).toArray();
  console.log(`Pool has ${pool.length} number(s). Webhook base = ${WEBHOOK_BASE}\n`);

  const voiceUrl = `${WEBHOOK_BASE}${VOICE_PATH}`;
  const smsUrl = `${WEBHOOK_BASE}${VOICE_PATH}`;

  for (const entry of pool) {
    const num = entry.number;
    const active = entry.isActive;
    process.stdout.write(`  ${num.padEnd(16)}  active=${String(active).padEnd(5)}  `);

    try {
      // Look up the Twilio IncomingPhoneNumber by phoneNumber field.
      const matches = await client.incomingPhoneNumbers.list({ phoneNumber: num, limit: 1 });
      if (matches.length === 0) {
        console.log("✗ not found on Twilio (skipped)");
        continue;
      }
      const phoneRes = matches[0];

      // Update voice + SMS webhooks. Twilio idempotently accepts the same URLs.
      await client.incomingPhoneNumbers(phoneRes.sid).update({
        voiceUrl,
        voiceMethod: "POST",
        smsUrl,
        smsMethod: "POST",
      });
      console.log(`✓ updated  (sid=${phoneRes.sid.slice(0, 10)}…)`);
    } catch (err) {
      console.log(`✗ error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\nVoice webhook target:  " + voiceUrl);
  console.log("SMS webhook target:    " + smsUrl);
  console.log("\nInbound calls to any of these numbers will now play A12 verbatim and hang up.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
