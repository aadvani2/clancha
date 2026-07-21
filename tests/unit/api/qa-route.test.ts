import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User, Channel, Message, AuditLog } from "@/lib/db/models";
import { createUserData } from "@/tests/helpers/fixtures";
import mongoose from "mongoose";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth: mockRequireAuth }));

const mockOpenAICreate = vi.fn();
vi.mock("@/lib/services/openai", () => ({
  getOpenAIClient: () => ({
    chat: { completions: { create: mockOpenAICreate } },
  }),
}));

vi.mock("@/lib/services/promptStore", () => ({
  getActivePrompt: vi.fn().mockResolvedValue("[mock] You are a Q&A tool."),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/qa", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function callPost(body: object) {
  const { POST } = await import("@/app/api/qa/route");
  return POST(makeRequest(body));
}

function mockLLM(text: string) {
  mockOpenAICreate.mockResolvedValue({
    choices: [{ message: { content: text } }],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/qa", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await callPost({ channelId: "abc", question: "hi" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the user is not a channel member", async () => {
    const member = await User.create(createUserData({ phone: "+447700900100", email: "m@x.com" }));
    const other = await User.create(createUserData({ phone: "+447700900101", email: "o@x.com" }));
    const outsider = await User.create(createUserData({ phone: "+447700900102", email: "out@x.com" }));
    const channel = await Channel.create({
      users: [member._id, other._id],
      clanchaNumber: "+447700900900",
      state: "active",
    });

    mockRequireAuth.mockResolvedValue({ payload: { userId: outsider._id.toString() } });
    const res = await callPost({ channelId: channel._id.toString(), question: "When?" });
    expect(res.status).toBe(403);
  });

  it("blocks a fabricated quoted answer and audit-logs the rejection", async () => {
    const a = await User.create(createUserData({ phone: "+447700900200", email: "a@x.com", name: "Alex" }));
    const b = await User.create(createUserData({ phone: "+447700900201", email: "b@x.com", name: "Sam" }));
    const channel = await Channel.create({
      users: [a._id, b._id],
      clanchaNumber: "+447700900901",
      state: "active",
    });
    await Message.create({
      channelId: channel._id,
      senderId: b._id,
      originalText: "pickup 6pm",
      rewrittenText: "Pickup confirmed for 6pm Friday.",
      state: "delivered",
      deliveredAt: new Date(),
    });

    // LLM hallucinates a quote that isn't in the rewritten history.
    mockLLM("Sam said \"I'll be at Link Club around 6pm and pop by yours first to pick up his trainers\".");

    mockRequireAuth.mockResolvedValue({ payload: { userId: a._id.toString() } });
    const res = await callPost({
      channelId: channel._id.toString(),
      question: "What did Sam agree to do this weekend?",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answer).toMatch(/can't answer/i);

    // Audit log records the rejection so we can spot regression patterns.
    const logs = await AuditLog.find({}).lean();
    const log = logs.find((l) => l.action === "qa_fabrication_blocked");
    expect(log).toBeTruthy();
    expect((log!.metadata as { fabricated?: boolean }).fabricated).toBe(true);
  });

  it("passes through a clean factual answer with no quotation marks", async () => {
    const a = await User.create(createUserData({ phone: "+447700900300", email: "ac@x.com", name: "Alex" }));
    const b = await User.create(createUserData({ phone: "+447700900301", email: "bc@x.com", name: "Sam" }));
    const channel = await Channel.create({
      users: [a._id, b._id],
      clanchaNumber: "+447700900902",
      state: "active",
    });
    await Message.create({
      channelId: channel._id,
      senderId: b._id,
      originalText: "pickup 6pm",
      rewrittenText: "Pickup confirmed for 6pm Friday.",
      state: "delivered",
      deliveredAt: new Date(),
    });

    mockLLM("Sam confirmed pickup at 6pm on Friday.");

    mockRequireAuth.mockResolvedValue({ payload: { userId: a._id.toString() } });
    const res = await callPost({
      channelId: channel._id.toString(),
      question: "When is pickup?",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answer).toBe("Sam confirmed pickup at 6pm on Friday.");

    const logs = await AuditLog.find({}).lean();
    const log = logs.find((l) => l.action === "qa_answered");
    expect(log).toBeTruthy();
  });

  it("never reads originalText into the LLM context", async () => {
    const a = await User.create(createUserData({ phone: "+447700900400", email: "ad@x.com", name: "Alex" }));
    const b = await User.create(createUserData({ phone: "+447700900401", email: "bd@x.com", name: "Sam" }));
    const channel = await Channel.create({
      users: [a._id, b._id],
      clanchaNumber: "+447700900903",
      state: "active",
    });
    const SECRET_ORIGINAL = "DO_NOT_LEAK_THIS_ORIGINAL_TEXT_12345";
    await Message.create({
      channelId: channel._id,
      senderId: b._id,
      originalText: SECRET_ORIGINAL,
      rewrittenText: "Pickup confirmed for 6pm Friday.",
      state: "delivered",
      deliveredAt: new Date(),
    });

    mockLLM("Pickup is at 6pm Friday.");

    mockRequireAuth.mockResolvedValue({ payload: { userId: a._id.toString() } });
    await callPost({
      channelId: channel._id.toString(),
      question: "When is pickup?",
    });

    // Inspect the messages we actually sent to the LLM — originalText must
    // never appear in the user-role content.
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    const callArgs = mockOpenAICreate.mock.calls[0][0];
    const userContent = (callArgs.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "user"
    )?.content ?? "";
    expect(userContent).not.toContain(SECRET_ORIGINAL);
    expect(userContent).toContain("Pickup confirmed for 6pm Friday.");
  });

  it("Message.find().select() shape excludes originalText (lock-down: prevents 20-May leak regression)", async () => {
    // Spec rule (Doc 2 §11 / project memory): Q&A engine never reads
    // originalText. Test #5 above verifies the LLM-input doesn't contain
    // originals, but only catches the post-query path — if a future change
    // removes the .select() call entirely, Mongoose returns ALL fields and
    // the LLM-input test still happens to pass because the prompt builder
    // formats `rewrittenText` regardless. This test locks down the actual
    // query shape so the .select() string itself can never silently grow to
    // include originalText.
    const a = await User.create(createUserData({ phone: "+447700900600", email: "af@x.com", name: "Alex" }));
    const b = await User.create(createUserData({ phone: "+447700900601", email: "bf@x.com", name: "Sam" }));
    const channel = await Channel.create({
      users: [a._id, b._id],
      clanchaNumber: "+447700900905",
      state: "active",
    });
    await Message.create({
      channelId: channel._id,
      senderId: b._id,
      originalText: "SHOULD_NEVER_BE_SELECTED",
      rewrittenText: "Confirmed for 6pm.",
      state: "delivered",
      deliveredAt: new Date(),
    });

    // Capture the argument passed to .select(). Wraps the real Mongoose
    // chain so the route still runs end-to-end against the in-memory DB.
    const realFind = Message.find.bind(Message);
    const selectSpy = vi.fn();
    const findSpy = vi.spyOn(Message, "find").mockImplementation(((...args: Parameters<typeof realFind>) => {
      const q = realFind(...args);
      const realSelect = q.select.bind(q);
      q.select = ((fields: string | Record<string, 0 | 1>) => {
        selectSpy(fields);
        return realSelect(fields);
      }) as typeof q.select;
      return q;
    }) as typeof Message.find);

    mockLLM("Confirmed for 6pm.");
    mockRequireAuth.mockResolvedValue({ payload: { userId: a._id.toString() } });
    await callPost({ channelId: channel._id.toString(), question: "When is pickup?" });

    findSpy.mockRestore();

    expect(selectSpy).toHaveBeenCalled();
    // .select() can be called with either a space-separated string or an
    // object. Normalise to a string and assert originalText is not anywhere
    // in the selection — neither as an include-list entry nor as a "-"
    // exclusion turned positive elsewhere.
    const allArgs = selectSpy.mock.calls.map((c) => c[0]);
    for (const arg of allArgs) {
      const flat =
        typeof arg === "string"
          ? arg
          : Object.entries(arg as Record<string, 0 | 1>)
              .filter(([, v]) => v === 1)
              .map(([k]) => k)
              .join(" ");
      expect(flat).not.toContain("originalText");
    }

    // Also assert positively that rewrittenText IS selected — to detect a
    // regression that removes the .select() entirely (which would return
    // empty objects, breaking the route silently).
    const anyHasRewritten = allArgs.some((arg) => {
      const flat =
        typeof arg === "string"
          ? arg
          : Object.entries(arg as Record<string, 0 | 1>)
              .filter(([, v]) => v === 1)
              .map(([k]) => k)
              .join(" ");
      return flat.includes("rewrittenText");
    });
    expect(anyHasRewritten).toBe(true);
  });

  it("labels each message line with its speaker so the LLM can attribute facts", async () => {
    const a = await User.create(createUserData({ phone: "+447700900500", email: "ae@x.com", name: "Alex" }));
    const b = await User.create(createUserData({ phone: "+447700900501", email: "be@x.com", name: "Sam" }));
    const channel = await Channel.create({
      users: [a._id, b._id],
      clanchaNumber: "+447700900904",
      state: "active",
    });
    await Message.create({
      channelId: channel._id,
      senderId: a._id,
      originalText: "x",
      rewrittenText: "I can pick up at 6pm.",
      state: "delivered",
      deliveredAt: new Date(),
    });
    await Message.create({
      channelId: channel._id,
      senderId: b._id,
      originalText: "y",
      rewrittenText: "Great, see you then.",
      state: "delivered",
      deliveredAt: new Date(),
    });

    mockLLM("Confirmed for 6pm.");

    mockRequireAuth.mockResolvedValue({ payload: { userId: a._id.toString() } });
    await callPost({
      channelId: channel._id.toString(),
      question: "Is pickup confirmed?",
    });

    const callArgs = mockOpenAICreate.mock.calls[0][0];
    const userContent = (callArgs.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "user"
    )?.content ?? "";
    expect(userContent).toMatch(/Alex: I can pick up at 6pm\./);
    expect(userContent).toMatch(/Sam: Great, see you then\./);
  });
});
