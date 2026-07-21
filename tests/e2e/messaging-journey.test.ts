/**
 * E2E Journey: Messaging with Moderator Review
 *
 * Simulates a user sending a message via the web UI, the AI rewrite pipeline
 * flagging it as "uncertain", a moderator reviewing it, and the final delivery.
 */
import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User, Channel, Message } from "@/lib/db/models";
import { createUserData } from "@/tests/helpers/fixtures";

vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth: mockRequireAuth }));

// processRewritingMessage is mocked so we control what state the message ends up in
const mockProcessRewriting = vi.fn();
vi.mock("@/lib/services/rewritePipeline", () => ({
  processRewritingMessage: mockProcessRewriting,
}));

// Moderator approve path sends A5 ("Clancha – This message wasn't sent…")
// via sendSmsWithRetry — without a mock the Twilio SDK boot trips on the
// test stub TWILIO_ACCOUNT_SID and the request 500s.
vi.mock("@/lib/services/twilio", () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
  sendSmsWithRetry: vi.fn().mockResolvedValue({ success: true, status: "delivered", sid: "SM_test_fake" }),
  validateTwilioSignature: vi.fn().mockReturnValue(true),
  getTwilioClient: vi.fn().mockReturnValue({}),
}));

function makeSendMsgReq(body: object) {
  return new NextRequest("http://localhost/api/messages/send", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeReviewReq(body: object) {
  return new NextRequest("http://localhost/api/moderator/review", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("Journey: Send message → AI holds it → Moderator approves → Delivered", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("walks through the full held-message moderation flow", async () => {
    // Setup: two co-parents in an active channel, plus a moderator
    const parent1 = await User.create({ ...createUserData(), role: "user" });
    const parent2 = await User.create({ ...createUserData(), role: "user" });
    const moderator = await User.create({ ...createUserData(), role: "moderator" });
    const channel = await Channel.create({
      users: [parent1._id, parent2._id],
      clanchaNumber: "+15580001001",
      state: "active",
    });

    // Step 1: Parent1 sends a message via web UI
    //   The pipeline runs but marks the message as "held" (uncertain content)
    mockRequireAuth.mockResolvedValue({ payload: { userId: parent1._id.toString() } });
    mockProcessRewriting.mockImplementation(async (messageId: string) => {
      await Message.findByIdAndUpdate(messageId, { state: "held" });
    });

    const { POST: sendPost } = await import("@/app/api/messages/send/route");
    const sendRes = await sendPost(makeSendMsgReq({
      channelId: channel._id.toString(),
      text: "I want to take the kids this weekend, and if you say no I will be very upset.",
    }));
    expect(sendRes.status).toBe(200);
    const sentMsg = await sendRes.json();

    // Message should be in held state after pipeline
    const msgInDb = await Message.findById(sentMsg.id);
    expect(msgInDb!.state).toBe("held");

    // Step 2: Moderator fetches the queue
    mockRequireAuth.mockResolvedValue({
      payload: { userId: moderator._id.toString(), role: "moderator" },
    });
    const { GET: queueGet } = await import("@/app/api/moderator/queue/route");
    const queueRes = await queueGet(new NextRequest("http://localhost/api/moderator/queue"));
    expect(queueRes.status).toBe(200);
    const queue = await queueRes.json();
    expect(queue.messages).toHaveLength(1);
    expect(queue.messages[0].id).toBe(sentMsg.id);

    // Step 3: Moderator approves the message
    const { POST: reviewPost } = await import("@/app/api/moderator/review/route");
    const reviewRes = await reviewPost(makeReviewReq({
      type: "message",
      id: sentMsg.id,
      action: "approve",
      notes: "Rewritten version is fine",
    }));
    expect(reviewRes.status).toBe(200);
    const reviewData = await reviewRes.json();
    expect(reviewData.state).toBe("delivered");

    // Step 4: Message is now delivered in the DB
    const finalMsg = await Message.findById(sentMsg.id);
    expect(finalMsg!.state).toBe("delivered");
    expect(finalMsg!.deliveredAt).toBeDefined();
    expect(finalMsg!.moderatorNotes).toBe("Rewritten version is fine");

    // Step 5: Queue is now empty
    mockRequireAuth.mockResolvedValue({
      payload: { userId: moderator._id.toString(), role: "moderator" },
    });
    const emptyQueueRes = await queueGet(new NextRequest("http://localhost/api/moderator/queue"));
    const emptyQueue = await emptyQueueRes.json();
    expect(emptyQueue.messages).toHaveLength(0);
  });
});

describe("Journey: Send message → AI holds it → Moderator denies → Blocked", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("walks through the held-message denial flow", async () => {
    const parent1 = await User.create({ ...createUserData(), role: "user" });
    const parent2 = await User.create({ ...createUserData(), role: "user" });
    const moderator = await User.create({ ...createUserData(), role: "moderator" });
    const channel = await Channel.create({
      users: [parent1._id, parent2._id],
      clanchaNumber: "+15580001002",
      state: "active",
    });

    // Send message → pipeline holds it
    mockRequireAuth.mockResolvedValue({ payload: { userId: parent1._id.toString() } });
    mockProcessRewriting.mockImplementation(async (messageId: string) => {
      await Message.findByIdAndUpdate(messageId, { state: "held" });
    });

    const { POST: sendPost } = await import("@/app/api/messages/send/route");
    const sendRes = await sendPost(makeSendMsgReq({
      channelId: channel._id.toString(),
      text: "You are a terrible parent!",
    }));
    const sentMsg = await sendRes.json();

    // Moderator denies
    mockRequireAuth.mockResolvedValue({
      payload: { userId: moderator._id.toString(), role: "moderator" },
    });
    const { POST: reviewPost } = await import("@/app/api/moderator/review/route");
    const reviewRes = await reviewPost(makeReviewReq({
      type: "message",
      id: sentMsg.id,
      action: "deny",
      notes: "Abusive content",
    }));
    expect(reviewRes.status).toBe(200);

    const finalMsg = await Message.findById(sentMsg.id);
    expect(finalMsg!.state).toBe("blocked");
    expect(finalMsg!.moderatorNotes).toBe("Abusive content");
  });
});

describe("Journey: Multiple messages in channel", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("both channel members can send messages", async () => {
    const parent1 = await User.create({ ...createUserData(), role: "user" });
    const parent2 = await User.create({ ...createUserData(), role: "user" });
    const channel = await Channel.create({
      users: [parent1._id, parent2._id],
      clanchaNumber: "+15580001003",
      state: "active",
    });

    // Pipeline marks messages as delivered
    mockProcessRewriting.mockImplementation(async (messageId: string) => {
      await Message.findByIdAndUpdate(messageId, { state: "delivered", deliveredAt: new Date() });
    });

    const { POST: sendPost } = await import("@/app/api/messages/send/route");

    // Parent 1 sends
    mockRequireAuth.mockResolvedValue({ payload: { userId: parent1._id.toString() } });
    const res1 = await sendPost(makeSendMsgReq({
      channelId: channel._id.toString(),
      text: "Can you pick up the kids at 3pm?",
    }));
    expect(res1.status).toBe(200);

    // Parent 2 sends
    mockRequireAuth.mockResolvedValue({ payload: { userId: parent2._id.toString() } });
    const res2 = await sendPost(makeSendMsgReq({
      channelId: channel._id.toString(),
      text: "Yes, I can do that.",
    }));
    expect(res2.status).toBe(200);

    const messages = await Message.find({ channelId: channel._id });
    expect(messages).toHaveLength(2);

    const senderIds = messages.map((m) => m.senderId.toString());
    expect(senderIds).toContain(parent1._id.toString());
    expect(senderIds).toContain(parent2._id.toString());
  });

  it("non-member cannot send messages to a channel", async () => {
    const parent1 = await User.create({ ...createUserData(), role: "user" });
    const parent2 = await User.create({ ...createUserData(), role: "user" });
    const intruder = await User.create({ ...createUserData(), role: "user" });
    const channel = await Channel.create({
      users: [parent1._id, parent2._id],
      clanchaNumber: "+15580001004",
      state: "active",
    });

    mockRequireAuth.mockResolvedValue({ payload: { userId: intruder._id.toString() } });

    const { POST: sendPost } = await import("@/app/api/messages/send/route");
    const res = await sendPost(makeSendMsgReq({
      channelId: channel._id.toString(),
      text: "Intruder message",
    }));
    expect(res.status).toBe(403);

    const messages = await Message.find({ channelId: channel._id });
    expect(messages).toHaveLength(0);
  });
});
