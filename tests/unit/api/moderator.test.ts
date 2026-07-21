import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User, Channel, Message, Image } from "@/lib/db/models";
import { createUserData, createMessageData } from "@/tests/helpers/fixtures";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

vi.mock("@/lib/services/twilio", () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
  sendSmsWithRetry: vi.fn().mockResolvedValue({ success: true, status: "delivered", sid: "SM_test_fake" }),
}));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth: mockRequireAuth }));

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function callQueueGet(search = "") {
  const { GET } = await import("@/app/api/moderator/queue/route");
  const url = search ? `http://localhost/api/moderator/queue?${search}` : "http://localhost/api/moderator/queue";
  return GET(new NextRequest(url));
}

async function callReviewPost(body: object) {
  const { POST } = await import("@/app/api/moderator/review/route");
  const req = new NextRequest("http://localhost/api/moderator/review", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return POST(req);
}

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/moderator/queue", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });

    const res = await callQueueGet();
    expect(res.status).toBe(401);
  });

  it("returns 403 for regular user role", async () => {
    const user = await User.create(createUserData());
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString(), role: "user" } });

    const res = await callQueueGet();
    expect(res.status).toBe(403);
  });

  it("returns 403 for viewer role", async () => {
    const user = await User.create(createUserData());
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString(), role: "viewer" } });

    const res = await callQueueGet();
    expect(res.status).toBe(403);
  });

  it("returns empty queue for moderator when nothing is held", async () => {
    const mod = await User.create({ ...createUserData(), role: "moderator" });
    mockRequireAuth.mockResolvedValue({ payload: { userId: mod._id.toString(), role: "moderator" } });

    const res = await callQueueGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.messages).toHaveLength(0);
    expect(data.images).toHaveLength(0);
  });

  it("returns held messages for moderator", async () => {
    const sender = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [sender._id, other._id],
      clanchaNumber: "+15560000001",
      state: "active",
    });

    await Message.create({
      ...createMessageData({ channelId: channel._id, senderId: sender._id, state: "held" }),
      originalText: "Angry message",
      rewrittenText: "Angry message",
    });
    // Delivered message should NOT appear
    await Message.create({
      ...createMessageData({ channelId: channel._id, senderId: sender._id, state: "delivered" }),
    });

    const mod = await User.create({ ...createUserData(), role: "moderator" });
    mockRequireAuth.mockResolvedValue({ payload: { userId: mod._id.toString(), role: "moderator" } });

    const res = await callQueueGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].originalText).toBe("Angry message");
  });

  it("allows admin role to access the queue", async () => {
    const admin = await User.create({ ...createUserData(), role: "admin" });
    mockRequireAuth.mockResolvedValue({ payload: { userId: admin._id.toString(), role: "admin" } });

    const res = await callQueueGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.messages).toBeDefined();
    expect(data.images).toBeDefined();
  });

  it("allows super_admin role to access the queue", async () => {
    const sa = await User.create({ ...createUserData(), role: "super_admin" });
    mockRequireAuth.mockResolvedValue({ payload: { userId: sa._id.toString(), role: "super_admin" } });

    const res = await callQueueGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.messages).toBeDefined();
    expect(data.images).toBeDefined();
  });

  it("returns pending images for moderator", async () => {
    const sender = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [sender._id, other._id],
      clanchaNumber: "+15560000002",
      state: "active",
    });

    await Image.create({
      channelId: channel._id,
      senderId: sender._id,
      storageUrl: "https://s3.example.com/img.jpg",
      thumbnailUrl: "https://s3.example.com/thumb.jpg",
      state: "pending",
    });

    const mod3 = await User.create({ ...createUserData(), role: "moderator" });
    mockRequireAuth.mockResolvedValue({ payload: { userId: mod3._id.toString(), role: "moderator" } });

    const res = await callQueueGet();
    const data = await res.json();
    expect(data.images).toHaveLength(1);
    expect(data.images[0].storageUrl).toBe("https://s3.example.com/img.jpg");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/moderator/review", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });

    const res = await callReviewPost({ type: "message", id: "abc", action: "approve" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for regular user role", async () => {
    const user = await User.create(createUserData());
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString(), role: "user" } });

    const res = await callReviewPost({ type: "message", id: "aaaaaaaaaaaaaaaaaaaaaaaa", action: "approve" });
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    const mod = await User.create({ ...createUserData(), role: "moderator" });
    mockRequireAuth.mockResolvedValue({ payload: { userId: mod._id.toString(), role: "moderator" } });

    const res = await callReviewPost({ type: "message" }); // missing id and action
    expect(res.status).toBe(400);
  });

  it("returns 400 when action is invalid", async () => {
    const mod = await User.create({ ...createUserData(), role: "moderator" });
    mockRequireAuth.mockResolvedValue({ payload: { userId: mod._id.toString(), role: "moderator" } });

    const res = await callReviewPost({ type: "message", id: "aaaaaaaaaaaaaaaaaaaaaaaa", action: "skip" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/approve, deny, or retry_rewrite/i);
  });

  it("returns 400 for invalid type", async () => {
    const mod = await User.create({ ...createUserData(), role: "moderator" });
    mockRequireAuth.mockResolvedValue({ payload: { userId: mod._id.toString(), role: "moderator" } });

    const validId = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const res = await callReviewPost({ type: "video", id: validId, action: "approve" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid type/i);
  });

  describe("message review", () => {
    it("approves a held message → state becomes delivered", async () => {
      const moderator = await User.create({ ...createUserData(), role: "moderator" });
      const sender = await User.create(createUserData());
      const channel = await Channel.create({
        users: [moderator._id, sender._id],
        clanchaNumber: "+15560001001",
        state: "active",
      });
      const message = await Message.create({
        ...createMessageData({ channelId: channel._id, senderId: sender._id, state: "held" }),
        originalText: "Bad message",
        rewrittenText: "Neutral message",
        deliveredAt: null,
      });

      mockRequireAuth.mockResolvedValue({
        payload: { userId: moderator._id.toString(), role: "moderator" },
      });

      const res = await callReviewPost({
        type: "message",
        id: message._id.toString(),
        action: "approve",
        notes: "Looks fine",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.state).toBe("delivered");

      const updated = await Message.findById(message._id);
      expect(updated!.state).toBe("delivered");
      expect(updated!.deliveredAt).toBeDefined();
      expect(updated!.moderatorNotes).toBe("Looks fine");
    });

    it("denies a held message → state becomes blocked", async () => {
      const moderator = await User.create({ ...createUserData(), role: "moderator" });
      const sender = await User.create(createUserData());
      const channel = await Channel.create({
        users: [moderator._id, sender._id],
        clanchaNumber: "+15560001002",
        state: "active",
      });
      const message = await Message.create({
        ...createMessageData({ channelId: channel._id, senderId: sender._id, state: "held" }),
      });

      mockRequireAuth.mockResolvedValue({
        payload: { userId: moderator._id.toString(), role: "moderator" },
      });

      const res = await callReviewPost({
        type: "message",
        id: message._id.toString(),
        action: "deny",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.state).toBe("blocked");

      const updated = await Message.findById(message._id);
      expect(updated!.state).toBe("blocked");
    });

    it("returns 400 when message is not in held state", async () => {
      const moderator = await User.create({ ...createUserData(), role: "moderator" });
      const sender = await User.create(createUserData());
      const channel = await Channel.create({
        users: [moderator._id, sender._id],
        clanchaNumber: "+15560001003",
        state: "active",
      });
      const message = await Message.create({
        ...createMessageData({ channelId: channel._id, senderId: sender._id, state: "delivered" }),
      });

      mockRequireAuth.mockResolvedValue({
        payload: { userId: moderator._id.toString(), role: "moderator" },
      });

      const res = await callReviewPost({
        type: "message",
        id: message._id.toString(),
        action: "approve",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when message id does not exist", async () => {
      const mod = await User.create({ ...createUserData(), role: "moderator" });
      mockRequireAuth.mockResolvedValue({ payload: { userId: mod._id.toString(), role: "moderator" } });

      const res = await callReviewPost({
        type: "message",
        id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        action: "approve",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("image review", () => {
    it("approves a pending image → creates a delivered message", async () => {
      const moderator = await User.create({ ...createUserData(), role: "moderator" });
      const sender = await User.create(createUserData());
      const channel = await Channel.create({
        users: [moderator._id, sender._id],
        clanchaNumber: "+15560002001",
        state: "active",
      });
      const image = await Image.create({
        channelId: channel._id,
        senderId: sender._id,
        storageUrl: "https://s3.example.com/image.jpg",
        thumbnailUrl: "https://s3.example.com/thumb.jpg",
        state: "pending",
      });

      mockRequireAuth.mockResolvedValue({
        payload: { userId: moderator._id.toString(), role: "moderator" },
      });

      const res = await callReviewPost({
        type: "image",
        id: image._id.toString(),
        action: "approve",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.state).toBe("approved");
      expect(data.messageId).toBeDefined();

      // A new delivered message should have been created. The text is the
      // friendly "[Image]" placeholder, NOT the raw S3 URL — the actual
      // image is fetched from imageId at render time
      // (M4 tracker #7: caption used to leak the S3 path).
      const msg = await Message.findById(data.messageId);
      expect(msg!.state).toBe("delivered");
      expect(msg!.originalText).toBe("[Image]");
      expect(msg!.imageId?.toString()).toBe(image._id.toString());
    });

    it("denies a pending image → state becomes denied", async () => {
      const moderator = await User.create({ ...createUserData(), role: "moderator" });
      const sender = await User.create(createUserData());
      const channel = await Channel.create({
        users: [moderator._id, sender._id],
        clanchaNumber: "+15560002002",
        state: "active",
      });
      const image = await Image.create({
        channelId: channel._id,
        senderId: sender._id,
        storageUrl: "https://s3.example.com/bad.jpg",
        thumbnailUrl: "https://s3.example.com/bad-thumb.jpg",
        state: "pending",
      });

      mockRequireAuth.mockResolvedValue({
        payload: { userId: moderator._id.toString(), role: "moderator" },
      });

      const res = await callReviewPost({
        type: "image",
        id: image._id.toString(),
        action: "deny",
        notes: "Inappropriate content",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.state).toBe("denied");

      const updated = await Image.findById(image._id);
      expect(updated!.state).toBe("denied");
      expect(updated!.moderatorNotes).toBe("Inappropriate content");
    });

    it("returns 400 when image is not in pending state", async () => {
      const moderator = await User.create({ ...createUserData(), role: "moderator" });
      const sender = await User.create(createUserData());
      const channel = await Channel.create({
        users: [moderator._id, sender._id],
        clanchaNumber: "+15560002003",
        state: "active",
      });
      const image = await Image.create({
        channelId: channel._id,
        senderId: sender._id,
        storageUrl: "https://s3.example.com/already.jpg",
        thumbnailUrl: "https://s3.example.com/already-thumb.jpg",
        state: "approved",
      });

      mockRequireAuth.mockResolvedValue({
        payload: { userId: moderator._id.toString(), role: "moderator" },
      });

      const res = await callReviewPost({
        type: "image",
        id: image._id.toString(),
        action: "approve",
      });
      expect(res.status).toBe(400);
    });
  });
});
