import "dotenv/config";
import mongoose from "mongoose";

const Message = mongoose.model("Message", new mongoose.Schema({}, { strict: false }), "messages");
const AuditLog = mongoose.model("AuditLog", new mongoose.Schema({}, { strict: false }), "auditlogs");
const User = mongoose.model("User", new mongoose.Schema({}, { strict: false }), "users");
const Channel = mongoose.model("Channel", new mongoose.Schema({}, { strict: false }), "channels");

const MINS = parseInt(process.argv[2] || "60", 10);
const since = new Date(Date.now() - MINS * 60 * 1000);

function ms(phone) {
  if (!phone) return "(none)";
  const s = String(phone);
  return s.length >= 4 ? `***${s.slice(-4)}` : "***";
}

function trunc(s, n = 80) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Last ${MINS} minutes of activity on ${mongoose.connection.name}\n`);

  // 1. Recent messages with sender+channel populated
  const msgs = await Message.find({
    createdAt: { $gte: since },
    isSystem: { $ne: true },
  })
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();

  console.log("━━━ RECENT MESSAGES ━━━");
  console.log(
    `${"time".padEnd(10)} ${"state".padEnd(12)} ${"class".padEnd(10)} ${"sender".padEnd(10)} ${"channel".padEnd(8)} text`
  );

  const userIds = new Set();
  const channelIds = new Set();
  for (const m of msgs) {
    if (m.senderId) userIds.add(m.senderId.toString());
    if (m.channelId) channelIds.add(m.channelId.toString());
  }

  const users = await User.find({ _id: { $in: [...userIds] } })
    .select("_id phone name email role")
    .lean();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const channels = await Channel.find({ _id: { $in: [...channelIds] } })
    .select("_id clanchaNumber")
    .lean();
  const channelMap = new Map(channels.map((c) => [c._id.toString(), c]));

  for (const m of msgs) {
    const t = new Date(m.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const sender = userMap.get(m.senderId?.toString() || "");
    const senderTag = sender ? `${sender.name?.slice(0, 8) ?? ms(sender.phone)}` : "?";
    const channel = channelMap.get(m.channelId?.toString() || "");
    const channelTag = channel ? ms(channel.clanchaNumber) : "?";
    const cls = (m.classification || "—").padEnd(10);
    console.log(
      `${t.padEnd(10)} ${String(m.state).padEnd(12)} ${cls} ${senderTag.padEnd(10)} ${channelTag.padEnd(8)} "${trunc(m.originalText, 70)}"`
    );
    if (m.rewrittenText && m.rewrittenText !== m.originalText) {
      console.log(`${" ".repeat(53)}↳ "${trunc(m.rewrittenText, 70)}"`);
    }
    if (m.violationTags?.length) {
      console.log(`${" ".repeat(53)}⚑ ${m.violationTags.join(", ")}`);
    }
  }

  // 2. Recent audit log
  console.log("\n━━━ RECENT AUDIT LOG ━━━");
  const audits = await AuditLog.find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();
  console.log(`${"time".padEnd(10)} ${"action".padEnd(34)} ${"actor".padEnd(10)} extra`);
  for (const a of audits) {
    const t = new Date(a.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const actor = userMap.get(a.actorUserId?.toString() || "");
    const actorTag = actor ? `${actor.name?.slice(0, 8) ?? actor.role}` : "?";
    const meta = a.metadata || {};
    const extras = [];
    if (meta.classification) extras.push(`cls=${meta.classification}`);
    if (meta.reason) extras.push(`reason=${meta.reason}`);
    if (meta.noSafeRewrite !== undefined) extras.push(`noSafeRewrite=${meta.noSafeRewrite}`);
    if (meta.smsSkipReason) extras.push(`smsSkip="${meta.smsSkipReason}"`);
    console.log(`${t.padEnd(10)} ${String(a.action).padEnd(34)} ${actorTag.padEnd(10)} ${extras.join(" ")}`);
  }

  // 3. Active users in this window
  console.log("\n━━━ USERS ACTIVE IN THIS WINDOW ━━━");
  const usersInWindow = await User.find({
    _id: { $in: [...userIds] },
  })
    .select("_id phone name email role")
    .lean();
  for (const u of usersInWindow) {
    console.log(`  ${ms(u.phone).padEnd(10)} ${(u.name || "(no name)").padEnd(18)} ${u.email?.padEnd(28) || "—"} role=${u.role || "user"}`);
  }

  // 4. Currently held messages (the moderator queue right now)
  const heldNow = await Message.find({ state: "held", isSystem: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  console.log(`\n━━━ MODERATION QUEUE RIGHT NOW (${heldNow.length}) ━━━`);
  for (const m of heldNow) {
    const t = new Date(m.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const cls = m.classification || "—";
    const norewrite = !m.rewrittenText || m.rewrittenText === m.originalText;
    const flag = norewrite && cls !== "safe" ? " ⛔ NO SAFE REWRITE" : "";
    console.log(`  ${t}  cls=${cls.padEnd(10)} "${trunc(m.originalText, 70)}"${flag}`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
