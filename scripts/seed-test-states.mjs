/**
 * Data provisioning for M4 tracker items #19b, #47, #51.
 *
 * Idempotent. Re-running leaves the DB untouched if everything's already
 * in the right state.
 *
 * What this does:
 *   #19b — seed a channel in `trial` state and one in `closed` state, using
 *          existing users. Active and view_only are already represented in
 *          the prod data. Sample channels visible from the filter dropdown.
 *
 *   #47 — add two linked children to one of the existing test-named
 *         channels so the Linked Children block in admin renders populated.
 *
 *   #51 — reassign the "Family" channel from the US pool number
 *         (+13526682094) to a UK number so all currently-active channels
 *         route via UK numbers. The US row stays inactive in the pool.
 *
 * What this does NOT do (per Craig's instruction):
 *   - Create new test user accounts.
 *   - Create new ChannelViewer rows (needs a fresh viewer user).
 *   - Send any SMS.
 */
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
console.log(`Connected to ${db.databaseName}\n`);

// ───── helpers ────────────────────────────────────────────────────────────
function logStep(label) {
  console.log(`\n━━━ ${label} ━━━`);
}

async function findUserByEmail(email) {
  return db.collection("users").findOne({ email });
}

// ───── 1) Reassign Family channel (#51) ───────────────────────────────────
logStep("M4 #51 — reassign Family channel from US to UK number");
const familyChannel = await db.collection("channels").findOne({ name: "Family", clanchaNumber: "+13526682094" });
if (!familyChannel) {
  console.log("  ✓ No Family channel still using +13526682094 — nothing to do.");
} else {
  // Pick the most-used UK number for consistency with the rest of the channels.
  const ukNumber = "+447463626503";
  await db.collection("channels").updateOne(
    { _id: familyChannel._id },
    { $set: { clanchaNumber: ukNumber, updatedAt: new Date() } }
  );
  console.log(`  ✓ Family channel ${familyChannel._id} reassigned to ${ukNumber}.`);

  // Detach the US pool row's channel link so it's clearly orphaned.
  await db.collection("phonenumbers").updateOne(
    { number: "+13526682094" },
    { $set: { channelId: null, isActive: false, updatedAt: new Date() } }
  );
  console.log("  ✓ US pool row (+13526682094) detached + marked inactive.");
}

// ───── 2) Add linked children (#47) ───────────────────────────────────────
logStep("M4 #47 — add linked children to a test channel");
const targetChannel = await db.collection("channels").findOne({
  name: { $in: ["Test Family Channel", "CD Test Channel", "Tom Test Channel"] },
});
if (!targetChannel) {
  console.log("  ✗ No test-named channel found to attach children to. Skipping.");
} else if ((targetChannel.linkedChildren || []).length > 0) {
  console.log(`  ✓ "${targetChannel.name}" already has ${targetChannel.linkedChildren.length} child(ren). Skipping.`);
} else {
  const children = [
    { name: "Arthur Test", dob: "2018-05-20" },
    { name: "Lily Test", dob: "2021-03-15" },
  ];
  await db.collection("channels").updateOne(
    { _id: targetChannel._id },
    { $set: { linkedChildren: children, updatedAt: new Date() } }
  );
  console.log(`  ✓ Added 2 children to "${targetChannel.name}".`);
}

// ───── 3) Seed Trial + Closed channels (#19b) ─────────────────────────────
logStep("M4 #19b — seed trial + closed sample channels");

// Pick two existing dev/test users to use as channel members. We deliberately
// avoid real-seeming names + Craig + Anas himself.
const userA = await findUserByEmail("johndue@gmail.com");
const userB = await findUserByEmail("jessica@gmail.com");

/**
 * Mirror lib/services/numberPool.reserveNumber but at the raw driver level
 * (no mongoose model session). Returns a UK pool number that NEITHER user
 * already uses on another channel — enforcing the (user, clanchaNumber)
 * uniqueness invariant the production allocator preserves.
 */
