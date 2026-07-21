#!/usr/bin/env node
/**
 * Clear stale stripeCustomerId / activeStripeSubscriptionId on User records
 * that point at IDs which no longer exist in the configured Stripe account.
 *
 * Background: on 2026-05-22 we swapped staging from a dev test Stripe
 * account to Craig's GBP test account. Existing users still have IDs from
 * the old account on their User row; any call to
 * `stripe.{customers,subscriptions}.retrieve(id)` returns `resource_missing`
 * and bubbles up as "Failed to create channel" in the UI.
 *
 * This script:
 *   1. Walks every User with a stripeCustomerId or activeStripeSubscriptionId.
 *   2. Verifies each ID against the currently-configured Stripe account.
 *   3. Unsets any ID that returns `resource_missing`, so the next time the
 *      user creates a channel the app falls through to Stripe Checkout
 *      signup mode (mode: subscription) and a fresh customer is created in
 *      the new account.
 *
 * Idempotent. Dry-run with DRY_RUN=1.
 *
 * Usage:
 *   node scripts/clear-stale-stripe-refs.mjs
 *   DRY_RUN=1 node scripts/clear-stale-stripe-refs.mjs
 */

import "dotenv/config";
import mongoose from "mongoose";
import Stripe from "stripe";

const DRY_RUN = process.env.DRY_RUN === "1";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set");
  process.exit(1);
}
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error("STRIPE_SECRET_KEY is not set");
  process.exit(1);
}

const stripe = new Stripe(stripeKey, { apiVersion: "2025-01-27.acacia" });

await mongoose.connect(MONGODB_URI);
console.log(`Connected to ${mongoose.connection.name}`);

const Users = mongoose.connection.db.collection("users");

const candidates = await Users.find({
  $or: [
    { stripeCustomerId: { $type: "string", $ne: null } },
    { activeStripeSubscriptionId: { $type: "string", $ne: null } },
  ],
}).toArray();

console.log(`Found ${candidates.length} user(s) with stored Stripe IDs.`);

let cleared = 0;
let kept = 0;

for (const u of candidates) {
  const updates = {};
  const reasons = [];

  if (u.stripeCustomerId) {
    try {
      const c = await stripe.customers.retrieve(u.stripeCustomerId);
      if (c && c.deleted) {
        updates.stripeCustomerId = null;
        updates.activeStripeSubscriptionId = null;
        reasons.push(`customer ${u.stripeCustomerId} is marked deleted in Stripe`);
      }
    } catch (err) {
      const code = err?.code || err?.rawType;
      if (code === "resource_missing" || err?.statusCode === 404) {
        updates.stripeCustomerId = null;
        updates.activeStripeSubscriptionId = null;
        reasons.push(`customer ${u.stripeCustomerId} not in current Stripe account`);
      } else {
        console.warn(`  ! ${u.email || u._id}: unexpected error retrieving customer:`, err.message);
      }
    }
  }

  if (u.activeStripeSubscriptionId && !("activeStripeSubscriptionId" in updates)) {
    try {
      await stripe.subscriptions.retrieve(u.activeStripeSubscriptionId);
    } catch (err) {
      const code = err?.code || err?.rawType;
      if (code === "resource_missing" || err?.statusCode === 404) {
        updates.activeStripeSubscriptionId = null;
        reasons.push(`subscription ${u.activeStripeSubscriptionId} not in current Stripe account`);
      } else {
        console.warn(`  ! ${u.email || u._id}: unexpected error retrieving subscription:`, err.message);
      }
    }
  }

  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) {
    kept += 1;
    continue;
  }

  console.log(`  ${DRY_RUN ? "WOULD clear" : "Clearing"} ${updateKeys.join(", ")} for ${u.email || u._id}: ${reasons.join("; ")}`);
  if (!DRY_RUN) {
    await Users.updateOne({ _id: u._id }, { $set: updates });
  }
  cleared += 1;
}

console.log("\nSummary:");
console.log(`  Users inspected: ${candidates.length}`);
console.log(`  Valid (kept): ${kept}`);
console.log(`  Cleared${DRY_RUN ? " (dry run)" : ""}: ${cleared}`);

await mongoose.disconnect();
