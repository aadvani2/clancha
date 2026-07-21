/**
 * Seed the phone number pool so POST /api/channels can allocate a Clancha number.
 * Run once (e.g. after fresh DB) or when the pool is empty.
 *
 * Usage: node scripts/seed-phone-numbers.js
 * Requires MONGODB_URI (e.g. in .env.local or .env).
 *
 * For production, add real Twilio numbers via Twilio console and sync them here
 * or via an admin API.
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// Load .env.local and .env so MONGODB_URI is set (same as Next.js)
function loadEnv() {
  const root = path.resolve(__dirname, "..");
  for (const file of [".env.local", ".env"]) {
    const p = path.join(root, file);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) {
          const value = match[2].replace(/^["']|["']$/g, "").trim();
          process.env[match[1]] = value;
        }
      }
      break;
    }
  }
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not set. Create .env.local with MONGODB_URI=mongodb://...");
    process.exit(1);
  }
}

const DEV_NUMBERS = [
  "+15551234567",
  "+15551234568",
  "+15551234569",
  "+15551234570",
  "+15551234571",
];

async function main() {
  loadEnv();

  await mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false });
  const coll = mongoose.connection.collection("phonenumbers");

  const now = new Date();
  let added = 0;
  for (const number of DEV_NUMBERS) {
    const result = await coll.updateOne(
      { number },
      {
        $setOnInsert: {
          number,
          channelId: null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount > 0) added++;
  }

  console.log(`Phone number pool: ${added} new number(s) added, ${DEV_NUMBERS.length} total available for dev.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
