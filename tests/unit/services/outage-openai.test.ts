/**
 * OpenAI outage hold-and-recover verification (M4 tracker #58).
 *
 * Drives the REAL rewrite pipeline (processRewritingMessage) against the real
 * Message + AuditLog + OutageSimulation models and the real outage-flag check,
 * and proves:
 *   1. During an OpenAI outage the message is HELD for moderation — its
 *      rewrittenText stays equal to the original (no rewrite happened) and it is
 *      NEVER delivered unprocessed.
 *   2. The failure is logged as service_failure_openai (flagged simulated) and
 *      a message_held audit row is written, so it surfaces on the moderator
 *      queue and the admin Failures page.
 *   3. On recovery the same kind of message is processed and DELIVERED.
 *
 * The injection point under test is the shared assertOpenAIOperational() guard
 * (the real one) — classifyAndRewrite is stubbed to call it and otherwise
 * return a clean rewrite, exactly as the real classifier does at its OpenAI
 * boundary. Twilio is stubbed so delivery never hits the network.
 *
 * Evidence harness for #58: run with
 *   npx vitest run tests/unit/services/outage-openai.test.ts
 */
import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import mongoose from "mongoose";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import {
  User, Channel, Message, UserChannelPreferences, AuditLog, OutageSimulation,
} from "@/lib/db/models";
import { createUserData, createChannelData } from "@/tests/helpers/fixtures";
import { invalidateOutageCache } from "@/lib/services/outageSimulation";

vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

// classifyAndRewrite calls the REAL assertOpenAIOperational (so the outage flag
// is genuinely exercised), then returns a clean rewrite when operational.
vi.mock("@/lib/services/openai", () => ({
  HOLD_SENTINEL: "__HOLD_FOR_MODERATION__",
  classifyAndRewrite: vi.fn(async (text: string) => {
    const { assertOpenAIOperational } = await import("@/lib/services/outageSimulation");
    await assertOpenAIOperational();
    return {
      classification: "safe" as const,
      rewrittenText: `${text} (rewritten)`,
      flags: [] as string[],
      violationTags: [] as string[],
    };
  }),
}));

// Delivery SMS is stubbed so nothing hits Twilio.
const mockSendSmsWithRetry = vi.fn().mockResolvedValue({ success: true, status: "queued", sid: "SMx" });
vi.mock("@/lib/services/twilio", () => ({
  sendSmsWithRetry: mockSendSmsWithRetry,
}));

const CHANNEL_NUMBER = "+447111000001";
const RECIPIENT_PHONE = "+447111000002";
const SENDER_PHONE = "+447111000003";
const DRAFT = "Can we swap weekends?";

async function setOpenAIOutage(active: boolean) {
  await OutageSimulation.deleteMany({});
  await OutageSimulation.create({ twilioOutageActive: false, openaiOutageActive: active });
  invalidateOutageCache();
}

async function buildChannelAndInbound() {
  const sender = await User.create(createUserData({ phone: SENDER_PHONE, name: "Alice Sender", role: "user" }));
  const recipient = await User.create(createUserData({ phone: RECIPIENT_PHONE, role: "user" }));
  const channel = await Channel.create(
    createChannelData({
      users: [sender._id as mongoose.Types.ObjectId, recipient._id as mongoose.Types.ObjectId],
      clanchaNumber: CHANNEL_NUMBER,
      state: "active",
    })
  );
  await UserChannelPreferences.create({
    userId: recipient._id,
    channelId: channel._id,
    rewriteTone: "calm_clear",
  });
  const message = await Message.create({
    channelId: channel._id,
    senderId: sender._id,
    originalText: DRAFT,
    rewrittenText: DRAFT,
    state: "rewriting",
    isEmergency: false,
    isSystem: false,
    deliveredAt: null,
  });
  return { channel, message };
}

async function runPipeline(messageId: string) {
  const { processRewritingMessage } = await import("@/lib/services/rewritePipeline");
  return processRewritingMessage(messageId);
}

describe("OpenAI outage holds for moderation, recovers cleanly (#58)", () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });
  afterAll(async () => {
    await teardownTestDatabase();
  });
  afterEach(async () => {
    await clearTestDatabase();
    vi.clearAllMocks();
    invalidateOutageCache();
  });

  it("holds the message and never delivers unprocessed content during an OpenAI outage", async () => {
    await setOpenAIOutage(true);
    const { channel, message } = await buildChannelAndInbound();

    const result = await runPipeline(message._id.toString());
    expect(result.outcome).toBe("held");

    const held = await Message.findById(message._id).lean();
    expect(held!.state).toBe("held");
    // Held safely: the original wording is preserved and NOT rewritten/sent.
    expect(held!.rewrittenText).toBe(DRAFT);
    expect(held!.deliveredAt ?? null).toBeNull();

    // Nothing was delivered to the recipient.
    expect(mockSendSmsWithRetry).not.toHaveBeenCalled();

    // Audited as an OpenAI service failure, flagged simulated, plus a hold row.
    const failure = await AuditLog.findOne({
      action: "service_failure_openai",
      channelId: channel._id,
    }).lean();
    expect(failure).toBeTruthy();
    expect(failure!.metadata?.simulated).toBe(true);
    expect(failure!.metadata?.operation).toBe("classifyAndRewrite");

    const heldLog = await AuditLog.findOne({ action: "message_held", channelId: channel._id }).lean();
    expect(heldLog).toBeTruthy();
  });

  it("processes and delivers the message on recovery once OpenAI is back", async () => {
    await setOpenAIOutage(false);
    const { message } = await buildChannelAndInbound();

    const result = await runPipeline(message._id.toString());
    expect(result.outcome).toBe("delivered");

    const delivered = await Message.findById(message._id).lean();
    expect(delivered!.state).toBe("delivered");
    expect(delivered!.rewrittenText).toBe(`${DRAFT} (rewritten)`);

    // The rewritten body was sent to the recipient.
    const sentRewrite = mockSendSmsWithRetry.mock.calls.find(
      (call) => call[1] === `${DRAFT} (rewritten)`
    );
    expect(sentRewrite).toBeTruthy();
    expect(sentRewrite![0]).toBe(RECIPIENT_PHONE);
  });
});
