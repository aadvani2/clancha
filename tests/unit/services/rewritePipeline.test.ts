import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach,
} from "vitest";
import mongoose from "mongoose";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User, Channel, Message, UserChannelPreferences, JoinToken } from "@/lib/db/models";
import { createUserData, createChannelData } from "@/tests/helpers/fixtures";

// ─── Mocks ────────────────────────────────────────────────────────────────────
// rewritePipeline calls connectDB() each invocation; the in-memory mongoose
// connection is already live so the call must no-op.
vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

// Isolate the external services. OpenAI returns a safe classification so we
// reach the delivery branch where A1 lives; Twilio just records what we asked
// it to send.
const mockClassifyAndRewrite = vi.fn();
vi.mock("@/lib/services/openai", () => ({
  classifyAndRewrite: mockClassifyAndRewrite,
}));

const mockSendSmsWithRetry = vi.fn();
vi.mock("@/lib/services/twilio", () => ({
  sendSmsWithRetry: mockSendSmsWithRetry,
}));

// storeSystemMessage hits the real DB, which is what we want — A1 is asserted
// via the Message collection.

// ─── Helpers ─────────────────────────────────────────────────────────────────
const A1_FIRST_LINE = "Clancha: You've received a message from";
const CHANNEL_NUMBER = "+447111000001";
const RECIPIENT_PHONE = "+447111000002";
const SENDER_PHONE = "+447111000003";

async function buildChannel(senderName: string | undefined = "Alice Sender") {
  const sender = await User.create(
    createUserData({ phone: SENDER_PHONE, name: senderName, role: "user" })
  );
  const recipient = await User.create(
    createUserData({ phone: RECIPIENT_PHONE, role: "user" })
  );
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
  return { sender, recipient, channel };
}

async function makeInboundFromSender(
  channelId: mongoose.Types.ObjectId,
  senderId: mongoose.Types.ObjectId,
  text = "Hello there"
) {
  return Message.create({
    channelId,
    senderId,
    originalText: text,
    rewrittenText: text,
    state: "rewriting",
    isEmergency: false,
    isSystem: false,
    deliveredAt: null,
  });
}

async function callPipeline(messageId: string) {
  const { processRewritingMessage } = await import("@/lib/services/rewritePipeline");
  return processRewritingMessage(messageId);
}