async function pickFreePoolNumber(usersOnChannel) {
  const pool = await db.collection("phonenumbers").find({ isActive: true }).toArray();
  const candidates = pool.map((p) => p.number).filter((n) => typeof n === "string");
  for (const num of candidates) {
    const conflicts = await db.collection("channels").countDocuments({
      users: { $in: usersOnChannel },
      clanchaNumber: num,
    });
    if (conflicts === 0) return num;
  }
  return null;
}

if (!userA || !userB) {
  console.log("  ✗ Couldn't resolve johndue + jessica test users. Skipping. (Manually pair two users if needed.)");
} else {
  // Default to the most-used UK number for ease, but pickFreePoolNumber will
  // override per-channel if the default would create a (user, number) clash.
  const ukNumber = "+447463626503";

  // Trial channel
  const existingTrial = await db.collection("channels").findOne({ name: "Trial State Sample" });
  if (existingTrial) {
    if (existingTrial.state !== "trial") {
      await db.collection("channels").updateOne(
        { _id: existingTrial._id },
        { $set: { state: "trial", updatedAt: new Date() } }
      );
      console.log("  ✓ Trial State Sample channel state reset to `trial`.");
    } else {
      console.log("  ✓ Trial State Sample channel already exists in `trial` state.");
    }
  } else {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const reserved = (await pickFreePoolNumber([userA._id, userB._id])) ?? ukNumber;
    const ch = await db.collection("channels").insertOne({
      users: [userA._id, userB._id],
      clanchaNumber: reserved,
      name: "Trial State Sample",
      state: "trial",
      pictureShareEnabled: false,
      emergencyBypassEnabled: true,
      linkedChildren: [{ name: "Demo Child", dob: "2019-09-01" }],
      createdAt: now,
      updatedAt: now,
    });
    // Bare-minimum trialing subscription so the channel renders fully in admin.
    await db.collection("subscriptions").insertOne({
      userId: userA._id,
      channelId: ch.insertedId,
      stripeSubscriptionId: null,
      plan: "core",
      status: "trialing",
      currentPeriodEnd: trialEnd,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  ✓ Created Trial State Sample channel ${ch.insertedId}.`);
  }

  // Closed channel
  const existingClosed = await db.collection("channels").findOne({ name: "Closed State Sample" });
  if (existingClosed) {
    if (existingClosed.state !== "closed") {
      await db.collection("channels").updateOne(
        { _id: existingClosed._id },
        { $set: { state: "closed", updatedAt: new Date() } }
      );
      console.log("  ✓ Closed State Sample channel state reset to `closed`.");
    } else {
      console.log("  ✓ Closed State Sample channel already exists in `closed` state.");
    }
  } else {
    const now = new Date();
    const sub = await db.collection("subscriptions").insertOne({
      userId: userA._id,
      channelId: null,
      stripeSubscriptionId: null,
      plan: "core",
      status: "canceled",
      currentPeriodEnd: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const reserved = (await pickFreePoolNumber([userA._id, userB._id])) ?? ukNumber;
    const ch = await db.collection("channels").insertOne({
      users: [userA._id, userB._id],
      clanchaNumber: reserved,
      name: "Closed State Sample",
      state: "closed",
      pictureShareEnabled: false,
      emergencyBypassEnabled: true,
      subscriptionId: sub.insertedId,
      linkedChildren: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("subscriptions").updateOne(
      { _id: sub.insertedId },
      { $set: { channelId: ch.insertedId } }
    );
    console.log(`  ✓ Created Closed State Sample channel ${ch.insertedId}.`);
  }
}

// ───── Verification summary ───────────────────────────────────────────────
logStep("Final state");
const stateCounts = await db.collection("channels").aggregate([
  { $group: { _id: "$state", n: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray();
console.log("  Channels by state:");
for (const r of stateCounts) console.log(`    ${String(r._id).padEnd(12)} ${r.n}`);
const stillUS = await db.collection("channels").countDocuments({ clanchaNumber: "+13526682094" });
console.log(`  Channels still on US number: ${stillUS}`);
const channelsWithKids = await db.collection("channels").countDocuments({ "linkedChildren.0": { $exists: true } });
console.log(`  Channels with linked children: ${channelsWithKids}`);

await mongoose.disconnect();
console.log("\nDone.");
