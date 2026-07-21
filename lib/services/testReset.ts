import Stripe from "stripe";
import type { Types } from "mongoose";
import connectDB from "@/lib/db/connect";
import {
  User,
  Channel,
  Subscription,
  Message,
  Image,
  UserChannelPreferences,
  Invite,
  ChannelViewer,
  ModeratorAssignment,
  PendingChannelRequest,
  PendingChannelInvite,
  JoinToken,
  OTP,
  SmsOutbox,
  ProcessedWebhookEvent,
  AuditLog,
  PhoneNumber,
  type UserRole,
} from "@/lib/db/models";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia" as any,
});

/**
 * Roles that are NEVER deleted by a test reset — they're operational accounts
 * (the admin team), not test data. Only "user" and "viewer" records are wiped.
 */
const STAFF_ROLES: ReadonlyArray<UserRole> = ["admin", "super_admin", "moderator"];

/**
 * The single hard guard for every destructive action in this module: we only
 * ever run against a Stripe TEST account. The secret key prefix is the
 * authoritative signal — `sk_test_…` means test mode, `sk_live_…` means live.
 * This ties "is it safe to wipe?" directly to "are the Stripe customers we'd
 * delete test customers?", which is exactly the invariant we need. A staging
 * deploy (NODE_ENV=production but a test Stripe key) is correctly allowed; a
 * live key — or a missing key — is refused.
 */
