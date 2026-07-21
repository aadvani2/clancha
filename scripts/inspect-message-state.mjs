import "dotenv/config";
import mongoose from "mongoose";

const Message = mongoose.model(
  "Message",
  new mongoose.Schema({}, { strict: false }),
  "messages"
);
const AuditLog = mongoose.model(
  "AuditLog",
  new mongoose.Schema({}, { strict: false }),
  "auditlogs"
);
const User = mongoose.model("User", new mongoose.Schema({}, { strict: false }), "users");
const Channel = mongoose.model("Channel", new mongoose.Schema({}, { strict: false }), "channels");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log(`Connected to ${mongoose.connection.name}\n`);

  // 1. Message state distribution
  const stateCounts = await Message.aggregate([
    { $group: { _id: "$state", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  console.log("MESSAGE STATE DISTRIBUTION");
  stateCounts.forEach((s) => console.log(`  ${String(s._id).padEnd(15)} ${s.n}`));

  // 2. Stuck messages — anything in non-terminal state older than 5 min is suspicious
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const stuck = await Message.find({
    state: { $in: ["rewriting", "processing", "queued"] },
    createdAt: { $lt: fiveMinAgo },
  })
    .select("state originalText createdAt channelId")
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  console.log(`\nSTUCK MESSAGES (non-terminal, >5min old): ${stuck.length}`);
  stuck.forEach((m) => {
    const preview = (m.originalText || "").slice(0, 60);
    console.log(`  ${m.state.padEnd(12)} ${m.createdAt?.toISOString()} "${preview}"`);
  });

  // 3. Held messages awaiting moderation (the queue Craig will see)
  const held = await Message.find({ state: "held", isSystem: { $ne: true } })
    .select("originalText createdAt channelId classification violationTags")
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  console.log(`\nHELD MESSAGES IN MODERATION QUEUE: ${held.length}`);
  held.forEach((m) => {
    const preview = (m.originalText || "").slice(0, 60);
    console.log(
      `  ${m.createdAt?.toISOString()}  cls=${m.classification ?? "?"}  tags=${JSON.stringify(m.violationTags ?? [])}`
    );
    console.log(`    "${preview}"`);
  });

  // 4. Recent blocked messages
  const blocked = await Message.find({ state: "blocked" })
    .select("originalText createdAt classification")
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  console.log(`\nRECENT BLOCKED MESSAGES (last 5):`);
  blocked.forEach((m) => {
    const preview = (m.originalText || "").slice(0, 60);
    console.log(`  ${m.createdAt?.toISOString()}  "${preview}"`);
  });

  // 5. Demo data readiness
  const users = await User.countDocuments();
  const channels = await Channel.countDocuments();
  const recentMessages = await Message.countDocuments({
    isSystem: { $ne: true },
    createdAt: { $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  });
  console.log(`\nDEMO DATA READINESS`);
  console.log(`  users:                  ${users}`);
  console.log(`  channels:               ${channels}`);
  console.log(`  user messages (7d):     ${recentMessages}`);

  // 6. Audit-log coverage in last 7d (should see message_delivered, message_blocked, message_held)
  const recentAudits = await AuditLog.aggregate([
    { $match: { createdAt: { $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
    { $group: { _id: "$action", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  console.log(`\nAUDIT LOG ACTIONS (last 7d)`);
  if (recentAudits.length === 0) {
    console.log("  (none)");
  } else {
    recentAudits.forEach((a) => console.log(`  ${a._id.padEnd(28)} ${a.n}`));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
