import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User, Channel, Invite, ChannelViewer } from "@/lib/db/models";
import { createUserData } from "@/tests/helpers/fixtures";
import { generateInviteToken, hashInviteToken } from "@/lib/auth/invite";

vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function createInviteFixture(opts: {
  email: string;
  channelId: string;
  invitedByUserId: string;
  status?: "pending" | "accepted" | "expired" | "revoked";
  hoursUntilExpiry?: number;
}) {
  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + (opts.hoursUntilExpiry ?? 72));

  const invite = await Invite.create({
    channelId: opts.channelId,
    invitedByUserId: opts.invitedByUserId,
    email: opts.email,
    tokenHash,
    accessLevel: "read_only",
    status: opts.status ?? "pending",
    expiresAt,
  });
  return { invite, token };
}

function makeGetRequest(token: string, channelId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/invites/accept?token=${token}&channelId=${channelId}`
  );
}

function makePostRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/invites/accept", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function callGet(token: string, channelId: string) {
  const { GET } = await import("@/app/api/invites/accept/route");
  return GET(makeGetRequest(token, channelId));
}

async function callPost(body: object) {
  const { POST } = await import("@/app/api/invites/accept/route");
  return POST(makePostRequest(body));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/invites/accept (validate invite token)", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("returns 400 when token or channelId is missing", async () => {
    const { GET } = await import("@/app/api/invites/accept/route");
    const req = new NextRequest("http://localhost/api/invites/accept");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 for invalid or unknown token", async () => {
    const res = await callGet("fake-token", "aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.valid).toBe(false);
  });

  it("returns 410 when invite is expired", async () => {
    const inviter = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [inviter._id, other._id],
      clanchaNumber: "+15570001001",
      state: "active",
    });

    const { token } = await createInviteFixture({
      email: "viewer@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: inviter._id.toString(),
      hoursUntilExpiry: -1, // already expired
    });

    const res = await callGet(token, channel._id.toString());
    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.valid).toBe(false);
  });

  it("returns valid invite details for a valid token", async () => {
    const inviter = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [inviter._id, other._id],
      clanchaNumber: "+15570001002",
      state: "active",
    });

    const { token } = await createInviteFixture({
      email: "viewer@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: inviter._id.toString(),
    });

    const res = await callGet(token, channel._id.toString());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.valid).toBe(true);
    expect(data.email).toBe("viewer@example.com");
    expect(data.accessLevel).toBe("read_only");
    expect(data.expiresAt).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/invites/accept (accept invite)", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  // ── Test shape rewritten 2026-05-22 (Craig M4 tracker #41) ──
  // Body is now { token, channelId, password, fullName? } — email is taken
  // from the invite record, never the body (a client controlling the form
  // could otherwise forge a viewer identity). SMS OTP is gone, replaced by
  // email + bcrypt password.

  it("returns 400 when token is missing", async () => {
    const res = await callPost({ password: "ClanchaViewer2026!" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is missing", async () => {
    const res = await callPost({
      token: "x",
      channelId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an invalid token", async () => {
    const res = await callPost({
      token: "invalid-token",
      channelId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      password: "ClanchaViewer2026!",
      fullName: "Test Viewer",
    });
    expect(res.status).toBe(404);
  });

  it("returns 410 when invite is expired", async () => {
    const inviter = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [inviter._id, other._id],
      clanchaNumber: "+15570002001",
      state: "active",
    });

    const { token } = await createInviteFixture({
      email: "expired@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: inviter._id.toString(),
      hoursUntilExpiry: -1,
    });

    const res = await callPost({
      token,
      channelId: channel._id.toString(),
      password: "ClanchaViewer2026!",
      fullName: "Expired Viewer",
    });
    expect(res.status).toBe(410);
  });

  it("rejects a short password on first acceptance", async () => {
    const inviter = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [inviter._id, other._id],
      clanchaNumber: "+15570002002",
      state: "active",
    });
    const { token } = await createInviteFixture({
      email: "short-pw@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: inviter._id.toString(),
    });

    const res = await callPost({
      token,
      channelId: channel._id.toString(),
      password: "tiny",
      fullName: "Shorty",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/8 characters/i);
  });

  it("creates a viewer user with a hashed password on first acceptance", async () => {
    const inviter = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [inviter._id, other._id],
      clanchaNumber: "+15570002003",
      state: "active",
    });

    const { token } = await createInviteFixture({
      email: "newviewer@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: inviter._id.toString(),
    });

    const res = await callPost({
      token,
      channelId: channel._id.toString(),
      password: "ClanchaViewer2026!",
      fullName: "Alex Morgan",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.channelId).toBe(channel._id.toString());
    expect(data.accessLevel).toBe("read_only");
    expect(data.createdNewAccount).toBe(true);

    const viewerUser = await User.findOne({ email: "newviewer@example.com" }).select("+password");
    expect(viewerUser).toBeTruthy();
    expect(viewerUser!.role).toBe("viewer");
    expect(viewerUser!.name).toBe("Alex Morgan");
    // Synthetic placeholder phone — viewers don't need a real number.
    expect(viewerUser!.phone.startsWith("viewer:")).toBe(true);
    // Password stored as bcrypt hash, not plaintext.
    expect(viewerUser!.password).toBeTruthy();
    expect(viewerUser!.password).not.toBe("ClanchaViewer2026!");

    const viewer = await ChannelViewer.findOne({ channelId: channel._id, userId: viewerUser!._id });
    expect(viewer).toBeTruthy();
    expect(viewer!.status).toBe("active");
    expect(viewer!.accessLevel).toBe("read_only");

    const updatedInvite = await Invite.findOne({ tokenHash: hashInviteToken(token) });
    expect(updatedInvite!.status).toBe("accepted");

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("token=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("authenticates a returning viewer with their existing password and adds the new channel", async () => {
    const bcrypt = await import("bcryptjs");
    const inviter = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [inviter._id, other._id],
      clanchaNumber: "+15570002004",
      state: "active",
    });

    // Returning viewer already has a hashed password set on a prior channel.
    const hash = await bcrypt.hash("ReturningViewer123!", 12);
    const existingViewer = await User.create({
      email: "returning@example.com",
      phone: "viewer:deadbeef",
      password: hash,
      role: "viewer",
      name: "Returning Viewer",
    });

    const { token } = await createInviteFixture({
      email: "returning@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: inviter._id.toString(),
    });

    const res = await callPost({
      token,
      channelId: channel._id.toString(),
      password: "ReturningViewer123!",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.createdNewAccount).toBe(false);

    const viewer = await ChannelViewer.findOne({
      channelId: channel._id,
      userId: existingViewer._id,
    });
    expect(viewer).toBeTruthy();
    expect(viewer!.status).toBe("active");
  });

  it("returns 401 when a returning viewer supplies the wrong password", async () => {
    const bcrypt = await import("bcryptjs");
    const inviter = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [inviter._id, other._id],
      clanchaNumber: "+15570002005",
      state: "active",
    });

    const hash = await bcrypt.hash("CorrectPassword1!", 12);
    await User.create({
      email: "wrongpw@example.com",
      phone: "viewer:cafebabe",
      password: hash,
      role: "viewer",
    });

    const { token } = await createInviteFixture({
      email: "wrongpw@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: inviter._id.toString(),
    });

    const res = await callPost({
      token,
      channelId: channel._id.toString(),
      password: "WrongPassword1!",
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/incorrect password/i);
  });

  it("returns 409 when viewer already has active access to the same channel", async () => {
    const bcrypt = await import("bcryptjs");
    const inviter = await User.create(createUserData());
    const other = await User.create(createUserData());
    const channel = await Channel.create({
      users: [inviter._id, other._id],
      clanchaNumber: "+15570002006",
      state: "active",
    });

    const hash = await bcrypt.hash("AlreadyActive1!", 12);
    const existingViewer = await User.create({
      email: "active@example.com",
      phone: "viewer:f00dbabe",
      password: hash,
      role: "viewer",
    });

    const { invite: invite1 } = await createInviteFixture({
      email: "active@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: inviter._id.toString(),
      status: "accepted",
    });
    await ChannelViewer.create({
      channelId: channel._id,
      userId: existingViewer._id,
      inviteId: invite1._id,
      accessLevel: "read_only",
      status: "active",
      grantedByUserId: inviter._id,
    });

    const { token: token2 } = await createInviteFixture({
      email: "active@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: inviter._id.toString(),
    });

    const res = await callPost({
      token: token2,
      channelId: channel._id.toString(),
      password: "AlreadyActive1!",
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/already have access/i);
  });
});
