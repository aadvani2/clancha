/**
 * E2E Journey: Third-Party Viewer Invite
 *
 * Tests the complete flow of a channel member inviting a third-party viewer,
 * the viewer accepting the invite, gaining read-only access, and access revocation.
 */
import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User, Channel, Invite, ChannelViewer } from "@/lib/db/models";
import { createUserData } from "@/tests/helpers/fixtures";
import {
  generateInviteToken, hashInviteToken, getInviteExpiry,
} from "@/lib/auth/invite";
import { verifyToken } from "@/lib/auth/jwt";

vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth: mockRequireAuth }));

// A11 viewer-added notification and A15/A16 revoke/leave SMS all go through
// sendSmsWithRetry — without it the Twilio SDK boot trips on the stub SID.
vi.mock("@/lib/services/twilio", () => ({
  getTwilioClient: vi.fn().mockReturnValue(null),
  getTwilioVoiceUrl: vi.fn().mockReturnValue("https://example.com/voice"),
  sendSms: vi.fn().mockResolvedValue(undefined),
  sendSmsWithRetry: vi.fn().mockResolvedValue({ success: true, status: "delivered", sid: "SM_test_fake" }),
}));

// Helper to directly create an invite in the DB (simulating POST /api/channels/[id]/invite)
async function seedInvite(opts: {
  email: string;
  channelId: string;
  invitedByUserId: string;
  hoursUntilExpiry?: number;
}) {
  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = getInviteExpiry(opts.hoursUntilExpiry ?? 72);
  const invite = await Invite.create({
    channelId: opts.channelId,
    invitedByUserId: opts.invitedByUserId,
    email: opts.email,
    tokenHash,
    accessLevel: "read_only",
    status: "pending",
    expiresAt,
  });
  return { invite, token };
}

function makeAcceptGetReq(token: string, channelId: string) {
  return new NextRequest(
    `http://localhost/api/invites/accept?token=${token}&channelId=${channelId}`
  );
}