// ─────────────────────────────────────────────────────────────────────────────
describe("processRewritingMessage — A1 first-contact intro", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  beforeEach(() => {
    mockClassifyAndRewrite.mockResolvedValue({
      classification: "safe",
      rewrittenText: "Hello there (rewritten)",
      flags: [],
      violationTags: [],
    });
    mockSendSmsWithRetry.mockResolvedValue({
      success: true,
      sid: "SMtest",
      status: "queued",
    });
  });
  afterEach(async () => {
    await clearTestDatabase();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("fires A1 on the recipient's FIRST delivered inbound (regression: count must exclude the current message)", async () => {
    // Before fix: the pipeline stamped the current message state="delivered"
    // BEFORE running the priorInboundToRecipient count, so the count was
    // always ≥1 and A1 never fired on first contact.
    const { sender, channel } = await buildChannel("Alice Sender");
    const msg = await makeInboundFromSender(
      channel._id as mongoose.Types.ObjectId,
      sender._id as mongoose.Types.ObjectId
    );

    const result = await callPipeline(msg._id.toString());

    expect(result.outcome).toBe("delivered");

    // A1 must be persisted as a system message on the channel.
    const systemMessages = await Message.find({
      channelId: channel._id,
      isSystem: true,
    }).lean();
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].originalText).toContain(A1_FIRST_LINE);
    expect(systemMessages[0].originalText).toContain("Alice Sender");

    // A1 SMS must have gone out to the recipient BEFORE the rewritten body.
    // sendSmsWithRetry is called twice: A1 first, then the rewrite.
    expect(mockSendSmsWithRetry).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = mockSendSmsWithRetry.mock.calls;
    expect(firstCall[0]).toBe(RECIPIENT_PHONE);
    expect(firstCall[1]).toContain(A1_FIRST_LINE);
    expect(firstCall[2]).toBe(CHANNEL_NUMBER);
    expect(secondCall[0]).toBe(RECIPIENT_PHONE);
    expect(secondCall[1]).toBe("Hello there (rewritten)");
  });

  it("does NOT fire A1 to the channel CREATOR when the joining user replies first (#80)", async () => {
    // Bug Craig found: A1 ("Initial System Introduction (User B)") is meant
    // only for the non-creating party. buildChannel stores users:[creator,
    // joiner], so users[0] (the sender fixture) is the creator. When the
    // JOINER (users[1]) sends the first message, the recipient is the creator
    // — who already has an account and must NOT get the intro.
    const { sender, recipient, channel } = await buildChannel("Craig Creator");

    // Message FROM the joining user (users[1]) → recipient resolves to the
    // creator (users[0]).
    const msg = await makeInboundFromSender(
      channel._id as mongoose.Types.ObjectId,
      recipient._id as mongoose.Types.ObjectId,
      "First reply from the joiner"
    );

    const result = await callPipeline(msg._id.toString());
    expect(result.outcome).toBe("delivered");

    // No A1 system row, and only the rewritten body is sent (no A1 SMS).
    const systemMessages = await Message.find({
      channelId: channel._id,
      isSystem: true,
    }).lean();
    expect(systemMessages).toHaveLength(0);
    expect(mockSendSmsWithRetry).toHaveBeenCalledTimes(1);
    expect(mockSendSmsWithRetry.mock.calls[0][0]).toBe(SENDER_PHONE);
    expect(mockSendSmsWithRetry.mock.calls[0][1]).toBe("Hello there (rewritten)");
    expect(sender).toBeDefined();
  });

  it("does NOT fire A1 on a SUBSEQUENT inbound to the same recipient", async () => {
    const { sender, recipient, channel } = await buildChannel();

    // Seed a prior delivered inbound to the recipient on this channel.
    await Message.create({
      channelId: channel._id,
      senderId: sender._id,
      originalText: "earlier",
      rewrittenText: "earlier",
      state: "delivered",
      isEmergency: false,
      isSystem: false,
      deliveredAt: new Date(Date.now() - 60_000),
    });

    const msg = await makeInboundFromSender(
      channel._id as mongoose.Types.ObjectId,
      sender._id as mongoose.Types.ObjectId,
      "Second inbound"
    );

    await callPipeline(msg._id.toString());

    const systemMessages = await Message.find({
      channelId: channel._id,
      isSystem: true,
    }).lean();
    expect(systemMessages).toHaveLength(0);

    // Only the rewritten body should be sent — no A1 SMS preceding it.
    expect(mockSendSmsWithRetry).toHaveBeenCalledTimes(1);
    expect(mockSendSmsWithRetry.mock.calls[0][1]).toBe("Hello there (rewritten)");

    // Suppress the seeded message from leaking into other assertions.
    expect(recipient).toBeDefined();
  });

  it("backdates the A1 system row 1ms BEFORE the inbound it introduces (timeline ordering)", async () => {
    const { sender, channel } = await buildChannel();
    const msg = await makeInboundFromSender(
      channel._id as mongoose.Types.ObjectId,
      sender._id as mongoose.Types.ObjectId
    );

    await callPipeline(msg._id.toString());

    const systemMessage = await Message.findOne({
      channelId: channel._id,
      isSystem: true,
    }).lean();
    expect(systemMessage).not.toBeNull();

    const introducedMessage = await Message.findById(msg._id).lean();
    expect(introducedMessage).not.toBeNull();

    const a1At = new Date(systemMessage!.createdAt).getTime();
    const inboundAt = new Date(introducedMessage!.createdAt).getTime();
    // storeSystemMessage backdates by 1ms so the portal renders A1 just above
    // the inbound it introduces.
    expect(inboundAt - a1At).toBe(1);
  });

  it("counts inbound by recipient, not by channel — sender's prior outbound does NOT suppress A1", async () => {
    // Spec: A1 fires the first time THIS recipient has a delivered inbound on
    // the channel, regardless of what the channel as a whole has done.
    // Seed a prior delivered message in the OTHER direction (sender as the
    // recipient of a message from the original recipient) and confirm A1
    // still fires for the original recipient on their first inbound.
    const { sender, recipient, channel } = await buildChannel();

    await Message.create({
      channelId: channel._id,
      senderId: recipient._id, // recipient → sender (outbound from the OG recipient's POV)
      originalText: "an earlier reply",
      rewrittenText: "an earlier reply",
      state: "delivered",
      isEmergency: false,
      isSystem: false,
      deliveredAt: new Date(Date.now() - 60_000),
    });

    const msg = await makeInboundFromSender(
      channel._id as mongoose.Types.ObjectId,
      sender._id as mongoose.Types.ObjectId
    );

    await callPipeline(msg._id.toString());

    const systemMessages = await Message.find({
      channelId: channel._id,
      isSystem: true,
    }).lean();
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].originalText).toContain(A1_FIRST_LINE);
  });

  it("A1 link is /j/<token> — issues a JoinToken bound to (recipient, channel)", async () => {
    // Tracker #79: the A1 "create an online account" link must drop the
    // recipient into a tokenised /join flow, not the generic /login page.
    const { recipient, channel } = await buildChannel();
    const msg = await makeInboundFromSender(
      channel._id as mongoose.Types.ObjectId,
      (await User.findOne({ phone: SENDER_PHONE }))!._id as mongoose.Types.ObjectId
    );

    await callPipeline(msg._id.toString());

    // The A1 body sent over SMS contains the short /j/<token> link
    // (Craig, M4 feedback 05/07/26 §1.3)
    const a1Call = mockSendSmsWithRetry.mock.calls.find((call) =>
      typeof call[1] === "string" && call[1].includes(A1_FIRST_LINE)
    );
    expect(a1Call).toBeDefined();
    const a1Body = a1Call![1] as string;
    const match = a1Body.match(/\/j\/([0-9A-Za-z]{11})/);
    expect(match).not.toBeNull();
    const tokenInLink = match![1];

    // That token must correspond to a freshly-minted JoinToken bound to the
    // recipient + channel and not yet consumed.
    const { hashJoinToken } = await import("@/lib/auth/joinToken");
    const stored = await JoinToken.findOne({ tokenHash: hashJoinToken(tokenInLink) }).lean();
    expect(stored).not.toBeNull();
    expect(stored?.userId.toString()).toBe((recipient._id as mongoose.Types.ObjectId).toString());
    expect(stored?.channelId.toString()).toBe((channel._id as mongoose.Types.ObjectId).toString());
    expect(stored?.consumedAt).toBeNull();
  });

  it("does NOT fire A1 when the classifier holds the message (uncertain)", async () => {
    // Held messages exit before the A1 branch — that branch only runs in the
    // delivered path. Belt-and-braces: confirm a held message does NOT
    // generate an A1 row that would mislead the recipient about a message
    // they never received.
    mockClassifyAndRewrite.mockResolvedValueOnce({
      classification: "uncertain",
      rewrittenText: "queued",
      flags: [],
      violationTags: [],
    });
    const { sender, channel } = await buildChannel();
    const msg = await makeInboundFromSender(
      channel._id as mongoose.Types.ObjectId,
      sender._id as mongoose.Types.ObjectId
    );

    const result = await callPipeline(msg._id.toString());
    expect(result.outcome).toBe("held");

    const a1Messages = await Message.find({
      channelId: channel._id,
      isSystem: true,
      originalText: { $regex: A1_FIRST_LINE },
    }).lean();
    expect(a1Messages).toHaveLength(0);
  });
});
