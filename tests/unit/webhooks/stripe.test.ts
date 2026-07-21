import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach,
} from "vitest";
import { NextRequest } from "next/server";
import mongoose from "mongoose";
import {
  setupReplicaDatabase, teardownReplicaDatabase, clearReplicaDatabase,
} from "@/tests/helpers/db-replica";
import { User, Channel, Subscription, PhoneNumber, PendingChannelRequest, AuditLog } from "@/lib/db/models";
import {
  createUserData, createChannelData, createSubscriptionData,
  generateStripeSubId, generateStripeCustomerId, generatePhone,
} from "@/tests/helpers/fixtures";

// ─── Stripe mock ─────────────────────────────────────────────────────────────
const mockConstructEvent = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      webhooks: { constructEvent: mockConstructEvent },
      subscriptions: { retrieve: mockSubscriptionsRetrieve },
    };
  }),
}));

// ─── connectDB mock (test DB is already connected) ───────────────────────────
vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

// ─── createFirstChannelForUser mock ──────────────────────────────────────────
// We test webhook orchestration here, not the channel-creation internals.
// createFirstChannelForUser is tested separately.
const mockCreateFirstChannelForUser = vi.fn().mockResolvedValue("fake-channel-id");
vi.mock("@/lib/services/createFirstChannelForUser", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/services/createFirstChannelForUser")>();
  return { ...real, createFirstChannelForUser: mockCreateFirstChannelForUser };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
const CORE_PRICE_ID = "price_core_test";
const ADDON_PRICE_ID = "price_addon_test";

function makeStripeSubscription(
  subId: string,
  opts: { withAddon?: boolean; quantity?: number; periodEnd?: number } = {}
) {
  const { withAddon = false, quantity = 1, periodEnd = Math.floor(Date.now() / 1000) + 86400 * 30 } = opts;
  const items: any[] = [{ price: { id: CORE_PRICE_ID }, quantity }];
  if (withAddon) items.push({ price: { id: ADDON_PRICE_ID }, quantity: 1 });
  return { id: subId, status: "active", items: { data: items }, current_period_end: periodEnd };
}

function makeInvoicePaidEvent(subId: string, customerId: string) {
  return {
    type: "invoice.paid",
    id: `evt_${Math.random().toString(36).slice(2)}`,
    data: { object: { subscription: subId, customer: customerId } },
  };
}

function makeWebhookRequest(event: object): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: JSON.stringify(event),
    headers: { "Content-Type": "application/json", "stripe-signature": "test-sig" },
  });
}

