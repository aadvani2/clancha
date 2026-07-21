import { AuditLog } from "@/lib/db/models";

/**
 * Surface an OTP / auth SMS failure on the admin Failures page (#59).
 *
 * OTP runs through Twilio Verify, so failures are logged under
 * `service_failure_twilio` with an `operation` tag (`otp_send` / `otp_verify`)
 * to distinguish them from message-send failures. They then show up in the
 * Twilio failure count and the recent-failures list (which renders `operation`)
 * exactly like every other service failure — so an OTP send that fails no
 * longer disappears silently (Craig 12 Jun: "a real OTP send failure today did
 * not appear anywhere in the Failures log").
 *
 * IMPORTANT: a wrong/expired code is a NORMAL auth outcome (the Verify check
 * returns `false`) and must NOT be logged here — only a genuine thrown
 * Twilio/transport error (the real "send failed" case) is a service failure.
 *
 * The caller must have an active DB connection. This never throws — logging a
 * failure must not mask the original error from the user.
 */
export async function logOtpFailure(
  operation: "otp_send" | "otp_verify",
  phone: string,
  error: unknown,
  extra?: Record<string, unknown>
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string | number } | null)?.code;
  await AuditLog.create({
    action: "service_failure_twilio",
    metadata: {
      operation,
      // Redact to the last 4 digits — enough to identify the row, never the
      // full recipient number.
      to:
        typeof phone === "string" && phone.length >= 4
          ? `***${phone.slice(-4)}`
          : "***",
      message,
      ...(code !== undefined ? { code } : {}),
      ...extra,
    },
  }).catch(() => {});
}
