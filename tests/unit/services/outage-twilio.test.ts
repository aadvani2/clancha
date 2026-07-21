/**
 * Twilio outage + destination-validation verification (M4 tracker #57).
 *
 * Drives the REAL twilio service (sendSmsWithRetry / processSmsOutbox) against
 * the real SmsOutbox + OutageSimulation models, with only the Twilio SDK itself
 * mocked, and proves:
 *   1. During a (simulated) Twilio outage, outbound SMS is QUEUED into the
 *      outbox — nothing is lost — and the real Twilio API is never called.
 *   2. On recovery, the cron sweep (processSmsOutbox) AUTO-RESUMES delivery of
 *      the queued row to a valid UK number.
 *   3. An obviously malformed destination is rejected UP FRONT — not sent and
 *      not queued for five doomed retries.
 *   4. A permanent Twilio failure (region not enabled, 21408) is NOT retried —
 *      it fails immediately instead of burning the five-attempt backoff.
 *
 * This is the evidence harness for #57: run with
 *   npx vitest run tests/unit/services/outage-twilio.test.ts
 */
import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach,
} from "vitest";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { SmsOutbox, AuditLog, OutageSimulation } from "@/lib/db/models";
import { invalidateOutageCache } from "@/lib/services/outageSimulation";
import { sendSmsWithRetry, processSmsOutbox } from "@/lib/services/twilio";

// connectDB() is called inside the service on every hop; the in-memory mongoose
// connection is already live, so it must no-op.
vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

// Mock the Twilio SDK so getTwilioClient() returns a fake whose messages.create
// we control. Variable is "mock"-prefixed so vitest allows it in the hoisted
// factory. twilio.ts calls Twilio(sid, token) as a function and uses the static
// Twilio.validateRequest, so the default export must be callable + carry that.
const mockCreate = vi.fn();
vi.mock("twilio", () => {
  const factory: any = vi.fn(() => ({ messages: { create: mockCreate } }));
  factory.validateRequest = vi.fn(() => true);
  return { default: factory };
});

const VALID_UK = "+447911123456";
const FROM = "+447900000001";

async function setTwilioOutage(active: boolean) {
  await OutageSimulation.deleteMany({});
  await OutageSimulation.create({ twilioOutageActive: active, openaiOutageActive: false });
  invalidateOutageCache();
}

describe("Twilio outage queue + auto-resume + destination validation (#57)", () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });
  afterAll(async () => {
    await teardownTestDatabase();
  });
  beforeEach(() => {
    mockCreate.mockReset();
  });
  afterEach(async () => {
    await clearTestDatabase();
    invalidateOutageCache();
  });

  it("queues outbound SMS during a simulated outage — nothing lost, Twilio API never called", async () => {
    await setTwilioOutage(true);

    const res = await sendSmsWithRetry(VALID_UK, "Pickup at 5pm?", FROM);

    // Caller sees it as in-flight (queued), not a hard error.
    expect(res.success).toBe(true);
    expect(res.status).toBe("queued_for_retry");

    // Exactly one durable outbox row, pending, first attempt.
    const rows = await SmsOutbox.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].to).toBe(VALID_UK);
    expect(rows[0].attempts).toBe(1);

    // The simulated outage throws before any real Twilio call.
    expect(mockCreate).not.toHaveBeenCalled();

    // Failure is audited and flagged as simulated for the admin Failures page.
    const audit = await AuditLog.findOne({ action: "service_failure_twilio" }).lean();
    expect(audit).toBeTruthy();
    expect(audit!.metadata?.simulated).toBe(true);
  });

  it("auto-resumes delivery on recovery — the cron sweep sends the queued row to the valid number", async () => {
    // Queue during the outage…
    await setTwilioOutage(true);
    await sendSmsWithRetry(VALID_UK, "Pickup at 5pm?", FROM);

    // …recovery: clear the outage and make the queued row due now (the real
    // backoff would schedule it 5 minutes out; the cron picks it up then).
    await setTwilioOutage(false);
    await SmsOutbox.updateMany({}, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
    mockCreate.mockResolvedValue({ sid: "SMrecovered", status: "sent" });

    const result = await processSmsOutbox();
    expect(result.sent).toBe(1);

    const row = await SmsOutbox.findOne({}).lean();
    expect(row!.status).toBe("sent");
    expect(row!.sid).toBe("SMrecovered");

    // It was delivered from the channel number to the valid UK recipient.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ from: FROM, to: VALID_UK })
    );
  });

  it("rejects an obviously malformed destination up front — not sent, not queued", async () => {
    await setTwilioOutage(false);

    const res = await sendSmsWithRetry("not-a-number", "Pickup at 5pm?", FROM);

    expect(res.success).toBe(false);
    expect(res.permanent).toBe(true);
    expect(res.error).toMatch(/E\.164/);

    // Crucially: NOT queued for retry, and the SDK was never called.
    expect(await SmsOutbox.countDocuments({})).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();

    const audit = await AuditLog.findOne({
      action: "service_failure_twilio",
      "metadata.operation": "invalid_destination",
    }).lean();
    expect(audit).toBeTruthy();
  });

  it("does not retry a permanent Twilio failure (21408 region) — fails immediately, no 5-attempt burn", async () => {
    await setTwilioOutage(false);
    mockCreate.mockRejectedValue(
      Object.assign(new Error("Permission to send an SMS has not been enabled for the region"), { code: 21408 })
    );

    const res = await sendSmsWithRetry(VALID_UK, "Pickup at 5pm?", FROM);

    expect(res.success).toBe(false);
    expect(res.permanent).toBe(true);
    expect(res.code).toBe(21408);

    // One real attempt, then NO queueing — a permanent failure can never succeed.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(await SmsOutbox.countDocuments({})).toBe(0);

    const audit = await AuditLog.findOne({
      action: "service_failure_twilio",
      "metadata.operation": "sendSms",
    }).lean();
    expect(audit).toBeTruthy();
    expect(audit!.metadata?.code).toBe(21408);
    expect(audit!.metadata?.permanent).toBe(true);
  });
});