// POST handler under test – imported after mocks are set up
async function callWebhook(event: object) {
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const req = makeWebhookRequest(event);
  mockConstructEvent.mockReturnValueOnce(event);
  return POST(req);
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe("Stripe webhook – invoice.paid", () => {
  beforeAll(async () => {
    await setupReplicaDatabase();
  });

  afterAll(async () => {
    await teardownReplicaDatabase();
  });

  afterEach(async () => {
    await clearReplicaDatabase();
    vi.clearAllMocks();
    // Re-import handler fresh (clears module-level Stripe instance cache)
    vi.resetModules();
  });

  // ── Scenario 1: brand-new user, Standard plan ─────────────────────────────
  it("calls createFirstChannelForUser for a new user with no channels (Standard plan)", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), stripeCustomerId: customerId });

    mockSubscriptionsRetrieve.mockResolvedValueOnce(makeStripeSubscription(subId));
    // Default mock returns a fake channelId (success)
    mockCreateFirstChannelForUser.mockResolvedValueOnce("fake-channel-id");

    const event = makeInvoicePaidEvent(subId, customerId);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));

    expect(res.status).toBe(200);

    // createFirstChannelForUser was called with the correct userId, subId, and plan
    expect(mockCreateFirstChannelForUser).toHaveBeenCalledWith(
      user._id.toString(),
      subId,
      "core",
      expect.any(Date)
    );

    // User fields updated
    const updatedUser = await User.findById(user._id).lean();
    expect(updatedUser!.activeStripeSubscriptionId).toBe(subId);
    expect(updatedUser!.isPictureAddonEnabled).toBe(false);

    // No orphaned subscription doc (createFirstChannelForUser succeeded)
    const subDocs = await Subscription.find({ userId: user._id });
    expect(subDocs).toHaveLength(0);
  });

  // ── Scenario 1b: phone pool empty → orphaned doc fallback ─────────────────
  it("creates orphaned subscription doc when createFirstChannelForUser returns null (fallback)", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), stripeCustomerId: customerId });

    mockSubscriptionsRetrieve.mockResolvedValueOnce(makeStripeSubscription(subId));
    // Simulate phone pool empty: createFirstChannelForUser returns null
    mockCreateFirstChannelForUser.mockResolvedValueOnce(null);

    const event = makeInvoicePaidEvent(subId, customerId);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));

    expect(res.status).toBe(200);

    // Orphaned subscription doc created so checkout polling resolves
    const subDocs = await Subscription.find({ userId: user._id });
    expect(subDocs).toHaveLength(1);
    expect(subDocs[0].channelId).toBeNull();
    expect(subDocs[0].status).toBe("active");
  });

  // ── Scenario 2: brand-new user, Premium plan (with image addon) ───────────
  it("calls createFirstChannelForUser with plan=picture_addon for Premium plan", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), stripeCustomerId: customerId });

    mockSubscriptionsRetrieve.mockResolvedValueOnce(
      makeStripeSubscription(subId, { withAddon: true })
    );
    mockCreateFirstChannelForUser.mockResolvedValueOnce("fake-channel-id");

    const event = makeInvoicePaidEvent(subId, customerId);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    await POST(makeWebhookRequest(event));

    expect(mockCreateFirstChannelForUser).toHaveBeenCalledWith(
      user._id.toString(),
      subId,
      "picture_addon",
      expect.any(Date)
    );
    // Note: User.isPictureAddonEnabled is deliberately NOT set here. Per
    // Doc 3 §5, picture sharing is per-channel — the legacy user-level
    // flag was the source of the auto-on-every-subsequent-channel bug
    // (Craig M4 tracker #25). Each channel's pictureShareEnabled is the
    // source of truth, computed from its Subscription doc's `plan`.
  });

  // ── Scenario 3: repurchase – user has view_only channels ─────────────────
  it("reactivates existing view_only channels on repurchase", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), stripeCustomerId: customerId });
    const otherUser = await User.create(createUserData());

    // Existing view_only channel from a previous (now-cancelled) subscription
    const channel = await Channel.create({
      users: [user._id, otherUser._id],
      clanchaNumber: "+15550000001",
      state: "view_only",
    });

    mockSubscriptionsRetrieve.mockResolvedValueOnce(makeStripeSubscription(subId));

    const event = makeInvoicePaidEvent(subId, customerId);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));

    expect(res.status).toBe(200);

    // Channel reactivated
    const updatedChannel = await Channel.findById(channel._id).lean();
    expect(updatedChannel!.state).toBe("active");

    // New subscription doc created linking to existing channel
    const subDoc = await Subscription.findOne({ stripeSubscriptionId: subId });
    expect(subDoc).toBeTruthy();
    expect(subDoc!.channelId!.toString()).toBe(channel._id.toString());
    expect(subDoc!.status).toBe("active");
  });

  // ── Scenario 4: repurchase – user has trial channel ───────────────────────
  it("reactivates existing trial channels on first subscription purchase", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), stripeCustomerId: customerId });
    const otherUser = await User.create(createUserData());

    const channel = await Channel.create({
      users: [user._id, otherUser._id],
      clanchaNumber: "+15550000002",
      state: "trial",
    });

    mockSubscriptionsRetrieve.mockResolvedValueOnce(makeStripeSubscription(subId));

    const event = makeInvoicePaidEvent(subId, customerId);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    await POST(makeWebhookRequest(event));

    const updatedChannel = await Channel.findById(channel._id).lean();
    expect(updatedChannel!.state).toBe("active");

    const subDoc = await Subscription.findOne({ stripeSubscriptionId: subId });
    expect(subDoc!.channelId!.toString()).toBe(channel._id.toString());
  });

  // ── Scenario 5: subscription renewal (existing subscription docs) ─────────
  it("updates existing subscription docs and activates channels on renewal", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), stripeCustomerId: customerId });
    const otherUser = await User.create(createUserData());

    const channel = await Channel.create({
      users: [user._id, otherUser._id],
      clanchaNumber: "+15550000003",
      state: "active",
    });

    // Existing subscription doc from when this subscription was first created
    const oldEnd = new Date();
    oldEnd.setMonth(oldEnd.getMonth() - 1);
    await Subscription.create({
      userId: user._id,
      channelId: channel._id,
      stripeSubscriptionId: subId,
      plan: "core",
      status: "active",
      currentPeriodEnd: oldEnd,
    });

    const newPeriodEnd = Math.floor(Date.now() / 1000) + 86400 * 30;
    mockSubscriptionsRetrieve.mockResolvedValueOnce(
      makeStripeSubscription(subId, { periodEnd: newPeriodEnd })
    );

    const event = makeInvoicePaidEvent(subId, customerId);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    await POST(makeWebhookRequest(event));

    const subDoc = await Subscription.findOne({ stripeSubscriptionId: subId });
    expect(subDoc!.status).toBe("active");
    expect(subDoc!.currentPeriodEnd.getTime()).toBeCloseTo(newPeriodEnd * 1000, -3);

    const updatedChannel = await Channel.findById(channel._id).lean();
    expect(updatedChannel!.state).toBe("active");
  });

  // ── Scenario 6: renewal with past_due subscription ────────────────────────
  it("reactivates past_due subscription docs on successful renewal payment", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), stripeCustomerId: customerId });
    const otherUser = await User.create(createUserData());

    const channel = await Channel.create({
      users: [user._id, otherUser._id],
      clanchaNumber: "+15550000004",
      state: "active",
    });

    await Subscription.create({
      userId: user._id,
      channelId: channel._id,
      stripeSubscriptionId: subId,
      plan: "core",
      status: "past_due",
      currentPeriodEnd: new Date(),
    });

    mockSubscriptionsRetrieve.mockResolvedValueOnce(makeStripeSubscription(subId));

    const event = makeInvoicePaidEvent(subId, customerId);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    await POST(makeWebhookRequest(event));

    const subDoc = await Subscription.findOne({ stripeSubscriptionId: subId });
    expect(subDoc!.status).toBe("active");
  });

  // ── Scenario 7: user not found ────────────────────────────────────────────
  it("handles gracefully when no user is found for the Stripe customer ID", async () => {
    const subId = generateStripeSubId();
    mockSubscriptionsRetrieve.mockResolvedValueOnce(makeStripeSubscription(subId));

    const event = makeInvoicePaidEvent(subId, "cus_nonexistent");
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));

    expect(res.status).toBe(200);
    const subDocs = await Subscription.find({});
    expect(subDocs).toHaveLength(0);
  });

  // ── Scenario 8: subsequent channel from pending request ───────────────────
  it("creates subsequent channel from pending request when Stripe quantity > channel count", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const user = await User.create({
      ...createUserData(),
      stripeCustomerId: customerId,
      activeStripeSubscriptionId: subId,
    });
    const otherUser1 = await User.create(createUserData());
    const otherUser2 = await User.create(createUserData());

    // PhoneNumber in pool
    await PhoneNumber.create({ number: "+15559999001", isActive: true });

    // Existing active channel + subscription doc
    const channel1 = await Channel.create({
      users: [user._id, otherUser1._id],
      clanchaNumber: "+15550000005",
      state: "active",
    });
    await Subscription.create({
      userId: user._id,
      channelId: channel1._id,
      stripeSubscriptionId: subId,
      plan: "core",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
    });

    // Pending request for a 2nd channel
    const pendingPhone = generatePhone();
    await PendingChannelRequest.create({
      userId: user._id,
      otherUserPhone: pendingPhone,
      pictureShareEnabled: false,
    });

    // Stripe now has quantity=2 (user paid for 2nd channel)
    mockSubscriptionsRetrieve.mockResolvedValueOnce(
      makeStripeSubscription(subId, { quantity: 2 })
    );

    const event = makeInvoicePaidEvent(subId, customerId);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    await POST(makeWebhookRequest(event));

    // 2nd channel should now exist
    const allChannels = await Channel.find({ users: user._id }).lean();
    expect(allChannels).toHaveLength(2);

    // Pending request consumed
    const pending = await PendingChannelRequest.find({ userId: user._id });
    expect(pending).toHaveLength(0);

    // 2 subscription docs
    const subDocs = await Subscription.find({ userId: user._id });
    expect(subDocs).toHaveLength(2);
  });

  // ── Scenario 9: standalone Picture Sharing add-on (#81) ───────────────────
  it("enables the add-on from a standalone picture_addon sub WITHOUT running core materialisation (#81)", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const buyer = await User.create({ ...createUserData(), stripeCustomerId: customerId });
    const creator = await User.create(createUserData());
    const channel = await Channel.create({
      users: [creator._id, buyer._id],
      clanchaNumber: "+15550000031",
      state: "active",
      pictureShareEnabled: false,
    });

    const periodEnd = Math.floor(Date.now() / 1000) + 86400 * 30;
    mockSubscriptionsRetrieve.mockResolvedValueOnce({
      id: subId,
      status: "active",
      items: { data: [{ price: { id: ADDON_PRICE_ID }, quantity: 1 }] },
      current_period_end: periodEnd,
      cancel_at_period_end: false,
      metadata: {
        scenario: "picture_addon",
        channelId: channel._id.toString(),
        userId: buyer._id.toString(),
      },
    });

    const event = makeInvoicePaidEvent(subId, customerId);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));
    expect(res.status).toBe(200);

    // The core channel-materialisation path must NOT run for an add-on sub.
    expect(mockCreateFirstChannelForUser).not.toHaveBeenCalled();

    const ch = await Channel.findById(channel._id).lean();
    expect(ch!.pictureShareEnabled).toBe(true);
    expect(ch!.pictureAddonPurchasedBy!.toString()).toBe(buyer._id.toString());

    const subDoc = await Subscription.findOne({ stripeSubscriptionId: subId });
    expect(subDoc!.isAddon).toBe(true);
    expect(subDoc!.plan).toBe("picture_addon");
    expect(subDoc!.channelId!.toString()).toBe(channel._id.toString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Stripe webhook – invoice.payment_failed", () => {
  beforeAll(async () => { await setupReplicaDatabase(); });
  afterAll(async () => { await teardownReplicaDatabase(); });
  afterEach(async () => { await clearReplicaDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("sets subscription past_due and moves channels to view_only", async () => {
    const subId = generateStripeSubId();
    const user = await User.create(createUserData());
    const otherUser = await User.create(createUserData());
    const channel = await Channel.create({
      users: [user._id, otherUser._id],
      clanchaNumber: "+15550000010",
      state: "active",
    });
    await Subscription.create({
      userId: user._id,
      channelId: channel._id,
      stripeSubscriptionId: subId,
      plan: "core",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });

    const event = {
      type: "invoice.payment_failed",
      id: "evt_fail",
      data: { object: { subscription: subId, customer: "cus_test" } },
    };
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));

    expect(res.status).toBe(200);
    const subDoc = await Subscription.findOne({ stripeSubscriptionId: subId });
    expect(subDoc!.status).toBe("past_due");

    // Spec (milestone.txt:14): failed payments must move channels to view-only.
    const ch = await Channel.findById(channel._id).lean();
    expect(ch!.state).toBe("view_only");
  });

  it("writes channel_creation_payment_failed audit with hosted invoice URL", async () => {
    const customerId = generateStripeCustomerId();
    const subId = generateStripeSubId();
    const user = await User.create({ ...createUserData(), stripeCustomerId: customerId });
    // Pending stays — we want invoice.paid to be able to fulfil it later if
    // the user pays the open invoice with a new card.
    await PendingChannelRequest.create({ userId: user._id, otherUserPhone: "+15550001111", pictureShareEnabled: false });

    const event = {
      type: "invoice.payment_failed",
      id: "evt_fail_with_user",
      data: {
        object: {
          subscription: subId,
          customer: customerId,
          id: "in_test_fail",
          hosted_invoice_url: "https://invoice.stripe.com/i/acct_test/test_token",
        },
      },
    };
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));
    expect(res.status).toBe(200);

    // Pending must survive so a later invoice.paid can fulfil it.
    const remaining = await PendingChannelRequest.find({ userId: user._id });
    expect(remaining).toHaveLength(1);

    const audit = await AuditLog.findOne({
      action: "channel_creation_payment_failed",
      actorUserId: user._id,
    }).lean();
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toMatchObject({
      stripeSubscriptionId: subId,
      stripeInvoiceId: "in_test_fail",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_test/test_token",
    });
  });

  it("does not crash when no user matches the customerId", async () => {
    const subId = generateStripeSubId();
    const event = {
      type: "invoice.payment_failed",
      id: "evt_fail_orphan",
      data: { object: { subscription: subId, customer: "cus_no_match" } },
    };
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));
    expect(res.status).toBe(200);

    const audit = await AuditLog.findOne({ action: "channel_creation_payment_failed" }).lean();
    expect(audit).toBeNull();
  });

  it("handles missing subscription id gracefully", async () => {
    const event = {
      type: "invoice.payment_failed",
      id: "evt_fail_nosub",
      data: { object: { subscription: null, customer: "cus_test" } },
    };
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Stripe webhook – customer.subscription.deleted", () => {
  beforeAll(async () => { await setupReplicaDatabase(); });
  afterAll(async () => { await teardownReplicaDatabase(); });
  afterEach(async () => { await clearReplicaDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("cancels subscriptions and sets channels to view_only", async () => {
    const subId = generateStripeSubId();
    const user = await User.create(createUserData());
    const otherUser = await User.create(createUserData());
    const channel = await Channel.create({
      users: [user._id, otherUser._id],
      clanchaNumber: "+15550000020",
      state: "active",
    });
    await Subscription.create({
      userId: user._id,
      channelId: channel._id,
      stripeSubscriptionId: subId,
      plan: "core",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });

    const event = {
      type: "customer.subscription.deleted",
      id: "evt_del",
      data: { object: { id: subId } },
    };
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));

    expect(res.status).toBe(200);

    const subDoc = await Subscription.findOne({ stripeSubscriptionId: subId });
    expect(subDoc!.status).toBe("canceled");

    const ch = await Channel.findById(channel._id).lean();
    expect(ch!.state).toBe("view_only");
  });

  it("cancels multiple channels on subscription deletion", async () => {
    const subId = generateStripeSubId();
    const user = await User.create(createUserData());
    const other1 = await User.create(createUserData());
    const other2 = await User.create(createUserData());

    const ch1 = await Channel.create({
      users: [user._id, other1._id], clanchaNumber: "+15550000021", state: "active",
    });
    const ch2 = await Channel.create({
      users: [user._id, other2._id], clanchaNumber: "+15550000022", state: "active",
    });

    await Subscription.create([
      { userId: user._id, channelId: ch1._id, stripeSubscriptionId: subId, plan: "core", status: "active", currentPeriodEnd: new Date(Date.now() + 86400000) },
      { userId: user._id, channelId: ch2._id, stripeSubscriptionId: subId, plan: "core", status: "active", currentPeriodEnd: new Date(Date.now() + 86400000) },
    ]);

    const event = {
      type: "customer.subscription.deleted",
      id: "evt_del2",
      data: { object: { id: subId } },
    };
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    await POST(makeWebhookRequest(event));

    const channels = await Channel.find({ _id: { $in: [ch1._id, ch2._id] } }).lean();
    expect(channels.every((c) => c.state === "view_only")).toBe(true);

    const subDocs = await Subscription.find({ stripeSubscriptionId: subId });
    expect(subDocs.every((s) => s.status === "canceled")).toBe(true);
  });

  it("switches the add-on OFF (channel stays active, NOT view_only) when a picture_addon sub is deleted (#82)", async () => {
    const subId = generateStripeSubId();
    const buyer = await User.create(createUserData());
    const creator = await User.create(createUserData());
    const channel = await Channel.create({
      users: [creator._id, buyer._id],
      clanchaNumber: "+15550000030",
      state: "active",
      pictureShareEnabled: true,
      pictureAddonPurchasedBy: buyer._id,
    });
    await Subscription.create({
      userId: buyer._id,
      channelId: channel._id,
      stripeSubscriptionId: subId,
      plan: "picture_addon",
      status: "active",
      isAddon: true,
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });

    const event = {
      type: "customer.subscription.deleted",
      id: "evt_del_addon",
      data: {
        object: {
          id: subId,
          metadata: {
            scenario: "picture_addon",
            channelId: channel._id.toString(),
            userId: buyer._id.toString(),
          },
        },
      },
    };
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));
    expect(res.status).toBe(200);

    const ch = await Channel.findById(channel._id).lean();
    // The core sub is untouched — channel must NOT drop to view_only.
    expect(ch!.state).toBe("active");
    expect(ch!.pictureShareEnabled).toBe(false);
    expect(ch!.pictureAddonPurchasedBy ?? null).toBeNull();

    const subDoc = await Subscription.findOne({ stripeSubscriptionId: subId });
    expect(subDoc!.status).toBe("canceled");
  });

  it("ignores orphaned subscription docs (channelId null) on deletion", async () => {
    const subId = generateStripeSubId();
    const user = await User.create(createUserData());
    await Subscription.create({
      userId: user._id,
      channelId: null,
      stripeSubscriptionId: subId,
      plan: "core",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });

    const event = {
      type: "customer.subscription.deleted",
      id: "evt_del_orphan",
      data: { object: { id: subId } },
    };
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));

    expect(res.status).toBe(200);
    const subDoc = await Subscription.findOne({ stripeSubscriptionId: subId });
    expect(subDoc!.status).toBe("canceled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Stripe webhook – signature verification", () => {
  beforeAll(async () => { await setupReplicaDatabase(); });
  afterAll(async () => { await teardownReplicaDatabase(); });
  afterEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 400 when stripe-signature header is missing", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const req = new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when signature verification fails", async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const req = makeWebhookRequest({ type: "invoice.paid" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 for unhandled event types", async () => {
    const event = { type: "charge.captured", id: "evt_unhandled", data: { object: {} } };
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    mockConstructEvent.mockReturnValueOnce(event);
    const res = await POST(makeWebhookRequest(event));
    expect(res.status).toBe(200);
  });
});
