import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach,
} from "vitest";
import { NextRequest } from "next/server";
import mongoose from "mongoose";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User, Channel, Subscription, AuditLog } from "@/lib/db/models";
import { createUserData, createChannelData, generateStripeSubId } from "@/tests/helpers/fixtures";

vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth: mockRequireAuth }));

// Stripe SDK mock — captures the subscription.update / .retrieve calls the
// cancel/uncancel/admin routes make, so we can assert on the exact payload
// without hitting the network.
const mockSubsRetrieve = vi.fn();
const mockSubsUpdate = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      subscriptions: {
        retrieve: mockSubsRetrieve,
        update: mockSubsUpdate,
      },
    };
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────
function makePost(url: string, body?: object): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json" },
  });
}

function makePatch(url: string, body: object): NextRequest {
  return new NextRequest(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function callCancel() {
  const { POST } = await import("@/app/api/subscription/cancel/route");
  return POST(makePost("http://localhost/api/subscription/cancel"));
}

async function callUncancel(body?: object) {
  const { POST } = await import("@/app/api/subscription/uncancel/route");
  return POST(makePost("http://localhost/api/subscription/uncancel", body));
}

async function callAdminPatch(channelId: string, body: object) {
  const { PATCH } = await import("@/app/api/admin/channels/[id]/route");
  return PATCH(makePatch(`http://localhost/api/admin/channels/${channelId}`, body), {
    params: Promise.resolve({ id: channelId }),
  });
}

function authAs(userId: string, role: "user" | "super_admin" = "user") {
  mockRequireAuth.mockResolvedValue({
    response: null,
    payload: { userId, phone: "+447700900000", role },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/subscription/uncancel", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); });

  it("clears cancel_at_period_end on Stripe + local Subscription when pending", async () => {
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), activeStripeSubscriptionId: subId });
    const sub = await Subscription.create({
      userId: user._id, channelId: null, stripeSubscriptionId: subId,
      plan: "core", status: "active", currentPeriodEnd: new Date(Date.now() + 86400000),
      cancelAtPeriodEnd: true,
    });

    authAs(user._id.toString());
    mockSubsRetrieve.mockResolvedValueOnce({ id: subId, cancel_at_period_end: true });
    mockSubsUpdate.mockResolvedValueOnce({ id: subId, cancel_at_period_end: false });

    const res = await callUncancel();
    expect(res.status).toBe(200);

    expect(mockSubsUpdate).toHaveBeenCalledWith(subId, { cancel_at_period_end: false });

    const updated = await Subscription.findById(sub._id).lean();
    expect(updated?.cancelAtPeriodEnd).toBe(false);
  });

  it("refuses 400 when the subscription is not pending cancellation", async () => {
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), activeStripeSubscriptionId: subId });
    authAs(user._id.toString());
    mockSubsRetrieve.mockResolvedValueOnce({ id: subId, cancel_at_period_end: false });

    const res = await callUncancel();
    expect(res.status).toBe(400);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
  });

  it("refuses 400 when the user has no active subscription on file", async () => {
    const user = await User.create(createUserData());
    authAs(user._id.toString());

    const res = await callUncancel();
    expect(res.status).toBe(400);
    expect(mockSubsRetrieve).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/subscription/cancel", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); });

  it("sets cancel_at_period_end=true and leaves channel state alone", async () => {
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), activeStripeSubscriptionId: subId });
    const otherUser = await User.create(createUserData());
    const channel = await Channel.create(
      createChannelData({
        users: [user._id as mongoose.Types.ObjectId, otherUser._id as mongoose.Types.ObjectId],
        state: "active",
      })
    );
    const sub = await Subscription.create({
      userId: user._id, channelId: channel._id, stripeSubscriptionId: subId,
      plan: "core", status: "active", currentPeriodEnd: new Date(Date.now() + 86400000),
      cancelAtPeriodEnd: false,
    });

    authAs(user._id.toString());
    mockSubsUpdate.mockResolvedValueOnce({ id: subId, cancel_at_period_end: true });

    const res = await callCancel();
    expect(res.status).toBe(200);
    expect(mockSubsUpdate).toHaveBeenCalledWith(subId, { cancel_at_period_end: true });

    // Channel must remain Active until period end — webhook flips later.
    const ch = await Channel.findById(channel._id).lean();
    expect(ch?.state).toBe("active");

    // Local Subscription doc reflects the pending state.
    const updated = await Subscription.findById(sub._id).lean();
    expect(updated?.cancelAtPeriodEnd).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /api/admin/channels/[id] — cancel/uncancel/reactivate", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); });

  beforeEach(() => {
    // Most admin tests run as super_admin
    authAs(new mongoose.Types.ObjectId().toString(), "super_admin");
  });

  it("action=cancel flips cancel_at_period_end on each member's Stripe sub", async () => {
    const subA = generateStripeSubId();
    const subB = generateStripeSubId();
    const userA = await User.create({ ...createUserData(), activeStripeSubscriptionId: subA });
    const userB = await User.create({ ...createUserData(), activeStripeSubscriptionId: subB });
    const channel = await Channel.create(
      createChannelData({
        users: [userA._id as mongoose.Types.ObjectId, userB._id as mongoose.Types.ObjectId],
        state: "active",
      })
    );
    await Subscription.create([
      { userId: userA._id, channelId: channel._id, stripeSubscriptionId: subA, plan: "core", status: "active", currentPeriodEnd: new Date(Date.now() + 86400000), cancelAtPeriodEnd: false },
      { userId: userB._id, channelId: channel._id, stripeSubscriptionId: subB, plan: "core", status: "active", currentPeriodEnd: new Date(Date.now() + 86400000), cancelAtPeriodEnd: false },
    ]);

    mockSubsRetrieve.mockImplementation((id: string) =>
      Promise.resolve({ id, cancel_at_period_end: false })
    );
    mockSubsUpdate.mockImplementation((id: string) =>
      Promise.resolve({ id, cancel_at_period_end: true })
    );

    const res = await callAdminPatch(channel._id.toString(), { action: "cancel" });
    expect(res.status).toBe(200);

    expect(mockSubsUpdate).toHaveBeenCalledWith(subA, { cancel_at_period_end: true });
    expect(mockSubsUpdate).toHaveBeenCalledWith(subB, { cancel_at_period_end: true });

    // Channel state untouched — webhook will flip at period end.
    const ch = await Channel.findById(channel._id).lean();
    expect(ch?.state).toBe("active");

    // Both local sub docs mirror the flag.
    const subs = await Subscription.find({ channelId: channel._id }).lean();
    expect(subs.every((s) => s.cancelAtPeriodEnd === true)).toBe(true);

    const audit = await AuditLog.findOne({ channelId: channel._id, action: "channel_admin_cancel" }).lean();
    expect(audit).not.toBeNull();
  });

  it("action=uncancel clears the flag and audit-logs the admin override", async () => {
    const subId = generateStripeSubId();
    const userA = await User.create({ ...createUserData(), activeStripeSubscriptionId: subId });
    const userB = await User.create(createUserData());
    const channel = await Channel.create(
      createChannelData({
        users: [userA._id as mongoose.Types.ObjectId, userB._id as mongoose.Types.ObjectId],
        state: "active",
      })
    );
    await Subscription.create({
      userId: userA._id, channelId: channel._id, stripeSubscriptionId: subId,
      plan: "core", status: "active", currentPeriodEnd: new Date(Date.now() + 86400000),
      cancelAtPeriodEnd: true,
    });

    mockSubsRetrieve.mockResolvedValue({ id: subId, cancel_at_period_end: true });
    mockSubsUpdate.mockResolvedValue({ id: subId, cancel_at_period_end: false });

    const res = await callAdminPatch(channel._id.toString(), { action: "uncancel" });
    expect(res.status).toBe(200);
    expect(mockSubsUpdate).toHaveBeenCalledWith(subId, { cancel_at_period_end: false });

    const sub = await Subscription.findOne({ stripeSubscriptionId: subId }).lean();
    expect(sub?.cancelAtPeriodEnd).toBe(false);

    const audit = await AuditLog.findOne({ channelId: channel._id, action: "channel_admin_uncancel" }).lean();
    expect(audit).not.toBeNull();
  });

  it("action=reactivate from view_only is REFUSED 409 when no member has an active sub (billing-leak guard)", async () => {
    // Channel ended up in view_only because the sub got deleted at period end.
    // Both members now have activeStripeSubscriptionId cleared. An admin
    // reactivate must NOT silently make the channel sendable without
    // restarting billing.
    const userA = await User.create(createUserData());
    const userB = await User.create(createUserData());
    const channel = await Channel.create(
      createChannelData({
        users: [userA._id as mongoose.Types.ObjectId, userB._id as mongoose.Types.ObjectId],
        state: "view_only",
      })
    );

    const res = await callAdminPatch(channel._id.toString(), {
      state: "active",
      action: "reactivate",
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/restart.*portal/i);

    // Channel state must remain view_only — no silent flip.
    const ch = await Channel.findById(channel._id).lean();
    expect(ch?.state).toBe("view_only");
  });

  it("action=reactivate from view_only is ALLOWED when at least one member has an active sub", async () => {
    // Scenario: admin had previously toggled the channel to view_only via
    // some operational override (e.g. suspend), but billing is still live.
    // Reactivate should work in that case.
    const userA = await User.create({
      ...createUserData(),
      activeStripeSubscriptionId: generateStripeSubId(),
    });
    const userB = await User.create(createUserData());
    const channel = await Channel.create(
      createChannelData({
        users: [userA._id as mongoose.Types.ObjectId, userB._id as mongoose.Types.ObjectId],
        state: "view_only",
      })
    );

    const res = await callAdminPatch(channel._id.toString(), {
      state: "active",
      action: "reactivate",
    });
    expect(res.status).toBe(200);
    const ch = await Channel.findById(channel._id).lean();
    expect(ch?.state).toBe("active");
  });

});
