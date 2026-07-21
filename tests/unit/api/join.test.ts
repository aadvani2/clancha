import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach,
} from "vitest";
import { NextRequest } from "next/server";
import mongoose from "mongoose";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User, Channel, JoinToken } from "@/lib/db/models";
import { createUserData, createChannelData } from "@/tests/helpers/fixtures";
import {
  generateJoinToken,
  hashJoinToken,
  buildJoinLink,
  createJoinTokenForUserChannel,
} from "@/lib/auth/joinToken";

vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

// Twilio Verify is the only external dependency in /api/join/verify-otp.
// Mock both sides — send-otp shouldn't be hit in these tests anyway.
vi.mock("@/lib/auth/twilio-verify", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/twilio-verify")>(
    "@/lib/auth/twilio-verify"
  );
  return {
    ...actual,
    sendVerificationWithTwilioVerify: vi.fn().mockResolvedValue(undefined),
    checkVerificationWithTwilioVerify: vi.fn().mockResolvedValue(true),
  };
});

// Stable JWT for the cookie. We don't assert the value, only the presence.
vi.mock("@/lib/auth/jwt", () => ({
  signToken: vi.fn().mockReturnValue("test.jwt.token"),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
async function buildChannelWithJoiner(opts?: { inviterName?: string; recipientName?: string | null }) {
  const inviter = await User.create(
    createUserData({ phone: "+447111000001", name: opts?.inviterName ?? "Alice Inviter" })
  );
  const recipient = await User.create(
    createUserData({
      phone: "+447111000002",
      name: opts?.recipientName ?? undefined,
    })
  );
  const channel = await Channel.create(
    createChannelData({
      users: [inviter._id as mongoose.Types.ObjectId, recipient._id as mongoose.Types.ObjectId],
      clanchaNumber: "+447111000003",
      state: "active",
    })
  );
  return { inviter, recipient, channel };
}

function makeLookupRequest(token: string): NextRequest {
  return new NextRequest(`http://localhost/api/join/lookup?t=${token}`);
}

function makeVerifyRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/join/verify-otp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function callLookup(token: string) {
  const { GET } = await import("@/app/api/join/lookup/route");
  return GET(makeLookupRequest(token));
}

async function callVerify(body: object) {
  const { POST } = await import("@/app/api/join/verify-otp/route");
  return POST(makeVerifyRequest(body));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("JoinToken helpers", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); });

  it("generateJoinToken returns an 11-char base62 short code", () => {
    // Short tokens keep the A1 SMS in one segment (Craig, M4 feedback
    // 05/07/26 §1.3). 11 base62 chars ≈ 65 bits — single-use + hashed at
    // rest + OTP-gated claim flow.
    const token = generateJoinToken();
    expect(token).toMatch(/^[0-9A-Za-z]{11}$/);
  });

  it("hashJoinToken is deterministic and SHA256-shaped", () => {
    const t = generateJoinToken();
    const h1 = hashJoinToken(t);
    const h2 = hashJoinToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(t); // hash is not the token
  });

  it("buildJoinLink composes short /j/<token> URL and strips trailing slash on base", () => {
    expect(buildJoinLink("abc123", "https://example.com/")).toBe(
      "https://example.com/j/abc123"
    );
  });

  it("createJoinTokenForUserChannel persists hashed token and returns plaintext", async () => {
    const { recipient, channel } = await buildChannelWithJoiner();
    const token = await createJoinTokenForUserChannel(recipient._id as mongoose.Types.ObjectId, channel._id as mongoose.Types.ObjectId);

    expect(token).toMatch(/^[0-9A-Za-z]{11}$/);
    const stored = await JoinToken.findOne({ tokenHash: hashJoinToken(token) }).lean();
    expect(stored).not.toBeNull();
    expect(stored?.consumedAt).toBeNull();
    expect(stored?.userId.toString()).toBe((recipient._id as mongoose.Types.ObjectId).toString());
    expect(stored?.channelId.toString()).toBe((channel._id as mongoose.Types.ObjectId).toString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/join/lookup", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); });

  it("returns ok with masked phone, inviter name, channel id for a fresh token", async () => {
    const { inviter, recipient, channel } = await buildChannelWithJoiner({ inviterName: "Alice Inviter" });
    const token = await createJoinTokenForUserChannel(recipient._id as mongoose.Types.ObjectId, channel._id as mongoose.Types.ObjectId);

    const res = await callLookup(token);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.phoneMasked).toBe("***0002"); // last 4 of +447111000002
    expect(data.inviterName).toBe("Alice Inviter");
    expect(data.channelId).toBe((channel._id as mongoose.Types.ObjectId).toString());
    expect(inviter).toBeDefined();
  });

  it("returns invalid for a missing token", async () => {
    const res = await callLookup("");
    expect(res.status).toBe(400);
  });

  it("returns invalid for an unknown token", async () => {
    const res = await callLookup("0".repeat(64));
    const data = await res.json();
    expect(res.status).toBe(404);
    expect(data.status).toBe("invalid");
  });

  it("returns consumed once the token has been claimed", async () => {
    const { recipient, channel } = await buildChannelWithJoiner();
    const token = await createJoinTokenForUserChannel(recipient._id as mongoose.Types.ObjectId, channel._id as mongoose.Types.ObjectId);
    await JoinToken.updateOne({ tokenHash: hashJoinToken(token) }, { $set: { consumedAt: new Date() } });

    const res = await callLookup(token);
    const data = await res.json();
    expect(data.status).toBe("consumed");
  });

  it("returns channel_closed when the channel has been closed", async () => {
    const { recipient, channel } = await buildChannelWithJoiner();
    const token = await createJoinTokenForUserChannel(recipient._id as mongoose.Types.ObjectId, channel._id as mongoose.Types.ObjectId);
    await Channel.updateOne({ _id: channel._id }, { $set: { state: "closed" } });

    const res = await callLookup(token);
    const data = await res.json();
    expect(data.status).toBe("channel_closed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/join/verify-otp", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  beforeEach(async () => {
    // Reset Twilio mock to "valid" between tests so individual tests can flip
    // to "invalid" without leaking.
    const tv = await import("@/lib/auth/twilio-verify");
    (tv.checkVerificationWithTwilioVerify as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); });

  it("happy path: seeds joiner defaults, consumes token, issues session cookie", async () => {
    const { recipient, channel } = await buildChannelWithJoiner();
    const token = await createJoinTokenForUserChannel(recipient._id as mongoose.Types.ObjectId, channel._id as mongoose.Types.ObjectId);

    const res = await callVerify({ token, code: "123456" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.channelId).toBe((channel._id as mongoose.Types.ObjectId).toString());

    // Defaults applied to the User.
    const updated = await User.findById(recipient._id).lean();
    expect(updated?.receivingHoursStart).toBe("06:00");
    expect(updated?.receivingHoursEnd).toBe("23:00");
    expect(updated?.timezone).toBe("Europe/London");

    // Token is now consumed.
    const stored = await JoinToken.findOne({ tokenHash: hashJoinToken(token) }).lean();
    expect(stored?.consumedAt).not.toBeNull();

    // Session cookie set.
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("token=");
  });

  it("does not clobber existing receiving-hours / timezone preferences", async () => {
    const { recipient, channel } = await buildChannelWithJoiner();
    // Recipient already has custom hours from a previous session
    await User.updateOne(
      { _id: recipient._id },
      { $set: { receivingHoursStart: "09:00", receivingHoursEnd: "20:00", timezone: "Europe/Berlin" } }
    );
    const token = await createJoinTokenForUserChannel(recipient._id as mongoose.Types.ObjectId, channel._id as mongoose.Types.ObjectId);

    await callVerify({ token, code: "123456" });

    const updated = await User.findById(recipient._id).lean();
    expect(updated?.receivingHoursStart).toBe("09:00");
    expect(updated?.receivingHoursEnd).toBe("20:00");
    expect(updated?.timezone).toBe("Europe/Berlin");
  });

  it("returns 410 when the same token is verified twice (single-use)", async () => {
    const { recipient, channel } = await buildChannelWithJoiner();
    const token = await createJoinTokenForUserChannel(recipient._id as mongoose.Types.ObjectId, channel._id as mongoose.Types.ObjectId);

    const first = await callVerify({ token, code: "123456" });
    expect(first.status).toBe(200);

    const second = await callVerify({ token, code: "123456" });
    expect(second.status).toBe(410);
    const data = await second.json();
    expect(data.error).toMatch(/already been claimed/i);
  });

  it("rejects when Twilio Verify says the code is invalid", async () => {
    const tv = await import("@/lib/auth/twilio-verify");
    (tv.checkVerificationWithTwilioVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const { recipient, channel } = await buildChannelWithJoiner();
    const token = await createJoinTokenForUserChannel(recipient._id as mongoose.Types.ObjectId, channel._id as mongoose.Types.ObjectId);

    const res = await callVerify({ token, code: "000000" });
    expect(res.status).toBe(400);

    // Token must NOT be consumed when OTP failed.
    const stored = await JoinToken.findOne({ tokenHash: hashJoinToken(token) }).lean();
    expect(stored?.consumedAt).toBeNull();
  });

  it("404s on an unknown token", async () => {
    const res = await callVerify({ token: "f".repeat(64), code: "123456" });
    expect(res.status).toBe(404);
  });

  it("410s if the channel has been closed between issue and claim", async () => {
    const { recipient, channel } = await buildChannelWithJoiner();
    const token = await createJoinTokenForUserChannel(recipient._id as mongoose.Types.ObjectId, channel._id as mongoose.Types.ObjectId);
    await Channel.updateOne({ _id: channel._id }, { $set: { state: "closed" } });

    const res = await callVerify({ token, code: "123456" });
    expect(res.status).toBe(410);
  });
});