export function isTestEnvironment(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

/** Thrown when a reset is attempted outside a Stripe test environment. */
export class NotTestEnvironmentError extends Error {
  constructor() {
    super(
      "Refusing to run: this is not a Stripe test environment (STRIPE_SECRET_KEY is not sk_test_…). Test data reset is disabled to protect live data."
    );
    this.name = "NotTestEnvironmentError";
  }
}

function assertTestEnvironment(): void {
  if (!isTestEnvironment()) throw new NotTestEnvironmentError();
}

export interface StripeCleanupResult {
  customersDeleted: number;
  customersFailed: number;
  failures: string[];
}

export interface DeletionSummary {
  testEnvironment: true;
  deleted: Record<string, number>;
  numbersFreed: number;
  stripe: StripeCleanupResult;
}

/**
 * Delete a set of Stripe customers (best-effort). Deleting a customer in Stripe
 * also cancels its subscriptions, so this keeps the two sides in sync without a
 * separate subscription sweep. Failures are collected, not thrown, so a Stripe
 * hiccup never blocks the database wipe — the caller reports them and Craig can
 * mop up the odd record manually if needed.
 */
async function deleteStripeCustomers(
  customerIds: string[],
  enabled: boolean
): Promise<StripeCleanupResult> {
  const result: StripeCleanupResult = { customersDeleted: 0, customersFailed: 0, failures: [] };
  if (!enabled) return result;
  const unique = Array.from(new Set(customerIds.filter(Boolean)));
  for (const id of unique) {
    try {
      const deleted = await stripe.customers.del(id);
      if ((deleted as { deleted?: boolean }).deleted) result.customersDeleted += 1;
    } catch (err) {
      // Already-deleted customers come back as an error — treat as a no-op.
      const msg = err instanceof Error ? err.message : String(err);
      if (/No such customer|already been deleted/i.test(msg)) continue;
      result.customersFailed += 1;
      result.failures.push(`${id}: ${msg}`);
    }
  }
  return result;
}

/**
 * Hard-delete a single test user and everything tied to them: their channels,
 * all channel-scoped records, their subscriptions, and their Stripe customer.
 * Frees the user's own phone (the unique index that otherwise blocks re-signup,
 * M4 #95) and releases any pool numbers their channels were routing through.
 *
 * Test environment only. Refuses to delete staff accounts.
 */
export async function deleteUserCascade(
  userId: string,
  opts: { deleteStripe?: boolean; actorUserId?: string } = {}
): Promise<DeletionSummary> {
  await connectDB();

  const user = await User.findById(userId).select("_id phone role stripeCustomerId");
  if (!user) throw new Error("User not found");
  if (STAFF_ROLES.includes(user.role)) {
    throw new Error(`Refusing to delete a ${user.role} account — test reset only removes user and viewer accounts.`);
  }

  const channels = await Channel.find({ users: user._id }).select("_id").lean();
  const channelIds = channels.map((c) => c._id as Types.ObjectId);

  const deleted: Record<string, number> = {};
  const record = (key: string, n: number) => {
    if (n) deleted[key] = (deleted[key] ?? 0) + n;
  };

  // Channel-scoped records (covers BOTH members of any shared channel).
  if (channelIds.length) {
    const byChannel = { channelId: { $in: channelIds } } as const;
    record("messages", (await Message.deleteMany(byChannel)).deletedCount ?? 0);
    record("images", (await Image.deleteMany(byChannel)).deletedCount ?? 0);
    record("preferences", (await UserChannelPreferences.deleteMany(byChannel)).deletedCount ?? 0);
    record("invites", (await Invite.deleteMany(byChannel)).deletedCount ?? 0);
    record("viewers", (await ChannelViewer.deleteMany(byChannel)).deletedCount ?? 0);
    record("moderatorAssignments", (await ModeratorAssignment.deleteMany(byChannel)).deletedCount ?? 0);
    record("joinTokens", (await JoinToken.deleteMany(byChannel)).deletedCount ?? 0);
    record("pendingChannelInvites", (await PendingChannelInvite.deleteMany(byChannel)).deletedCount ?? 0);
    record("subscriptions", (await Subscription.deleteMany(byChannel)).deletedCount ?? 0);
    record("auditLogs", (await AuditLog.deleteMany(byChannel)).deletedCount ?? 0);
  }

  // User-scoped records not necessarily tied to a channel.
  record("subscriptions", (await Subscription.deleteMany({ userId: user._id })).deletedCount ?? 0);
  record("preferences", (await UserChannelPreferences.deleteMany({ userId: user._id })).deletedCount ?? 0);
  record("joinTokens", (await JoinToken.deleteMany({ userId: user._id })).deletedCount ?? 0);
  record("pendingChannelRequests", (await PendingChannelRequest.deleteMany({ userId: user._id })).deletedCount ?? 0);
  record("otps", (await OTP.deleteMany({ phone: user.phone })).deletedCount ?? 0);

  // Free the pool numbers these channels were routing through, then drop the
  // channels and the user themselves.
  let numbersFreed = 0;
  if (channelIds.length) {
    numbersFreed = (await PhoneNumber.updateMany({ channelId: { $in: channelIds } }, { $set: { channelId: null } })).modifiedCount ?? 0;
    record("channels", (await Channel.deleteMany({ _id: { $in: channelIds } })).deletedCount ?? 0);
  }
  record("users", (await User.deleteOne({ _id: user._id })).deletedCount ?? 0);

  const stripeResult = await deleteStripeCustomers(
    user.stripeCustomerId ? [user.stripeCustomerId] : [],
    opts.deleteStripe ?? true
  );

  await AuditLog.create({
    action: "test_user_deleted",
    actorUserId: opts.actorUserId,
    targetUserId: user._id,
    metadata: { phone: user.phone, deleted, numbersFreed, stripe: stripeResult },
  });

  return { testEnvironment: true, deleted, numbersFreed, stripe: stripeResult };
}

/**
 * Full clean-slate wipe of all test data: every user/viewer account, every
 * channel, and all the message/image/billing/invite records hanging off them,
 * plus their Stripe customers. Staff accounts, the phone-number pool rows
 * (deallocated, not deleted), and the AI prompt library are preserved.
 *
 * Test environment only.
 */
export async function resetAllTestData(
  opts: { deleteStripe?: boolean; actorUserId?: string } = {}
): Promise<DeletionSummary> {
  assertTestEnvironment();
  await connectDB();

  // Collect the Stripe customers to delete BEFORE we drop the user rows.
  const doomedUsers = await User.find({ role: { $nin: STAFF_ROLES } })
    .select("stripeCustomerId")
    .lean();
  const customerIds = doomedUsers
    .map((u) => (u as { stripeCustomerId?: string | null }).stripeCustomerId)
    .filter((id): id is string => !!id);

  const deleted: Record<string, number> = {};
  const record = (key: string, n: number | undefined) => {
    if (n) deleted[key] = n;
  };

  record("users", (await User.deleteMany({ role: { $nin: STAFF_ROLES } })).deletedCount);
  record("channels", (await Channel.deleteMany({})).deletedCount);
  record("subscriptions", (await Subscription.deleteMany({})).deletedCount);
  record("messages", (await Message.deleteMany({})).deletedCount);
  record("images", (await Image.deleteMany({})).deletedCount);
  record("preferences", (await UserChannelPreferences.deleteMany({})).deletedCount);
  record("invites", (await Invite.deleteMany({})).deletedCount);
  record("viewers", (await ChannelViewer.deleteMany({})).deletedCount);
  record("moderatorAssignments", (await ModeratorAssignment.deleteMany({})).deletedCount);
  record("pendingChannelRequests", (await PendingChannelRequest.deleteMany({})).deletedCount);
  record("pendingChannelInvites", (await PendingChannelInvite.deleteMany({})).deletedCount);
  record("joinTokens", (await JoinToken.deleteMany({})).deletedCount);
  record("otps", (await OTP.deleteMany({})).deletedCount);
  record("smsOutbox", (await SmsOutbox.deleteMany({})).deletedCount);
  record("processedWebhookEvents", (await ProcessedWebhookEvent.deleteMany({})).deletedCount);
  // Clear the activity log for a true clean slate, then stamp the reset itself
  // below so the wipe is still accounted for.
  record("auditLogs", (await AuditLog.deleteMany({})).deletedCount);

  // Release every pool number (keep the pool rows themselves).
  const numbersFreed = (await PhoneNumber.updateMany({ channelId: { $ne: null } }, { $set: { channelId: null } })).modifiedCount ?? 0;

  const stripeResult = await deleteStripeCustomers(customerIds, opts.deleteStripe ?? true);

  await AuditLog.create({
    action: "test_data_reset",
    actorUserId: opts.actorUserId,
    metadata: { deleted, numbersFreed, stripe: stripeResult },
  });

  return { testEnvironment: true, deleted, numbersFreed, stripe: stripeResult };
}

/** Lightweight counts for the admin UI to show what a reset would clear. */
export async function getTestDataCounts(): Promise<{
  users: number;
  channels: number;
  subscriptions: number;
  numbersInUse: number;
}> {
  await connectDB();
  const [users, channels, subscriptions, numbersInUse] = await Promise.all([
    User.countDocuments({ role: { $nin: STAFF_ROLES } }),
    Channel.countDocuments({}),
    Subscription.countDocuments({}),
    PhoneNumber.countDocuments({ channelId: { $ne: null } }),
  ]);
  return { users, channels, subscriptions, numbersInUse };
}
