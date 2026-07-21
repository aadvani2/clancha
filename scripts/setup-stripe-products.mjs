import "dotenv/config";
import Stripe from "stripe";
import fs from "node:fs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-01-27.acacia",
});

const isLive = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");
if (isLive) {
  console.error(
    "\nRefusing to run: STRIPE_SECRET_KEY is a LIVE key (sk_live_…). This script is sandbox-only."
  );
  process.exit(1);
}

const TARGETS = [
  {
    label: "core",
    productName: "Clancha Core",
    productDescription:
      "Per-channel core SMS subscription. £14.99 GBP / month / channel.",
    nickname: "core_monthly_gbp",
    amountMinor: 1499, // £14.99 in pence
    metadata: { plan: "core", role: "per_channel_core" },
    envVar: "STRIPE_PRICE_CORE",
  },
  {
    label: "picture_addon",
    productName: "Clancha Picture Sharing Add-on",
    productDescription:
      "Picture sharing add-on. £4.99 GBP / month / channel that opts in. Charged in addition to the core line item.",
    nickname: "picture_addon_monthly_gbp",
    amountMinor: 499, // £4.99 in pence
    metadata: { plan: "picture_addon", role: "per_channel_addon_delta" },
    envVar: "STRIPE_PRICE_PICTURE_ADDON",
  },
];

async function findExistingPrice(target) {
  const prices = await stripe.prices.list({
    active: true,
    limit: 100,
    expand: ["data.product"],
  });
  return prices.data.find(
    (p) =>
      p.nickname === target.nickname &&
      p.unit_amount === target.amountMinor &&
      p.currency === "gbp" &&
      p.recurring?.interval === "month"
  );
}

async function createProductAndPrice(target) {
  const existing = await findExistingPrice(target);
  if (existing) {
    console.log(
      `  → already exists, reusing: price ${existing.id} on product ${
        typeof existing.product === "string" ? existing.product : existing.product?.id
      }`
    );
    return existing;
  }

  const product = await stripe.products.create({
    name: target.productName,
    description: target.productDescription,
    metadata: target.metadata,
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "gbp",
    unit_amount: target.amountMinor,
    recurring: { interval: "month", interval_count: 1 },
    nickname: target.nickname,
    metadata: target.metadata,
  });
  console.log(`  → created product ${product.id}, price ${price.id}`);
  return price;
}

function updateEnvFile(updates) {
  const envPath = ".env";
  if (!fs.existsSync(envPath)) {
    console.warn(`\n.env not found at ${envPath}; skipping write.`);
    return;
  }
  let contents = fs.readFileSync(envPath, "utf-8");
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(contents)) {
      const before = contents.match(re)[0];
      const after = `${key}=${value}`;
      if (before !== after) {
        contents = contents.replace(re, after);
        changed = true;
        console.log(`  ${key} updated`);
      } else {
        console.log(`  ${key} unchanged`);
      }
    } else {
      contents += `${contents.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
      changed = true;
      console.log(`  ${key} added`);
    }
  }
  if (changed) {
    fs.writeFileSync(envPath, contents);
  }
}

async function main() {
  const acct = await stripe.accounts.retrieve();
  console.log("Stripe account:", acct.id, `(country: ${acct.country})`);
  console.log("Mode:", isLive ? "LIVE" : "TEST/SANDBOX");

  console.log("\nCreating GBP products + prices per spec…");
  const created = {};
  for (const target of TARGETS) {
    console.log(`\n[${target.label}] ${target.productName} (£${(target.amountMinor / 100).toFixed(2)} GBP / month)`);
    const price = await createProductAndPrice(target);
    created[target.envVar] = price.id;
  }

  console.log("\nWriting price IDs to .env…");
  updateEnvFile(created);

  console.log("\nFinal mapping:");
  for (const [key, value] of Object.entries(created)) {
    console.log(`  ${key}=${value}`);
  }
  console.log(
    "\nNote: existing test products were left in place (not archived). Run scripts/inspect-stripe.mjs to verify."
  );
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
