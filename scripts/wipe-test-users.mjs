#!/usr/bin/env node
/**
 * Wipe everything tied to a specific list of test phone numbers so we can
 * re-run signup → channel-create → message flows from scratch on staging.
 *
 * Safe scoping: only touches users matched by the TARGET_PHONES list +
 * the channels those users are members of. Never touches users outside
 * that set (e.g. Craig's account, the +447000000002 system placeholder,
 * other testers).
 *
 * For each matched user, cascade-deletes (in order):
 *   - Messages on any channel they're a member of
 *   - Images on any channel they're a member of
 *   - ChannelViewer rows tied to those channels
 *   - Invite rows tied to those channels
 *   - UserChannelPreferences for those channels
 *   - PendingChannelRequest rows owned by this user
 *   - Subscription docs for those channels
 *   - Channels themselves
 *   - The user
 *   - Frees the channels' clanchaNumbers back to the pool (sets channelId=null)
 *
 * Usage:
 *   DRY_RUN=1 node scripts/wipe-test-users.mjs    # report only
 *   node scripts/wipe-test-users.mjs              # actually delete
 *
 * Edit TARGET_PHONES below to change the list.
 */

import "dotenv/config";
import mongoose from "mongoose";

const TARGET_PHONES = [
  "+447476626433",
  "+447988518553",
];

