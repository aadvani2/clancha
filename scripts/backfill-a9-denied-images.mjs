#!/usr/bin/env node
/**
 * Backfill A9 ("picture wasn't shared") system-message rows for denied
 * images that don't already have one in the channel's message timeline.
 *
 * Background: `moderatorImageReview.ts` started storing A9 via
 * `storeSystemMessage` after the M3/M4 push. Images denied BEFORE that code
 * landed (e.g. Craig's 8 Apr image on CD Test Channel — flagged as item #29)
 * have an Image row in state "denied" but no matching A9 Message in the
 * portal history, so the portal looks like nothing happened.
 *
 * This script:
 *   1. Finds every Image with state: "denied".
 *   2. For each, checks the channel's Message history for an A9-shaped
 *      system row (`isSystem: true`, body contains "wasn't shared as it may
 *      breach Clancha's terms") created within 2 minutes either side of
 *      the image's `expiresAt` (set to denial time + 30 days). If absent,
 *      inserts one backdated to the image's `updatedAt` so it lands on the
 *      correct day in the timeline.
 *   3. Reports counts of skipped vs backfilled.
 *
 * Idempotent — re-running will skip any row that already has its A9.
 *
 * Usage:
 *   node scripts/backfill-a9-denied-images.mjs
 *   DRY_RUN=1 node scripts/backfill-a9-denied-images.mjs    # report only
 */

import "dotenv/config";
import mongoose from "mongoose";

const DRY_RUN = process.env.DRY_RUN === "1";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set in env");
  process.exit(1);
}

const A9_BODY = "Clancha – Your picture wasn't shared as it may breach Clancha's terms.";

await mongoose.connect(MONGODB_URI);
console.log(`Connected to ${mongoose.connection.name}`);

const Image = mongoose.connection.db.collection("images");
const Message = mongoose.connection.db.collection("messages");

const denied = await Image.find({ state: "denied" }).toArray();
console.log(`Found ${denied.length} denied image(s).`);

let backfilled = 0;
let skipped = 0;
for (const img of denied) {
  const ts = img.updatedAt ?? img.createdAt ?? new Date();
  // Look for an existing A9-shaped row within a wide window so we don't
  // double up; we don't have a deterministic linkage between the Image and
  // the Message except by channel + time + body.
  const lower = new Date(ts.getTime() - 5 * 60_000);
  const upper = new Date(ts.getTime() + 5 * 60_000);
  const existing = await Message.findOne({
    channelId: img.channelId,
    isSystem: true,
    rewrittenText: { $regex: /wasn['’]t shared as it may breach Clancha/i },
    createdAt: { $gte: lower, $lte: upper },
  });
  if (existing) {
    skipped += 1;
    continue;
  }

  if (DRY_RUN) {
    console.log(`  WOULD insert A9 for image ${img._id} on channel ${img.channelId} at ${ts.toISOString()}`);
    backfilled += 1;
    continue;
  }

  await Message.insertOne({
    channelId: img.channelId,
    senderId: null,
    originalText: A9_BODY,
    rewrittenText: A9_BODY,
    state: "delivered",
    isSystem: true,
    isEmergency: false,
    deliveredAt: ts,
    createdAt: ts,
    updatedAt: ts,
  });
  console.log(`  Inserted A9 for image ${img._id} on channel ${img.channelId}`);
  backfilled += 1;
}

console.log("\nSummary:");
console.log(`  Denied images: ${denied.length}`);
console.log(`  Already had A9: ${skipped}`);
console.log(`  Backfilled${DRY_RUN ? " (dry run)" : ""}: ${backfilled}`);

await mongoose.disconnect();
