/**
 * Twilio Verify helpers for sending and checking OTP.
 * Uses Verify API so no A2P 10DLC registration is needed for US SMS.
 */

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").trim();
}

export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{1,14}$/.test(phone);
}

function getVerifyClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) {
    throw new Error(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID are required for Twilio Verify"
    );
  }
  return { serviceSid, accountSid, authToken };
}

/**
 * Test/dev OTP bypass.
 * If OTP_TEST_BYPASS_CODE is set AND we're not in production, treat that
 * literal code as a valid OTP for any phone. Used by Playwright E2E to
 * bypass the Twilio SMS round-trip. Refuses to engage in production no
 * matter what the env says.
 */
function bypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    typeof process.env.OTP_TEST_BYPASS_CODE === "string" &&
    process.env.OTP_TEST_BYPASS_CODE.length >= 4
  );
}

/**
 * Send OTP via Twilio Verify (SMS). No A2P 10DLC needed.
 */
export async function sendVerificationWithTwilioVerify(toE164: string): Promise<void> {
  // In bypass mode we still log so the test can see this fired, but skip
  // calling Twilio entirely — saves SMS spend in CI and avoids needing
  // real Twilio creds for tests.
  if (bypassEnabled()) {
    console.log("[twilio-verify] BYPASS — pretending to send OTP to", toE164.slice(-4));
    return;
  }
  const { serviceSid, accountSid, authToken } = getVerifyClient();
  const twilio = await import("twilio");
  const client = twilio.default(accountSid, authToken);
  await client.verify.v2
    .services(serviceSid)
    .verifications.create({ to: toE164, channel: "sms" });
}

/**
 * Check OTP with Twilio Verify. Returns true if code is valid.
 */
export async function checkVerificationWithTwilioVerify(
  toE164: string,
  code: string
): Promise<boolean> {
  const trimmedCode = code.trim();

  if (bypassEnabled()) {
    if (trimmedCode === process.env.OTP_TEST_BYPASS_CODE) {
      console.log("[twilio-verify] BYPASS — accepting test OTP for", toE164.slice(-4));
      return true;
    }

    console.warn("[twilio-verify] BYPASS — rejecting non-test OTP for", toE164.slice(-4));
    return false;
  }

  const { serviceSid, accountSid, authToken } = getVerifyClient();
  const twilio = await import("twilio");
  const client = twilio.default(accountSid, authToken);
  const check = await client.verify.v2
    .services(serviceSid)
    .verificationChecks.create({ to: toE164, code: trimmedCode });
  return check.status === "approved";
}
