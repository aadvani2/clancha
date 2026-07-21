/**
 * One-off migration: set an initial password for moderators that currently
 * have no password on their User document.
 *
 * Context: the moderator auth flow switched from OTP-only to email+password
 * on 2026-05-19. Pre-existing moderator accounts were created with no
 * password field, so they're locked out of /admin/login until one is set.
 *
 * Usage:
 *   node scripts/set-moderator-password.mjs <password>
 *   PASSWORD='secret' node scripts/set-moderator-password.mjs
 *
 * The password is taken from argv[2] OR the PASSWORD env var. Refuses to
 * run if no password is provided — we never want a default committed.
 * Existing moderators with a password set are left untouched.
 */
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const password = (process.argv[2] || process.env.PASSWORD || "").trim();

if (!password) {
  console.error("Usage: node scripts/set-moderator-password.mjs <password>");
  console.error("   or: PASSWORD='secret' node scripts/set-moderator-password.mjs");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not set in environment");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.name}\n`);

  // Bypass any Mongoose schema-level `select:false` on password by using the
  // raw collection driver. The production User schema marks the field as
  // unselectable by default, so a model-based .find() with .lean() can fail
  // to surface it even with .select("+password") when the schema isn't the
  // production one.
  const usersCol = mongoose.connection.db.collection("users");
  const moderators = await usersCol
    .find({ role: "moderator" })
    .project({ password: 1, phone: 1, email: 1, name: 1, role: 1, createdAt: 1 })
    .toArray();

  const missing = moderators.filter(
    (m) => !m.password || typeof m.password !== "string" || m.password.length === 0
  );
  const alreadySet = moderators.filter(
    (m) => m.password && typeof m.password === "string" && m.password.length > 0
  );

  console.log(`Total moderators:           ${moderators.length}`);
  console.log(`Already have a password:    ${alreadySet.length}`);
  console.log(`Need a password (will set): ${missing.length}\n`);

  if (alreadySet.length > 0) {
    console.log("ALREADY HAVE PASSWORDS (left untouched):");
    for (const m of alreadySet) {
      console.log(`  ${(m.name || "(no name)").padEnd(20)} ${m.email?.padEnd(32) || "(no email)".padEnd(32)} ${m.phone || ""}`);
    }
    console.log("");
  }

  if (missing.length === 0) {
    console.log("Nothing to migrate. ✓");
    await mongoose.disconnect();
    return;
  }

  console.log("WILL SET PASSWORD FOR:");
  for (const m of missing) {
    console.log(`  ${(m.name || "(no name)").padEnd(20)} ${m.email?.padEnd(32) || "(no email)".padEnd(32)} ${m.phone || ""}`);
  }
  console.log("");

  const hash = await bcrypt.hash(password, 10);

  const ids = missing.map((m) => m._id);
  const result = await usersCol.updateMany(
    { _id: { $in: ids } },
    { $set: { password: hash } }
  );

  console.log(`Updated ${result.modifiedCount} moderator(s).`);
  console.log("\nThese moderators can now log in at /admin/login with their email");
  console.log("and the password you supplied. Share the password with each of them");
  console.log("securely — not over Clancha SMS.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
