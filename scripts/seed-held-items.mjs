/**
 * Data provisioning for M4 tracker item #42 — seed held moderator items so
 * Craig can exercise the moderator Pending Review UI including the
 * "Rewrite unavailable" banner that fires when the rewriter cannot produce
 * a safe softening of the message.
 *
 * Seeds three messages onto an existing test channel:
 *   1. Rewrite unavailable — classification `unsafe`, rewrittenText mirrors
 *      originalText. Triggers the destructive "Unable to produce acceptable
 *      rewrite" banner; Approve is server-side blocked, Deny is recommended.
 *   2. Uncertain — classification `uncertain`, has a usable AI rewrite.
 *      Exercises Approve / Deny / Request rewrite retry.
 *   3. Uncertain (second) — same shape as 2, different content, so the queue
 *      has more than one item to demonstrate ordering.
 *
 * Idempotent. Re-running detects the SEED_TAG in moderatorNotes and skips.
 * Run with DRY_RUN=1 to preview without writing.
 *
 *   node scripts/seed-held-items.mjs
 *   DRY_RUN=1 node scripts/seed-held-items.mjs
 */
import "dotenv/config";
import mongoose from "mongoose";

const SEED_TAG = "[SEED-HELD-#42]";
const DRY_RUN = process.env.DRY_RUN === "1";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
console.log(`Connected to ${db.databaseName}${DRY_RUN ? " (DRY RUN)" : ""}\n`);

function logStep(label) {
  console.log(`\n━━━ ${label} ━━━`);
}

// ───── Find a target channel + sender ─────────────────────────────────────
logStep("Locate target channel");

// Prefer test-named channels so we never seed onto a real conversation.
const candidateNames = [
  "Test Family Channel",
  "CD Test Channel",
  "Tom Test Channel",
  "Trial State Sample",
];
const channel = await db.collection("channels").findOne({
  name: { $in: candidateNames },
  state: { $in: ["trial", "active"] },
  users: { $exists: true, $not: { $size: 0 } },
});

if (!channel) {
  console.error("  ✗ No test-named active channel found. Run seed-test-states.mjs first or pass a channel manually.");
  await mongoose.disconnect();
  process.exit(1);
}

const senderId = channel.users[0];
const sender = await db.collection("users").findOne({ _id: senderId });
console.log(`  ✓ Target channel: "${channel.name}" (${channel._id}), state=${channel.state}`);
console.log(`  ✓ Sender: ${sender?.name ?? "(unknown)"} <${sender?.email ?? sender?.phone ?? "?"}>`);

// ───── Skip if already seeded ─────────────────────────────────────────────
logStep("Check for existing seed");

const existing = await db.collection("messages").countDocuments({
  channelId: channel._id,
  state: "held",
  moderatorNotes: SEED_TAG,
});
if (existing > 0) {
  console.log(`  ✓ ${existing} seed message(s) already present and held. Nothing to do.`);
  console.log(`    To re-seed, first clear with:`);
  console.log(`      db.messages.deleteMany({ moderatorNotes: "${SEED_TAG}" })`);
  await mongoose.disconnect();
  process.exit(0);
}
console.log("  ✓ No prior seed found. Proceeding.");

// ───── Define the three held messages ─────────────────────────────────────
logStep("Build held messages");

const now = new Date();
// Stagger createdAt by a minute so the queue's "oldest-first" ordering
// puts the rewrite-unavailable item at the top — Craig sees the banner
// immediately on the Pending Review page.
const t = (offsetMin) => new Date(now.getTime() - (5 - offsetMin) * 60 * 1000);

const items = [
  {
    label: "Rewrite unavailable (unsafe, no safe rewrite)",
    originalText:
      "Don't bother bringing him this weekend, you'll just ruin it like you always do. I'm done with your shit.",
    rewrittenText:
      "Don't bother bringing him this weekend, you'll just ruin it like you always do. I'm done with your shit.",
    classification: "unsafe",
    violationTags: ["harassment", "personal_attack"],
    createdAt: t(0),
  },
  {
    label: "Uncertain — held with workable rewrite (mixed dismissal)",
    originalText:
      "Fuck off and bring the bag tomorrow, he needs his school stuff.",
    rewrittenText:
      "Please bring the bag tomorrow, he needs his school stuff.",
    classification: "uncertain",
    violationTags: ["profanity"],
    createdAt: t(2),
  },
  {
    label: "Uncertain — held with workable rewrite (escalation)",
    originalText:
      "You are being completely unreasonable about pickup again. We agreed 5pm.",
    rewrittenText:
      "I'd like to keep to the 5pm pickup we agreed. Can we confirm that?",
    classification: "uncertain",
    violationTags: [],
    createdAt: t(4),
  },
];

for (const i of items) {
  console.log(`  • ${i.label}`);
  console.log(`      original:  "${i.originalText.slice(0, 70)}${i.originalText.length > 70 ? "…" : ""}"`);
  console.log(`      rewritten: "${i.rewrittenText.slice(0, 70)}${i.rewrittenText.length > 70 ? "…" : ""}"`);
  console.log(`      classification=${i.classification}, tags=[${i.violationTags.join(", ")}]`);
}

// ───── Insert ─────────────────────────────────────────────────────────────
logStep(DRY_RUN ? "Would insert (DRY_RUN=1)" : "Insert held messages");

if (DRY_RUN) {
  console.log(`  ✓ Skipped insert. ${items.length} message(s) would be created.`);
} else {
  const docs = items.map((i) => ({
    channelId: channel._id,
    senderId,
    originalText: i.originalText,
    rewrittenText: i.rewrittenText,
    state: "held",
    isEmergency: false,
    isSystem: false,
    classification: i.classification,
    violationTags: i.violationTags,
    moderatorNotes: SEED_TAG,
    deliveredAt: null,
    createdAt: i.createdAt,
    updatedAt: i.createdAt,
  }));
  const result = await db.collection("messages").insertMany(docs);
  console.log(`  ✓ Inserted ${result.insertedCount} held messages.`);
}

// ───── Done ───────────────────────────────────────────────────────────────
logStep("Done");
console.log(`  Open /pending-review in the moderator portal to verify:`);
console.log(`    1. "Rewrite unavailable" banner shows on the unsafe item.`);
console.log(`    2. Approve is disabled on that item; Deny is recommended.`);
console.log(`    3. Approve / Deny / Request rewrite retry work on the other items.`);

await mongoose.disconnect();
