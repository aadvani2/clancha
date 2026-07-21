/**
 * Repair (user, clanchaNumber) duplicates introduced by the 2026-05-20 seed
 * for M4 #19b. The seed hardcoded +447463626503 for both Trial State Sample
 * and Closed State Sample channels, which gave Jessica + John Due multiple
 * channels through the same number — ambiguous inbound routing.
 *
 * Strategy: pick a different pool number for each duplicate channel, so each
 * (user, clanchaNumber) pair is unique. Falls back to leaving the channel
 * alone if no other UK pool number is available.
 *
 * This script is targeted — it only touches the two channels I seeded.
 * Pre-existing dupes (e.g. the "+ 447000000002" test user with 6 channels)
 * are left alone; flag those to a human.
 */
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
console.log(`Connected to ${db.databaseName}\n`);

const targetChannels = await db.collection("channels").find({
  name: { $in: ["Trial State Sample", "Closed State Sample"] },
}).toArray();

if (targetChannels.length === 0) {
  console.log("No target channels found — nothing to repair.");
  await mongoose.disconnect();
  process.exit(0);
}

const pool = await db.collection("phonenumbers").find({ isActive: true }).toArray();
const ukPoolNumbers = pool
  .map((p) => p.number)
  .filter((n) => typeof n === "string" && n.startsWith("+44"));
console.log(`UK pool numbers available: ${ukPoolNumbers.join(", ")}\n`);

for (const ch of targetChannels) {
  console.log(`\n━━━ ${ch.name} (${ch._id}) ━━━`);
  console.log(`  current clanchaNumber: ${ch.clanchaNumber}`);

  // Pull other channels for each user on this channel.
  const userNumbers = await db.collection("channels").find(
    { users: { $in: ch.users }, _id: { $ne: ch._id } },
    { projection: { users: 1, clanchaNumber: 1 } }
  ).toArray();

  // Build a per-user set of numbers already in use.
  const usedPerUser = new Map();
  for (const c of userNumbers) {
    for (const uid of c.users) {
      const k = uid.toString();
      if (!usedPerUser.has(k)) usedPerUser.set(k, new Set());
      usedPerUser.get(k).add(c.clanchaNumber);
    }
  }

  // Find a UK number that NONE of this channel's users are already on.
  const candidate = ukPoolNumbers.find((num) =>
    ch.users.every((uid) => !(usedPerUser.get(uid.toString())?.has(num)))
  );

  if (!candidate) {
    console.log(`  ✗ No free UK number for this user pair. Skipping.`);
    continue;
  }
  if (candidate === ch.clanchaNumber) {
    console.log(`  ✓ Already on a non-conflicting number. Skipping.`);
    continue;
  }

  await db.collection("channels").updateOne(
    { _id: ch._id },
    { $set: { clanchaNumber: candidate, updatedAt: new Date() } }
  );
  console.log(`  ✓ Reassigned to ${candidate}.`);
}

// Final verification: any remaining dupes?
console.log("\n━━━ Verification ━━━");
const dupes = await db.collection("channels").aggregate([
  { $unwind: "$users" },
  { $group: { _id: { user: "$users", number: "$clanchaNumber" }, n: { $sum: 1 } } },
  { $match: { n: { $gte: 2 } } },
]).toArray();
console.log(`Remaining (user, clanchaNumber) duplicates: ${dupes.length}`);
for (const d of dupes) {
  const u = await db.collection("users").findOne({ _id: d._id.user }, { projection: { name: 1, email: 1 } });
  console.log(`  ${u?.name || "(no name)"}  ${u?.email || "—"}  ${d._id.number}  count=${d.n}`);
}

await mongoose.disconnect();
console.log("\nDone.");
