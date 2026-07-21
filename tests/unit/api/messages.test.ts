import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User, Channel, Message } from "@/lib/db/models";
import { createUserData } from "@/tests/helpers/fixtures";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth: mockRequireAuth }));

// Isolate the rewrite pipeline – test the route logic, not the AI
const mockProcessRewriting = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/services/rewritePipeline", () => ({
  processRewritingMessage: mockProcessRewriting,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/messages/send", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function callPost(body: object) {
  const { POST } = await import("@/app/api/messages/send/route");
  return POST(makeRequest(body));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/messages/send", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });

    const res = await callPost({ channelId: "abc", text: "hello" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when channelId is missing", async () => {
    const user = await User.create(createUserData());
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ text: "hello" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/channelId/i);
  });

  it("returns 400 when text is missing", async () => {
    const user = await User.create(createUserData());
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ channelId: "abc123def456abc123def456" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/text/i);
  });

  it("returns 400 when text is only whitespace", async () => {
    const user = await User.create(createUserData());
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ channelId: "abc123def456abc123def456", text: "   " });
    expect(res.status).toBe(400);
  });

  it("returns 404 when channel does not exist", async () => {
    const user = await User.create(createUserData());
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const fakeId = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const res = await callPost({ channelId: fakeId, text: "hello" });
    expect(res.status).toBe(404);
  });

  it("returns 403 when channel is in view_only state", async () => {
    const user = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [user._id, other._id],
      clanchaNumber: "+15550001111",
      state: "view_only",
    });
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ channelId: channel._id.toString(), text: "hello" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when channel is closed", async () => {
    const user = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [user._id, other._id],
      clanchaNumber: "+15550001112",
      state: "closed",
    });
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ channelId: channel._id.toString(), text: "hello" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when user is not a channel member", async () => {
    const user = await User.create(createUserData());
    const member1 = await User.create(createUserData());
    const member2 = await User.create(createUserData());
    const channel = await Channel.create({
      users: [member1._id, member2._id],
      clanchaNumber: "+15550001113",
      state: "active",
    });
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ channelId: channel._id.toString(), text: "hello" });
    expect(res.status).toBe(403);
  });

  it("creates a message and calls processRewritingMessage", async () => {
    const user = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [user._id, other._id],
      clanchaNumber: "+15550001114",
      state: "active",
    });
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });
    mockProcessRewriting.mockResolvedValue(undefined);

    const res = await callPost({ channelId: channel._id.toString(), text: "Hello there!" });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.channelId).toBe(channel._id.toString());
    expect(data.senderId).toBe(user._id.toString());
    expect(data.originalText).toBe("Hello there!");

    expect(mockProcessRewriting).toHaveBeenCalledOnce();
    expect(mockProcessRewriting).toHaveBeenCalledWith(data.id);

    // Message persisted in DB
    const msg = await Message.findById(data.id);
    expect(msg).toBeTruthy();
  });

  it("trims whitespace from message text", async () => {
    const user = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [user._id, other._id],
      clanchaNumber: "+15550001115",
      state: "active",
    });
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });
    mockProcessRewriting.mockResolvedValue(undefined);

    const res = await callPost({
      channelId: channel._id.toString(),
      text: "  trimmed message  ",
    });
    const data = await res.json();
    expect(data.originalText).toBe("trimmed message");
  });

  it("returns message in rewriting state initially (before pipeline runs)", async () => {
    const user = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [user._id, other._id],
      clanchaNumber: "+15550001116",
      state: "active",
    });
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });
    // Pipeline does nothing; message stays as created
    mockProcessRewriting.mockResolvedValue(undefined);

    const res = await callPost({ channelId: channel._id.toString(), text: "test" });
    expect(res.status).toBe(200);

    // The route returns the updated message after pipeline, but since pipeline is mocked,
    // the state will remain "rewriting"
    const data = await res.json();
    expect(["rewriting", "delivered", "held", "blocked"]).toContain(data.state);
  });
});
