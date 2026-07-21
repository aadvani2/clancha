/**
 * Seed a window of Twilio + OpenAI outage failures into the audit log so the
 * /admin/failures page shows real service-failure history (M4 tracker #57/#58).
 *
 * Each row is the same shape the live catch-paths write (sendSms /
 * classifyAndRewrite), tagged metadata.simulated so it is distinguishable from
 * a genuine production incident, and back-dated over the last ~12 minutes so it
 * lands inside the 24h / 7d count windows the Failures page shows.
 *
 *   node scripts/seed-outage-failures.mjs
 */
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const col = db.collection("auditlogs");

const now = Date.now();
const minsAgo = (m) => new Date(now - m * 60_000);

const twilioFailures = [
  { mins: 12, toMasked: "***3456" },
  { mins: 10, toMasked: "***7788" },
  { mins: 8, toMasked: "***1290" },
].map((f) => ({
  action: "service_failure_twilio",
  metadata: {
    operation: "sendSms",
    message:
      "Twilio outage — outbound SMS failed and was queued to SmsOutbox (no data lost; auto-resumes on recovery).",
    code: null,
    simulated: true,
    toMasked: f.toMasked,
  },
  createdAt: minsAgo(f.mins),
  updatedAt: minsAgo(f.mins),
}));

const openaiFailures = [
  { mins: 11 },
  { mins: 9 },
  { mins: 7 },
].map((f) => ({
  action: "service_failure_openai",
  metadata: {
    operation: "classifyAndRewrite",
    message:
      "OpenAI outage — message held for moderation (never sent unprocessed); processes on recovery.",
    code: null,
    simulated: true,
  },
  createdAt: minsAgo(f.mins),
  updatedAt: minsAgo(f.mins),
}));

const docs = [...twilioFailures, ...openaiFailures];
const res = await col.insertMany(docs);
console.log(`Inserted ${res.insertedCount} outage failure audit rows.`);

const since24h = new Date(now - 24 * 60 * 60 * 1000);
const tw = await col.countDocuments({ action: "service_failure_twilio", createdAt: { $gte: since24h } });
const oa = await col.countDocuments({ action: "service_failure_openai", createdAt: { $gte: since24h } });
console.log(`Failures page 24h counts now → twilio: ${tw}, openai: ${oa}`);

await mongoose.disconnect();
console.log("Done.");
