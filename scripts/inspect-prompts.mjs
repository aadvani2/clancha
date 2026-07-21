import "dotenv/config";
import mongoose from "mongoose";

// Mirror the code-side DEFAULT_REVISIONS map. Bump here when promptStore.ts bumps.
const DEFAULT_REVISIONS = {
  rewrite_system: 4,
  tone_calm_clear: 1,
  tone_firm_fair: 1,
  classify_system: 4,
  image_moderate_system: 1,
  qa_system: 1,
};

const PROMPT_KEYS = Object.keys(DEFAULT_REVISIONS);

// Markers that should appear in the post-2026-05-19 patched code-default bodies.
const EXPECTED_MARKERS = {
  rewrite_system: ["__HOLD_FOR_MODERATION__", "NEVER INVENT CONTENT"],
  classify_system: ["DIRECTED PERSONAL ATTACKS", "BareInsult", "DirectedAttack"],
  tone_calm_clear: ["Calm & Clear"],
  tone_firm_fair: ["Firm & Fair"],
  image_moderate_system: ["Violence or weapons"],
  qa_system: ["factual lookup tool", "MUST REFUSE"],
};

const PromptVersion = mongoose.model(
  "PromptVersion",
  new mongoose.Schema(
    {
      key: String,
      body: String,
      version: Number,
      defaultRevision: { type: Number, default: 1 },
      changeNote: String,
      rolledBackFromVersion: { type: Number, default: null },
      createdBy: mongoose.Schema.Types.ObjectId,
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);

function snippet(body, n = 90) {
  if (!body) return "(empty)";
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n) + "…" : oneLine;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to ${mongoose.connection.name}\n`);

  let totalIssues = 0;

  for (const key of PROMPT_KEYS) {
    const minRev = DEFAULT_REVISIONS[key];
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`KEY: ${key}    (code DEFAULT_REVISIONS=${minRev})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const all = await PromptVersion.find({ key })
      .sort({ version: -1 })
      .select("version defaultRevision body changeNote createdAt")
      .lean();

    if (all.length === 0) {
      console.log("  No DB records — code default will be served. ✅");
      continue;
    }

    console.log(`  ${all.length} DB record(s):`);
    for (const r of all) {
      const stale = (r.defaultRevision ?? 1) < minRev;
      const marker = stale ? "🟡 STALE (below min rev — ignored)" : "🟢 eligible";
      console.log(
        `    v${r.version}  defaultRev=${r.defaultRevision ?? 1}  ${marker}  ${r.createdAt?.toISOString?.() ?? ""}`
      );
      if (r.changeNote) console.log(`        note: ${r.changeNote}`);
    }

    // Replicate getActivePrompt logic
    const active = await PromptVersion.findOne({
      key,
      defaultRevision: { $gte: minRev },
    })
      .sort({ version: -1 })
      .lean();

    if (active) {
      console.log(`\n  SERVED → DB record v${active.version}`);
      console.log(`  body preview: ${snippet(active.body)}`);
      const markers = EXPECTED_MARKERS[key] || [];
      const missing = markers.filter((m) => !active.body?.includes(m));
      if (missing.length) {
        console.log(`  ⚠ MISSING expected markers in DB body: ${missing.join(", ")}`);
        totalIssues++;
      } else if (markers.length) {
        console.log(`  ✓ DB body contains all expected markers (${markers.join(", ")})`);
      }
    } else {
      console.log(`\n  SERVED → code default (no eligible DB record)`);
      console.log(`  This is the desired state after rev bump on ${key}.`);
    }
    console.log("");
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(totalIssues === 0 ? "All prompts OK." : `${totalIssues} issue(s) flagged above.`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