function makeAcceptPostReq(body: object) {
  return new NextRequest("http://localhost/api/invites/accept", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeViewersDeleteReq(channelId: string, viewerDocId: string) {
  return new NextRequest(
    `http://localhost/api/channels/${channelId}/viewers`,
    {
      method: "DELETE",
      body: JSON.stringify({ viewerId: viewerDocId }),
      headers: { "Content-Type": "application/json" },
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("Journey: Invite viewer → validate link → accept → gain access", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("completes the full invite acceptance flow", async () => {
    // Arrange
    const parent1 = await User.create(createUserData());
    const parent2 = await User.create(createUserData());
    const channel = await Channel.create({
      users: [parent1._id, parent2._id],
      clanchaNumber: "+15590001001",
      state: "active",
    });

    const viewerEmail = "grandma@example.com";

    // Step 1: An invite is created (simulating POST /api/channels/[id]/invite)
    const { token } = await seedInvite({
      email: viewerEmail,
      channelId: channel._id.toString(),
      invitedByUserId: parent1._id.toString(),
    });

    // Step 2: Invitee opens the invite link → GET validates the token
    const { GET } = await import("@/app/api/invites/accept/route");
    const validateRes = await GET(makeAcceptGetReq(token, channel._id.toString()));
    expect(validateRes.status).toBe(200);
    const validateData = await validateRes.json();
    expect(validateData.valid).toBe(true);
    expect(validateData.email).toBe(viewerEmail);
    expect(validateData.accessLevel).toBe("read_only");
    expect(validateData.existingAccount).toBe(false);

    // Step 3: Invitee submits the form → POST accepts the invite with a
    // password + display name (SMS OTP removed Craig 2026-05-22).
    const { POST } = await import("@/app/api/invites/accept/route");
    const acceptRes = await POST(makeAcceptPostReq({
      token,
      channelId: channel._id.toString(),
      password: "GrandmaViewer2026!",
      fullName: "Grandma Brown",
    }));
    expect(acceptRes.status).toBe(200);
    const acceptData = await acceptRes.json();
    expect(acceptData.success).toBe(true);
    expect(acceptData.accessLevel).toBe("read_only");
    expect(acceptData.createdNewAccount).toBe(true);

    // JWT cookie issued for the new viewer
    const cookie = acceptRes.headers.get("set-cookie");
    expect(cookie).toContain("token=");

    // Step 4: Verify DB state
    // New viewer user created with synthetic placeholder phone
    const viewerUser = await User.findOne({ email: viewerEmail });
    expect(viewerUser).toBeTruthy();
    expect(viewerUser!.role).toBe("viewer");
    expect(viewerUser!.name).toBe("Grandma Brown");
    expect(viewerUser!.phone.startsWith("viewer:")).toBe(true);

    // ChannelViewer record is active
    const viewerRecord = await ChannelViewer.findOne({
      channelId: channel._id,
      userId: viewerUser!._id,
    });
    expect(viewerRecord).toBeTruthy();
    expect(viewerRecord!.status).toBe("active");

    // Invite is marked as accepted
    const inviteRecord = await Invite.findOne({ tokenHash: hashInviteToken(token) });
    expect(inviteRecord!.status).toBe("accepted");
    expect(inviteRecord!.acceptedByUserId!.toString()).toBe(viewerUser!._id.toString());

    // JWT payload has viewer role
    const cookieToken = cookie!.match(/token=([^;]+)/)?.[1];
    expect(cookieToken).toBeDefined();
    const jwtPayload = verifyToken(decodeURIComponent(cookieToken!));
    expect(jwtPayload!.role).toBe("viewer");
  });
});

describe("Journey: Invite → token already used → reject re-use", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("prevents the same invite token from being accepted twice", async () => {
    const parent1 = await User.create(createUserData());
    const parent2 = await User.create(createUserData());
    const channel = await Channel.create({
      users: [parent1._id, parent2._id],
      clanchaNumber: "+15590001002",
      state: "active",
    });

    const { token } = await seedInvite({
      email: "once@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: parent1._id.toString(),
    });

    const { POST } = await import("@/app/api/invites/accept/route");

    // First acceptance succeeds
    const firstRes = await POST(makeAcceptPostReq({
      token,
      channelId: channel._id.toString(),
      password: "OnceViewer2026!",
      fullName: "Once Viewer",
    }));
    expect(firstRes.status).toBe(200);

    // Second attempt with same token fails (invite is now "accepted", not "pending")
    const secondRes = await POST(makeAcceptPostReq({
      token,
      channelId: channel._id.toString(),
      password: "OnceViewer2026!",
    }));
    // Either 404 (not found as pending) or 409 (already has access)
    expect([404, 409]).toContain(secondRes.status);
  });
});

describe("Journey: Invite viewer → parent revokes access", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("revokes viewer access after acceptance", async () => {
    const parent1 = await User.create(createUserData());
    const parent2 = await User.create(createUserData());
    const channel = await Channel.create({
      users: [parent1._id, parent2._id],
      clanchaNumber: "+15590001003",
      state: "active",
    });

    const { token } = await seedInvite({
      email: "viewer@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: parent1._id.toString(),
    });

    // Viewer accepts invite with email + password (Craig 2026-05-22)
    const { POST: acceptPost } = await import("@/app/api/invites/accept/route");
    await acceptPost(makeAcceptPostReq({
      token,
      channelId: channel._id.toString(),
      password: "RevokedViewer2026!",
      fullName: "Revoked Viewer",
    }));

    const viewerUser = await User.findOne({ email: "viewer@example.com" });
    expect(viewerUser).toBeTruthy();

    // Verify viewer is active
    let viewerRecord = await ChannelViewer.findOne({
      channelId: channel._id,
      userId: viewerUser!._id,
    });
    expect(viewerRecord!.status).toBe("active");

    // Parent revokes via DELETE /api/channels/[id]/viewers
    mockRequireAuth.mockResolvedValue({
      payload: { userId: parent1._id.toString() },
    });

    const { DELETE } = await import("@/app/api/channels/[id]/viewers/route");
    const deleteReq = makeViewersDeleteReq(
      channel._id.toString(),
      viewerRecord!._id.toString()
    );
    const deleteRes = await DELETE(deleteReq, {
      params: Promise.resolve({ id: channel._id.toString() }),
    });
    expect(deleteRes.status).toBe(200);

    // Viewer record is now revoked
    viewerRecord = await ChannelViewer.findOne({
      channelId: channel._id,
      userId: viewerUser!._id,
    });
    expect(viewerRecord!.status).toBe("revoked");
  });
});

describe("Journey: Expired invite link", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("returns 410 Gone for an expired invite on GET", async () => {
    const parent1 = await User.create(createUserData());
    const parent2 = await User.create(createUserData());
    const channel = await Channel.create({
      users: [parent1._id, parent2._id],
      clanchaNumber: "+15590001004",
      state: "active",
    });

    const { token } = await seedInvite({
      email: "late@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: parent1._id.toString(),
      hoursUntilExpiry: -1, // already expired
    });

    const { GET } = await import("@/app/api/invites/accept/route");
    const getRes = await GET(makeAcceptGetReq(token, channel._id.toString()));
    expect(getRes.status).toBe(410);
  });

  it("returns 410 Gone for an expired invite on POST", async () => {
    const parent1 = await User.create(createUserData());
    const parent2 = await User.create(createUserData());
    const channel = await Channel.create({
      users: [parent1._id, parent2._id],
      clanchaNumber: "+15590001005",
      state: "active",
    });

    const { token } = await seedInvite({
      email: "late2@example.com",
      channelId: channel._id.toString(),
      invitedByUserId: parent1._id.toString(),
      hoursUntilExpiry: -1, // already expired
    });

    const { POST } = await import("@/app/api/invites/accept/route");
    const postRes = await POST(makeAcceptPostReq({
      token,
      channelId: channel._id.toString(),
      password: "LateViewer2026!",
      fullName: "Late Viewer",
    }));
    expect(postRes.status).toBe(410);
  });
});
