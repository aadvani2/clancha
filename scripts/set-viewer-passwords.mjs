#!/usr/bin/env node
/**
 * Set passwords for existing viewer accounts.
 *
 * Background: viewer auth used SMS OTP through 2026-05-21. Craig 2026-05-22:
 * viewers now authenticate with email + password. Existing test viewers in
 * the DB have no password set, which would lock them out (the new
 * /api/invites/accept rejects accounts without a stored hash).
 *
 * This script:
 *   1. Finds all User docs with role: "viewer".
 *   2. For any without a password, sets a known migration password
 *      (CLANCHA_VIEWER_PASSWORD env var, default "ClanchaViewer2026!")
 *      so we can communicate it to Craig and the testers.
 *   3. If a viewer's `phone` field is a real phone (not the new viewer:hash
 *      placeholder), it's left alone so the data shape is preserved — the
 *      phone field just stops being load-bearing for auth.
 *
 * Idempotent: re-running won't overwrite passwords that are already set.
 *
 * Usage:
 *   node scripts/set-viewer-passwords.mjs              # default password
 *   CLANCHA_VIEWER_PASSWORD=Custom123 node scripts/set-viewer-passwords.mjs
 *   DRY_RUN=1 node scripts/set-viewer-passwords.mjs    # report only
 */

import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const DEFAULT_PASSWORD = "ClanchaViewer2026!";
const password = process.env.CLANCHA_VIEWER_PASSWORD || DEFAULT_PASSWORD;
const DRY_RUN = process.env.DRY_RUN === "1";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set in env");
  process.exit(1);
}

const userSchema = new mongoose.Schema(
  {
    phone: String,
    email: String,
    password: { type: String, select: false },
    role: String,
    name: String,
  },
  { strict: false, timestamps: true }
);
const User = mongoose.models.User || mongoose.model("User", userSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected. Looking for viewer accounts…");

  const viewers = await User.find({ role: "viewer" })
    .select("+password email name phone role")
    .lean();
  console.log(`Found ${viewers.length} viewer accounts.`);

  let updated = 0;
  let alreadySet = 0;
  for (const v of viewers) {
    if (v.password) {
      alreadySet += 1;
      console.log(`  - ${v.email}: password already set, skipping`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  - ${v.email}: WOULD set password (dry run)`);
      continue;
    }
    const hash = await bcrypt.hash(password, 12);
    await User.updateOne({ _id: v._id }, { $set: { password: hash } });
    updated += 1;
    console.log(`  - ${v.email}: password set`);
  }

  console.log("\nSummary:");
  console.log(`  Viewers found: ${viewers.length}`);
  console.log(`  Already had password: ${alreadySet}`);
  console.log(`  Updated: ${updated}`);
  if (updated > 0 && !DRY_RUN) {
    console.log(`\n  Migration password (share with viewers/Craig): "${password}"`);
    console.log("  Viewers can change it later once a self-service reset flow exists.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
