import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import mongoose from "mongoose";
import {
  setupReplicaDatabase, teardownReplicaDatabase, clearReplicaDatabase,
} from "@/tests/helpers/db-replica";
import { User, Channel, Subscription, PhoneNumber, PendingChannelRequest } from "@/lib/db/models";
import {
  createUserData, generateStripeSubId, generateStripeCustomerId, generatePhone,
} from "@/tests/helpers/fixtures";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

// Mock requireAuth to inject any userId we want per test
const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth: mockRequireAuth }));

// Mock getStripeSubscriptionPeriodEnd – return a date 30 days from now
const futureDate = new Date(Date.now() + 86400000 * 30);
vi.mock("@/lib/services/billing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/services/billing")>();
  return {
    ...real,
    getStripeSubscriptionPeriodEnd: vi.fn().mockResolvedValue(futureDate),
    updateSubscriptionForNewChannel: vi.fn().mockResolvedValue(undefined),
    getOpenInvoiceForSubscription: vi.fn().mockResolvedValue(null),
  };
});

// Mock the Stripe SDK so /api/channels' upfront customer/sub validation
// (added 2026-05-22 to clear stale IDs after the Stripe-account swap) sees
// healthy IDs in this test environment. Customers.retrieve returns a fake
// non-deleted customer with a default PM so the route walks the happy
// "existing sub" branch, and Subscriptions.retrieve returns a fake active
// sub for period-end lookups.
vi.mock("stripe", () => {
  class StripeMock {
    customers = {
      retrieve: vi.fn().mockResolvedValue({
        id: "cus_fake",
        deleted: false,
        invoice_settings: { default_payment_method: "pm_fake_card" },
      }),
      create: vi.fn().mockResolvedValue({ id: "cus_fake_new" }),
    };
    subscriptions = {
      retrieve: vi.fn().mockResolvedValue({
        id: "sub_fake",
        status: "active",
        items: { data: [] },
        current_period_end: Math.floor((Date.now() + 86400000 * 30) / 1000),
      }),
    };
    checkout = {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: "cs_test_fake",
          url: "https://checkout.stripe.com/c/pay/cs_test_fake",
        }),
      },
    };
  }
  return { default: StripeMock };
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function makePostRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/channels", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function callPost(body: object) {
  const { POST } = await import("@/app/api/channels/route");
  return POST(makePostRequest(body));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/channels – first channel (0 existing channels)", () => {
  beforeAll(async () => { await setupReplicaDatabase(); });
  afterAll(async () => { await teardownReplicaDatabase(); });
  afterEach(async () => { await clearReplicaDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("creates first channel and links to orphaned subscription doc", async () => {
    const subId = generateStripeSubId();
    const customerId = generateStripeCustomerId();
    const user = await User.create({
      ...createUserData(),
      stripeCustomerId: customerId,
      activeStripeSubscriptionId: subId,
      isPictureAddonEnabled: false,
    });
    // Orphaned subscription doc (created by webhook after payment)
    const orphanedSub = await Subscription.create({
      userId: user._id,
      channelId: null,
      stripeSubscriptionId: subId,
      plan: "core",
      status: "active",
      currentPeriodEnd: futureDate,
    });

    await PhoneNumber.create({ number: "+15551000001", isActive: true });

    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const contactPhone = generatePhone();
    const res = await callPost({ otherUserPhone: contactPhone });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.state).toBe("active");
    expect(data.pictureShareEnabled).toBe(false);

    // Channel created
    const channel = await Channel.findById(data.id).lean();
    expect(channel).toBeTruthy();
    expect(channel!.state).toBe("active");

    // Orphaned subscription doc linked to new channel
    const subDoc = await Subscription.findById(orphanedSub._id).lean();
    expect(subDoc!.channelId!.toString()).toBe(data.id);

    // No duplicate subscription docs
    const allSubDocs = await Subscription.find({ userId: user._id });
    expect(allSubDocs).toHaveLength(1);
  });

  it("creates first channel with picture sharing when explicitly requested", async () => {
    // Per spec Doc 3 §5, picture sharing is per-channel — not auto-enabled
    // from a user-level flag. The body must carry pictureShareEnabled: true.
    const subId = generateStripeSubId();
    const user = await User.create({
      ...createUserData(),
      stripeCustomerId: generateStripeCustomerId(),
      activeStripeSubscriptionId: subId,
      isPictureAddonEnabled: false,
    });
    await Subscription.create({
      userId: user._id, channelId: null, stripeSubscriptionId: subId,
      plan: "picture_addon", status: "active", currentPeriodEnd: futureDate,
    });
    await PhoneNumber.create({ number: "+15551000002", isActive: true });

    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({
      otherUserPhone: generatePhone(),
      pictureShareEnabled: true,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pictureShareEnabled).toBe(true);
  });

  it("falls back to creating a new subscription doc if no orphaned doc exists", async () => {
    const subId = generateStripeSubId();
    const user = await User.create({
      ...createUserData(),
      stripeCustomerId: generateStripeCustomerId(),
      activeStripeSubscriptionId: subId,
      isPictureAddonEnabled: false,
    });
    // No orphaned subscription doc (e.g. user navigated directly without webhook)
    await PhoneNumber.create({ number: "+15551000003", isActive: true });

    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ otherUserPhone: generatePhone() });
    expect(res.status).toBe(200);
    const data = await res.json();

    const subDocs = await Subscription.find({ userId: user._id });
    expect(subDocs).toHaveLength(1);
    expect(subDocs[0].channelId!.toString()).toBe(data.id);
  });

  it("redirects to Stripe Checkout when user has no active subscription", async () => {
    // Behaviour changed 2026-05-22 (Craig M4 tracker #68): instead of
    // 402-blocking a user with no Stripe state, /api/channels POST now mints
    // a fresh Stripe Checkout subscription session, carries the channel
    // payload in a PendingChannelRequest, and returns a redirectUrl. The
    // modal handles redirectUrl with a full-page navigation.
    const user = await User.create(createUserData()); // no stripeCustomerId
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({
      otherUserPhone: generatePhone(),
      recipientName: "Test Recipient",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.redirectUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(data.reason).toBe("no_subscription_yet");

    // A pending request carries the channel data for the webhook to
    // materialise once invoice.paid fires.
    const pendings = await PendingChannelRequest.find({ userId: user._id }).lean();
    expect(pendings).toHaveLength(1);
    expect(pendings[0].recipientName).toBe("Test Recipient");
  });

  it("returns 400 when creating a channel with yourself", async () => {
    const subId = generateStripeSubId();
    const user = await User.create({
      ...createUserData({ phone: "+15550000099" }),
      stripeCustomerId: generateStripeCustomerId(),
      activeStripeSubscriptionId: subId,
    });
    await PhoneNumber.create({ number: "+15551000004", isActive: true });

    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ otherUserPhone: user.phone });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/yourself/i);
  });

  it("returns 400 when channel already exists with that contact", async () => {
    const subId = generateStripeSubId();
    const contactPhone = "+15550000077";
    const user = await User.create({
      ...createUserData(),
      stripeCustomerId: generateStripeCustomerId(),
      activeStripeSubscriptionId: subId,
    });
    const contact = await User.create({ ...createUserData(), phone: contactPhone });
    await Channel.create({
      users: [user._id, contact._id],
      clanchaNumber: "+15551000005",
      state: "active",
    });

    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ otherUserPhone: contactPhone });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/already exists/i);
  });

  it("returns 503 when no phone numbers are available in the pool", async () => {
    const subId = generateStripeSubId();
    const user = await User.create({
      ...createUserData(),
      stripeCustomerId: generateStripeCustomerId(),
      activeStripeSubscriptionId: subId,
    });
    // No PhoneNumber documents

    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ otherUserPhone: generatePhone() });
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/channels – subsequent channels (1+ existing channels)", () => {
  beforeAll(async () => { await setupReplicaDatabase(); });
  afterAll(async () => { await teardownReplicaDatabase(); });
  afterEach(async () => { await clearReplicaDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("creates a pending request and calls updateSubscriptionForNewChannel", async () => {
    const subId = generateStripeSubId();
    const user = await User.create({
      ...createUserData(),
      stripeCustomerId: generateStripeCustomerId(),
      activeStripeSubscriptionId: subId,
    });
    const other1 = await User.create(createUserData());

    // User already has 1 active channel
    await Channel.create({
      users: [user._id, other1._id],
      clanchaNumber: "+15552000001",
      state: "active",
    });

    await PhoneNumber.create({ number: "+15551000010", isActive: true });
    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ otherUserPhone: generatePhone(), pictureShareEnabled: false });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pending).toBe(true);
    expect(data.message).toBeTruthy();

    // Pending channel request created
    const pending = await PendingChannelRequest.find({ userId: user._id });
    expect(pending).toHaveLength(1);

    // updateSubscriptionForNewChannel was called
    const { updateSubscriptionForNewChannel } = await import("@/lib/services/billing");
    expect(updateSubscriptionForNewChannel).toHaveBeenCalledWith(
      user._id.toString(),
      false
    );
  });

  it("cleans up pending request if updateSubscriptionForNewChannel throws", async () => {
    const subId = generateStripeSubId();
    const user = await User.create({
      ...createUserData(),
      stripeCustomerId: generateStripeCustomerId(),
      activeStripeSubscriptionId: subId,
    });
    const other1 = await User.create(createUserData());
    await Channel.create({
      users: [user._id, other1._id],
      clanchaNumber: "+15552000002",
      state: "active",
    });

    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const { updateSubscriptionForNewChannel } = await import("@/lib/services/billing");
    (updateSubscriptionForNewChannel as any).mockRejectedValueOnce(
      new Error("No active subscription found.")
    );

    const res = await callPost({ otherUserPhone: generatePhone() });
    expect(res.status).toBe(402);

    // Pending request cleaned up
    const pending = await PendingChannelRequest.find({ userId: user._id });
    expect(pending).toHaveLength(0);
  });

  it("returns 400 when user already has 5 active channels", async () => {
    const subId = generateStripeSubId();
    const user = await User.create({
      ...createUserData(),
      stripeCustomerId: generateStripeCustomerId(),
      activeStripeSubscriptionId: subId,
    });

    // Create 5 active channels
    for (let i = 0; i < 5; i++) {
      const other = await User.create(createUserData());
      await Channel.create({
        users: [user._id, other._id],
        clanchaNumber: `+1555300000${i}`,
        state: "active",
      });
    }

    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const res = await callPost({ otherUserPhone: generatePhone() });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/maximum/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/channels", () => {
  beforeAll(async () => { await setupReplicaDatabase(); });
  afterAll(async () => { await teardownReplicaDatabase(); });
  afterEach(async () => { await clearReplicaDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("returns all non-closed channels for the authenticated user", async () => {
    const user = await User.create(createUserData());
    const other1 = await User.create(createUserData());
    const other2 = await User.create(createUserData());
    const other3 = await User.create(createUserData());

    await Channel.create({ users: [user._id, other1._id], clanchaNumber: "+15554000001", state: "active" });
    await Channel.create({ users: [user._id, other2._id], clanchaNumber: "+15554000002", state: "view_only" });
    await Channel.create({ users: [user._id, other3._id], clanchaNumber: "+15554000003", state: "closed" }); // excluded

    mockRequireAuth.mockResolvedValue({ payload: { userId: user._id.toString() } });

    const { GET } = await import("@/app/api/channels/route");
    const req = new NextRequest("http://localhost/api/channels");
    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.channels).toHaveLength(2);
    expect(data.channels.map((c: any) => c.state)).toEqual(
      expect.arrayContaining(["active", "view_only"])
    );
  });
});
