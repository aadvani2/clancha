/**
 * Message queue and emergency sending via Twilio webhook.
 *
 * - Queue: When outside recipient's receiving hours, message is created as "queued",
 *   sender gets SMS notification, and audit logs are created.
 * - Emergency: When message contains "emergency" and channel has emergency bypass enabled,
 *   message goes to "rewriting" with isEmergency true even outside receiving hours.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearTestDatabase,
} from "@/tests/helpers/db";
import {
  User,
  Channel,
  Message,
  UserChannelPreferences,
  AuditLog,
} from "@/lib/db/models";
import { createUserData, createChannelData } from "@/tests/helpers/fixtures";

vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

const mockSendSms = vi.fn().mockResolvedValue(undefined);
// processRewritingMessage now returns { outcome, ... } — the Twilio webhook
// reads pipelineResult.outcome for the response payload.
const mockProcessRewritingMessage = vi.fn().mockResolvedValue({ outcome: "delivered" });
const mockValidateTwilioSignature = vi.fn().mockReturnValue(true);

// Outbound notifications go through sendSmsWithRetry now (added so a queued
// A2 / emergency confirmation SMS survives a Twilio blip via the cron
// resend). Tests assert against this mock.
const mockSendSmsWithRetry = vi.fn().mockResolvedValue({
  success: true,
  status: "delivered",
  sid: "SM_test_fake",
});

vi.mock("@/lib/services/twilio", () => ({
  getTwilioClient: vi.fn().mockReturnValue({}),
  validateTwilioSignature: mockValidateTwilioSignature,
  sendSms: mockSendSms,
  sendSmsWithRetry: mockSendSmsWithRetry,
}));

vi.mock("@/lib/services/rewritePipeline", () => ({
  processRewritingMessage: mockProcessRewritingMessage,
}));

// Control "within receiving hours" per test
let mockWithinHours = false;
vi.mock("@/lib/utils/routing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/utils/routing")>();
  return {
    ...real,
    isWithinReceivingHours: vi.fn(() => mockWithinHours),
    getInitialMessageState: real.getInitialMessageState,
  };
});

function makeTwilioPostRequest(from: string, to: string, body: string): NextRequest {
  const formData = new FormData();
  formData.set("From", from);
  formData.set("To", to);
  formData.set("Body", body);
  return new NextRequest("http://localhost/api/webhooks/twilio", {
    method: "POST",
    body: formData,
    headers: { "x-twilio-signature": "valid" },
  });
}

async function callTwilioWebhook(from: string, to: string, body: string) {
  const { POST } = await import("@/app/api/webhooks/twilio/route");
  return POST(makeTwilioPostRequest(from, to, body));
}

describe("Twilio webhook – message queue (outside receiving hours)", () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });
  afterAll(async () => {
    await teardownTestDatabase();
  });
  afterEach(async () => {
    await clearTestDatabase();
    vi.clearAllMocks();
    mockWithinHours = false;
    vi.resetModules();
  });

  it("creates message as queued and sends notification SMS when outside receiving hours", async () => {
    const clanchaNumber = "+15559876001";
    const senderPhone = "+15551112222";
    const sender = await User.create({
      ...createUserData({ phone: senderPhone }),
      role: "user",
    });
    const recipient = await User.create(createUserData({ phone: "+15553334444" }));
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber,
        state: "active",
        emergencyBypassEnabled: true,
      }),
    });
    await UserChannelPreferences.create({
      userId: recipient._id,
      channelId: channel._id,
      receivingHoursStart: "09:00",
      receivingHoursEnd: "17:00",
      timezone: "Europe/London",
    });

    mockWithinHours = false;

    const res = await callTwilioWebhook(
      senderPhone,
      clanchaNumber,
      "Can we swap weekends?"
    );

    expect(res.status).toBe(200);

    const message = await Message.findOne({
      channelId: channel._id,
      senderId: sender._id,
      originalText: "Can we swap weekends?",
    });
    expect(message).toBeTruthy();
    expect(message!.state).toBe("queued");
    expect(message!.isEmergency).toBe(false);

    // A2 wording per spec: "This message is queued until …".
    expect(mockSendSmsWithRetry).toHaveBeenCalledWith(
      senderPhone,
      expect.stringMatching(/queued until/i),
      clanchaNumber
    );

    const queuedLog = await AuditLog.findOne({ action: "message_queued" });
    expect(queuedLog).toBeTruthy();
    expect(queuedLog!.metadata?.messageId).toBe(message!._id.toString());
    expect(queuedLog!.metadata?.reason).toBe("outside_receiving_hours");

    const notificationLog = await AuditLog.findOne({
      action: "message_queued_notification_sent",
    });
    expect(notificationLog).toBeTruthy();

    expect(mockProcessRewritingMessage).not.toHaveBeenCalled();
  });

  it("does not queue when within receiving hours; runs rewriting pipeline", async () => {
    const clanchaNumber = "+15559876002";
    const senderPhone = "+15551113333";
    const sender = await User.create({
      ...createUserData({ phone: senderPhone }),
      role: "user",
    });
    const recipient = await User.create(createUserData({ phone: "+15553335555" }));
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber,
        state: "active",
        emergencyBypassEnabled: true,
      }),
    });
    await UserChannelPreferences.create({
      userId: recipient._id,
      channelId: channel._id,
      receivingHoursStart: null,
      receivingHoursEnd: null,
      timezone: "Europe/London",
    });

    mockWithinHours = true;

    const res = await callTwilioWebhook(
      senderPhone,
      clanchaNumber,
      "Normal message"
    );

    expect(res.status).toBe(200);

    const message = await Message.findOne({
      channelId: channel._id,
      senderId: sender._id,
      originalText: "Normal message",
    });
    expect(message).toBeTruthy();
    expect(message!.state).toBe("rewriting");
    expect(message!.isEmergency).toBe(false);

    expect(mockProcessRewritingMessage).toHaveBeenCalledWith(message!._id.toString());
    expect(mockSendSms).not.toHaveBeenCalledWith(
      senderPhone,
      expect.stringContaining("receiving hours begin"),
      expect.any(String)
    );
  });
});

describe("Twilio webhook – emergency sending", () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });
  afterAll(async () => {
    await teardownTestDatabase();
  });
  afterEach(async () => {
    await clearTestDatabase();
    vi.clearAllMocks();
    mockWithinHours = false;
    vi.resetModules();
  });

  it("bypasses queue and sets isEmergency when message contains emergency and bypass is enabled", async () => {
    const clanchaNumber = "+15559876003";
    const senderPhone = "+15551114444";
    const sender = await User.create({
      ...createUserData({ phone: senderPhone }),
      role: "user",
    });
    const recipient = await User.create(createUserData({ phone: "+15553336666" }));
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber,
        state: "active",
        emergencyBypassEnabled: true,
      }),
    });
    await UserChannelPreferences.create({
      userId: recipient._id,
      channelId: channel._id,
      receivingHoursStart: "09:00",
      receivingHoursEnd: "17:00",
      timezone: "Europe/London",
    });

    // Pre-stage a queued message from this sender — the trigger word will
    // bump THIS message out of the queue, not deliver the word itself.
    const queuedEarlier = await Message.create({
      channelId: channel._id,
      senderId: sender._id,
      originalText: "Earlier urgent thing about pickup",
      rewrittenText: "Earlier urgent thing about pickup",
      state: "queued",
      isEmergency: false,
    });

    mockWithinHours = false;

    const res = await callTwilioWebhook(senderPhone, clanchaNumber, "emergency");
    expect(res.status).toBe(200);

    const updated = await Message.findById(queuedEarlier._id);
    expect(updated!.state).toBe("rewriting");
    expect(updated!.isEmergency).toBe(true);
    expect(mockProcessRewritingMessage).toHaveBeenCalledWith(queuedEarlier._id.toString());

    // A3 confirmation back to sender.
    expect(mockSendSmsWithRetry).toHaveBeenCalledWith(
      senderPhone,
      expect.stringMatching(/marked as an emergency/i),
      clanchaNumber
    );
  });

  it("does not set emergency when bypass is disabled even if message contains emergency", async () => {
    const clanchaNumber = "+15559876004";
    const senderPhone = "+15551115555";
    const sender = await User.create({
      ...createUserData({ phone: senderPhone }),
      role: "user",
    });
    const recipient = await User.create(createUserData({ phone: "+15553337777" }));
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber,
        state: "active",
        emergencyBypassEnabled: false,
      }),
    });
    await UserChannelPreferences.create({
      userId: recipient._id,
      channelId: channel._id,
      receivingHoursStart: "09:00",
      receivingHoursEnd: "17:00",
      timezone: "Europe/London",
    });

    // Pre-stage a queued message — with bypass OFF, the trigger should NOT
    // bump it.
    const queuedEarlier = await Message.create({
      channelId: channel._id,
      senderId: sender._id,
      originalText: "Earlier message about handover",
      rewrittenText: "Earlier message about handover",
      state: "queued",
      isEmergency: false,
    });

    mockWithinHours = false;

    const res = await callTwilioWebhook(senderPhone, clanchaNumber, "emergency");
    expect(res.status).toBe(200);

    const stillQueued = await Message.findById(queuedEarlier._id);
    expect(stillQueued!.state).toBe("queued");
    expect(stillQueued!.isEmergency).toBe(false);

    // A4 sent: "<Recipient> doesn't have Emergency Bypass enabled".
    expect(mockSendSmsWithRetry).toHaveBeenCalledWith(
      senderPhone,
      expect.stringMatching(/Emergency Bypass enabled/i),
      clanchaNumber
    );
  });

  it("treats emergency as case-insensitive", async () => {
    const clanchaNumber = "+15559876005";
    const senderPhone = "+15551116666";
    const sender = await User.create({
      ...createUserData({ phone: senderPhone }),
      role: "user",
    });
    const recipient = await User.create(createUserData({ phone: "+15553338888" }));
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber,
        state: "active",
        emergencyBypassEnabled: true,
      }),
    });
    await UserChannelPreferences.create({
      userId: recipient._id,
      channelId: channel._id,
      receivingHoursStart: "09:00",
      receivingHoursEnd: "17:00",
      timezone: "Europe/London",
    });

    const queuedEarlier = await Message.create({
      channelId: channel._id,
      senderId: sender._id,
      originalText: "Earlier matter",
      rewrittenText: "Earlier matter",
      state: "queued",
      isEmergency: false,
    });

    mockWithinHours = false;

    const res = await callTwilioWebhook(senderPhone, clanchaNumber, "EMERGENCY");
    expect(res.status).toBe(200);

    const updated = await Message.findById(queuedEarlier._id);
    expect(updated!.state).toBe("rewriting");
    expect(updated!.isEmergency).toBe(true);
    expect(mockProcessRewritingMessage).toHaveBeenCalled();
  });
});
