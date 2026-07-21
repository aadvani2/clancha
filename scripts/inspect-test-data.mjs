/**
 * Snapshot of current state of the staging DB before provisioning runs.
 * Helps decide what to seed vs leave alone.
 */
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const users = await db.collection("users").find({}).project({ name: 1, email: 1, phone: 1, role: 1 }).toArray();
const channels = await db.collection("channels").find({}).project({ name: 1, state: 1, pictureShareEnabled: 1, users: 1, children: 1, clanchaNumber: 1 }).toArray();
const subs = await db.collection("subscriptions").find({}).project({ plan: 1, status: 1, channelId: 1, currentPeriodEnd: 1 }).toArray();
const viewers = await db.collection("channelviewers").find({}).project({ channelId: 1, userId: 1, status: 1, visibility: 1 }).toArray();
const pool = await db.collection("phonenumbers").find({}).toArray();

console.log("USERS (" + users.length + "):");
for (const u of users) console.log("  " + (u.role || "user").padEnd(20) + " " + (u.name || "(no name)").padEnd(22) + " " + (u.email || "—").padEnd(34) + " " + (u.phone || "—"));

console.log("\nCHANNELS (" + channels.length + "):");
for (const c of channels) {
  const childCount = (c.children || []).length;
  console.log("  " + String(c.state || "?").padEnd(12) + " pic=" + String(!!c.pictureShareEnabled).padEnd(5) + " kids=" + String(childCount).padEnd(2) + " users=" + String((c.users||[]).length).padEnd(2) + " " + (c.clanchaNumber || "—").padEnd(16) + "  " + (c.name || "(unnamed)"));
}

console.log("\nSUBSCRIPTIONS (" + subs.length + "):");
const planStateCount = {};
for (const s of subs) {
  const k = (s.plan || "?") + "/" + (s.status || "?");
  planStateCount[k] = (planStateCount[k] || 0) + 1;
}
for (const [k, n] of Object.entries(planStateCount)) console.log("  " + k.padEnd(28) + " " + n);

console.log("\nVIEWERS (" + viewers.length + "):");
for (const v of viewers) console.log("  status=" + (v.status || "?").padEnd(10) + " visibility=" + (v.visibility || "—"));

console.log("\nPHONE POOL (" + pool.length + "):");
for (const p of pool) console.log("  " + p.number + "  active=" + p.isActive + "  channelId=" + p.channelId);

await mongoose.disconnect();