const DRY_RUN = process.env.DRY_RUN === "1";

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set");
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
console.log(`Connected to ${mongoose.connection.name}`);
console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "DESTRUCTIVE (writes)"}`);

const Users = mongoose.connection.db.collection("users");
const Channels = mongoose.connection.db.collection("channels");
const Messages = mongoose.connection.db.collection("messages");
const Images = mongoose.connection.db.collection("images");
const ChannelViewers = mongoose.connection.db.collection("channelviewers");
const Invites = mongoose.connection.db.collection("invites");
const UCP = mongoose.connection.db.collection("userchannelpreferences");
const PCR = mongoose.connection.db.collection("pendingchannelrequests");
const Subscriptions = mongoose.connection.db.collection("subscriptions");
const PhoneNumbers = mongoose.connection.db.collection("phonenumbers");
const AuditLogs = mongoose.connection.db.collection("auditlogs");

// ── Resolve users ──────────────────────────────────────────────────────
const users = await Users.find({ phone: { $in: TARGET_PHONES } }).toArray();
if (users.length === 0) {
  console.log("\nNo users matched the target phones. Nothing to do.");
  await mongoose.disconnect();
  process.exit(0);
}
console.log(`\nFound ${users.length} target user(s):`);
for (const u of users) {
  console.log(`  - ${u.email || "(no email)"}  ${u.phone}  role=${u.role}  _id=${u._id}`);
}
const userIds = users.map((u) => u._id);

// ── Channels these users are members of ────────────────────────────────
const channels = await Channels.find({ users: { $in: userIds } }).toArray();
console.log(`\nFound ${channels.length} channel(s) involving these users:`);
for (const c of channels) {
  console.log(`  - ${c.name ?? "(unnamed)"}  ${c.clanchaNumber}  state=${c.state}  _id=${c._id}`);
}
const channelIds = channels.map((c) => c._id);

// ── Counts for visibility ──────────────────────────────────────────────
const msgCount = await Messages.countDocuments({ channelId: { $in: channelIds } });
const imgCount = await Images.countDocuments({ channelId: { $in: channelIds } });
const viewerCount = await ChannelViewers.countDocuments({ channelId: { $in: channelIds } });
const inviteCount = await Invites.countDocuments({ channelId: { $in: channelIds } });
const ucpCount = await UCP.countDocuments({
  $or: [{ channelId: { $in: channelIds } }, { userId: { $in: userIds } }],
});
const pcrCount = await PCR.countDocuments({ userId: { $in: userIds } });
const subCount = await Subscriptions.countDocuments({
  $or: [{ channelId: { $in: channelIds } }, { userId: { $in: userIds } }],
});

console.log("\nCascade will affect:");
console.log(`  Messages:                  ${msgCount}`);
console.log(`  Images:                    ${imgCount}`);
console.log(`  ChannelViewers:            ${viewerCount}`);
console.log(`  Invites:                   ${inviteCount}`);
console.log(`  UserChannelPreferences:    ${ucpCount}`);
console.log(`  PendingChannelRequests:    ${pcrCount}`);
console.log(`  Subscriptions:             ${subCount}`);
console.log(`  Channels:                  ${channels.length}`);
console.log(`  Users:                     ${users.length}`);

if (DRY_RUN) {
  console.log("\nDRY RUN — no writes performed. Re-run without DRY_RUN=1 to apply.");
  await mongoose.disconnect();
  process.exit(0);
}

// ── Destructive section ─────────────────────────────────────────────────
console.log("\nApplying deletes…");

const r1 = await Messages.deleteMany({ channelId: { $in: channelIds } });
console.log(`  Messages:                  ${r1.deletedCount} deleted`);

const r2 = await Images.deleteMany({ channelId: { $in: channelIds } });
console.log(`  Images:                    ${r2.deletedCount} deleted`);

const r3 = await ChannelViewers.deleteMany({ channelId: { $in: channelIds } });
console.log(`  ChannelViewers:            ${r3.deletedCount} deleted`);

const r4 = await Invites.deleteMany({ channelId: { $in: channelIds } });
console.log(`  Invites:                   ${r4.deletedCount} deleted`);

const r5 = await UCP.deleteMany({
  $or: [{ channelId: { $in: channelIds } }, { userId: { $in: userIds } }],
});
console.log(`  UserChannelPreferences:    ${r5.deletedCount} deleted`);

const r6 = await PCR.deleteMany({ userId: { $in: userIds } });
console.log(`  PendingChannelRequests:    ${r6.deletedCount} deleted`);

const r7 = await Subscriptions.deleteMany({
  $or: [{ channelId: { $in: channelIds } }, { userId: { $in: userIds } }],
});
console.log(`  Subscriptions:             ${r7.deletedCount} deleted`);

// Free clanchaNumbers back to pool BEFORE deleting channels (we need the
// channelId reference on the PhoneNumber row).
const r8 = await PhoneNumbers.updateMany(
  { channelId: { $in: channelIds } },
  { $set: { channelId: null } }
);
console.log(`  PhoneNumbers freed:        ${r8.modifiedCount}`);

const r9 = await Channels.deleteMany({ _id: { $in: channelIds } });
console.log(`  Channels:                  ${r9.deletedCount} deleted`);

const r10 = await Users.deleteMany({ _id: { $in: userIds } });
console.log(`  Users:                     ${r10.deletedCount} deleted`);

// Audit log: leave the channel-scoped entries in place so we have history,
// but write a single "test_user_wipe" event so the activity feed shows
// why a chunk of state disappeared.
await AuditLogs.insertOne({
  action: "test_data_wipe",
  metadata: {
    targetPhones: TARGET_PHONES,
    deletedUserIds: userIds.map((id) => id.toString()),
    deletedChannelIds: channelIds.map((id) => id.toString()),
    counts: {
      messages: r1.deletedCount,
      images: r2.deletedCount,
      channelViewers: r3.deletedCount,
      invites: r4.deletedCount,
      userChannelPreferences: r5.deletedCount,
      pendingChannelRequests: r6.deletedCount,
      subscriptions: r7.deletedCount,
      phoneNumbersFreed: r8.modifiedCount,
      channels: r9.deletedCount,
      users: r10.deletedCount,
    },
  },
  createdAt: new Date(),
  updatedAt: new Date(),
});

console.log("\nDone. The pool numbers are back as available for re-use.");

await mongoose.disconnect();
