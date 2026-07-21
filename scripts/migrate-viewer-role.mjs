#!/usr/bin/env node
/**
 * Migrate existing User docs with role: "third_party_viewer" to role:
 * "viewer". Paired with the Craig M4 tracker #41 enum rename — once the
 * code switches to the new enum, any user still stamped with the old
 * value would fail Mongoose's schema validation on the next save, plus
 * existing JWTs with the old role won't match the new role-based gates
 * (e.g. password-login).
 *
 * Idempotent. Dry-run via DRY_RUN=1.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/migrate-viewer-role.mjs
 *   node scripts/migrate-viewer-role.mjs
 */

import "dotenv/config";
import mongoose from "mongoose";

const DRY_RUN = process.env.DRY_RUN === "1";

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set");
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
console.log(`Connected to ${mongoose.connection.name}`);

const Users = mongoose.connection.db.collection("users");
const matched = await Users.countDocuments({ role: "third_party_viewer" });
console.log(`Users with legacy role "third_party_viewer": ${matched}`);

if (matched === 0) {
  console.log("Nothing to migrate.");
  await mongoose.disconnect();
  process.exit(0);
}

if (DRY_RUN) {
  console.log(`Would update ${matched} user(s) to role: "viewer"`);
  await mongoose.disconnect();
  process.exit(0);
}

const r = await Users.updateMany({ role: "third_party_viewer" }, { $set: { role: "viewer" } });
console.log(`Updated ${r.modifiedCount} user(s).`);

await mongoose.disconnect();
