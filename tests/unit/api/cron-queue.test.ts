/**
 * Cron job: process queued messages when recipient's receiving hours resume.
 *
 * - When isWithinReceivingHours(prefs) is true for a queued message's recipient,
 *   the message is updated to "rewriting" and processRewritingMessage is called.
 * - When still outside hours, the message is left queued and not processed.
 * - SAFETY NET (M4 #98): a message queued longer than the max queue age is
 *   force-released even while still outside hours, so a queued message can
 *   never be silently lost.
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
} from "@/lib/db/models";
import { createUserData, createChannelData, createMessageData } from "@/tests/helpers/fixtures";

vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

const mockProcessRewritingMessage = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/services/rewritePipeline", () => ({
  processRewritingMessage: mockProcessRewritingMessage,
}));

let mockWithinHours = false;
vi.mock("@/lib/utils/routing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/utils/routing")>();
  return {
    ...real,
    isWithinReceivingHours: vi.fn(() => mockWithinHours),
  };
});

async function callCronGet(authHeader?: string) {
  const { GET } = await import("@/app/api/cron/route");
  const req = new NextRequest("http://localhost/api/cron", {
    headers: authHeader ? { Authorization: authHeader } : {},
  });
  return GET(req);
}

describe("GET /api/cron – message queue processing", () => {
  const CRON_SECRET = "test-cron-secret";

  beforeAll(async () => {
    await setupTestDatabase();
    process.env.CRON_SECRET = CRON_SECRET;
  });
  afterAll(async () => {
    await teardownTestDatabase();
    delete process.env.CRON_SECRET;
  });
  afterEach(async () => {
    await clearTestDatabase();
    vi.clearAllMocks();
    mockWithinHours = false;
    process.env.CRON_SECRET = CRON_SECRET;
    vi.resetModules();
  });

  it("returns 401 when CRON_SECRET is set and Authorization header is missing", async () => {
    const res = await callCronGet();
    expect(res.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET is set and Authorization header is wrong", async () => {
    const res = await callCronGet("Bearer wrong-secret");
    expect(res.status).toBe(401);
  });

  it("processes queued messages when recipient is now within receiving hours", async () => {
    const sender = await User.create(createUserData());
    const recipient = await User.create(createUserData());
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber: "+15557777001",
        state: "active",
      }),
    });
    await UserChannelPreferences.create({
      userId: recipient._id,
      channelId: channel._id,
      receivingHoursStart: "09:00",
      receivingHoursEnd: "17:00",
      timezone: "Europe/London",
    });
    const queuedMessage = await Message.create({
      ...createMessageData({
        channelId: channel._id,
        senderId: sender._id,
        originalText: "Queued earlier",
        rewrittenText: "Queued earlier",
        state: "queued",
        isEmergency: false,
        deliveredAt: null,
      }),
    });

    mockWithinHours = true;

    const res = await callCronGet(`Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.queuedProcessed).toBe(1);

    const updated = await Message.findById(queuedMessage._id);
    expect(updated!.state).toBe("rewriting");

    expect(mockProcessRewritingMessage).toHaveBeenCalledWith(queuedMessage._id.toString());
  });

  it("does not process queued messages when recipient is still outside receiving hours", async () => {
    const sender = await User.create(createUserData());
    const recipient = await User.create(createUserData());
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber: "+15557777002",
        state: "active",
      }),
    });
    await UserChannelPreferences.create({
      userId: recipient._id,
      channelId: channel._id,
      receivingHoursStart: "09:00",
      receivingHoursEnd: "17:00",
      timezone: "Europe/London",
    });
    const queuedMessage = await Message.create({
      ...createMessageData({
        channelId: channel._id,
        senderId: sender._id,
        originalText: "Still queued",
        rewrittenText: "Still queued",
        state: "queued",
        isEmergency: false,
        deliveredAt: null,
      }),
    });

    mockWithinHours = false;

    const res = await callCronGet(`Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.queuedProcessed).toBe(0);

    const unchanged = await Message.findById(queuedMessage._id);
    expect(unchanged!.state).toBe("queued");

    expect(mockProcessRewritingMessage).not.toHaveBeenCalled();
  });

  it("force-releases a stale queued message even while still outside receiving hours (safety net, M4 #98)", async () => {
    const sender = await User.create(createUserData());
    const recipient = await User.create(createUserData());
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber: "+15557777010",
        state: "active",
      }),
    });
    // Recipient has a real window — still outside it right now.
    await User.findByIdAndUpdate(recipient._id, {
      receivingHoursStart: "06:00",
      receivingHoursEnd: "23:00",
      timezone: "Europe/London",
    });

    const queuedMessage = await Message.create({
      ...createMessageData({
        channelId: channel._id,
        senderId: sender._id,
        originalText: "Parked for over a day",
        rewrittenText: "Parked for over a day",
        state: "queued",
        isEmergency: false,
        deliveredAt: null,
      }),
    });
    // Backdate createdAt to 25h ago (older than the 24h max queue age).
    // createdAt is immutable under Mongoose timestamps, so write it through the
    // native collection driver to bypass casting/immutability.
    const staleAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Message.collection.updateOne(
      { _id: queuedMessage._id },
      { $set: { createdAt: staleAt } }
    );

    // Still outside receiving hours — without the safety net this would stay queued.
    mockWithinHours = false;

    const res = await callCronGet(`Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.queuedProcessed).toBe(1);
    expect(data.queuedForceReleased).toBe(1);

    const updated = await Message.findById(queuedMessage._id);
    expect(updated!.state).toBe("rewriting");
    expect(mockProcessRewritingMessage).toHaveBeenCalledWith(queuedMessage._id.toString());
  });

  it("does NOT force-release a recently queued message while outside hours", async () => {
    const sender = await User.create(createUserData());
    const recipient = await User.create(createUserData());
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber: "+15557777011",
        state: "active",
      }),
    });
    await User.findByIdAndUpdate(recipient._id, {
      receivingHoursStart: "06:00",
      receivingHoursEnd: "23:00",
      timezone: "Europe/London",
    });

    const queuedMessage = await Message.create({
      ...createMessageData({
        channelId: channel._id,
        senderId: sender._id,
        originalText: "Just queued",
        rewrittenText: "Just queued",
        state: "queued",
        isEmergency: false,
        deliveredAt: null,
      }),
    });

    mockWithinHours = false;

    const res = await callCronGet(`Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.queuedProcessed).toBe(0);
    expect(data.queuedForceReleased).toBe(0);

    const unchanged = await Message.findById(queuedMessage._id);
    expect(unchanged!.state).toBe("queued");
    expect(mockProcessRewritingMessage).not.toHaveBeenCalled();
  });

  it("processes multiple queued messages up to limit when within hours", async () => {
    const sender1 = await User.create(createUserData());
    const recipient1 = await User.create(createUserData());
    const channel1 = await Channel.create({
      ...createChannelData({
        users: [sender1._id, recipient1._id],
        clanchaNumber: "+15557777003",
        state: "active",
      }),
    });
    await UserChannelPreferences.create({
      userId: recipient1._id,
      channelId: channel1._id,
      receivingHoursStart: null,
      receivingHoursEnd: null,
      timezone: "Europe/London",
    });

    const sender2 = await User.create(createUserData());
    const recipient2 = await User.create(createUserData());
    const channel2 = await Channel.create({
      ...createChannelData({
        users: [sender2._id, recipient2._id],
        clanchaNumber: "+15557777004",
        state: "active",
      }),
    });
    await UserChannelPreferences.create({
      userId: recipient2._id,
      channelId: channel2._id,
      receivingHoursStart: null,
      receivingHoursEnd: null,
      timezone: "Europe/London",
    });

    const msg1 = await Message.create({
      ...createMessageData({
        channelId: channel1._id,
        senderId: sender1._id,
        state: "queued",
        deliveredAt: null,
      }),
    });
    const msg2 = await Message.create({
      ...createMessageData({
        channelId: channel2._id,
        senderId: sender2._id,
        state: "queued",
        deliveredAt: null,
      }),
    });

    mockWithinHours = true;

    const res = await callCronGet(`Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.queuedProcessed).toBe(2);

    expect((await Message.findById(msg1._id))!.state).toBe("rewriting");
    expect((await Message.findById(msg2._id))!.state).toBe("rewriting");
    expect(mockProcessRewritingMessage).toHaveBeenCalledTimes(2);
  });

  it("skips queued message when channel not found", async () => {
    const sender = await User.create(createUserData());
    const recipient = await User.create(createUserData());
    const channel = await Channel.create({
      ...createChannelData({
        users: [sender._id, recipient._id],
        clanchaNumber: "+15557777005",
        state: "active",
      }),
    });
    const queuedMessage = await Message.create({
      ...createMessageData({
        channelId: channel._id,
        senderId: sender._id,
        state: "queued",
        deliveredAt: null,
      }),
    });
    await Channel.findByIdAndDelete(channel._id);

    mockWithinHours = true;

    const res = await callCronGet(`Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.queuedProcessed).toBe(0);
    expect(mockProcessRewritingMessage).not.toHaveBeenCalled();
    const stillQueued = await Message.findById(queuedMessage._id);
    expect(stillQueued!.state).toBe("queued");
  });
});
