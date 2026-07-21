import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-01-27.acacia",
});

function fmtAmount(unit, currency) {
  if (typeof unit !== "number") return "n/a";
  const major = unit / 100;
  return `${major.toFixed(2)} ${currency.toUpperCase()}`;
}

async function describePrice(label, priceId) {
  if (!priceId) {
    console.log(`\n[${label}] ENV NOT SET`);
    return null;
  }
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    const product = price.product;
    console.log(`\n[${label}] ${priceId}`);
    console.log(`  product.id      : ${product.id}`);
    console.log(`  product.name    : ${product.name}`);
    console.log(`  product.active  : ${product.active}`);
    console.log(`  price.amount    : ${fmtAmount(price.unit_amount, price.currency)}`);
    console.log(
      `  price.recurring : ${
        price.recurring
          ? `${price.recurring.interval} (every ${price.recurring.interval_count})`
          : "one-time"
      }`
    );
    console.log(`  price.active    : ${price.active}`);
    console.log(`  price.nickname  : ${price.nickname ?? "(none)"}`);
    return { price, product };
  } catch (err) {
    console.log(`\n[${label}] ERROR: ${err.message}`);
    return null;
  }
}

async function listAllPrices() {
  console.log("\n────────────────────────────────────────");
  console.log("All ACTIVE prices in this Stripe account:");
  console.log("────────────────────────────────────────");
  const prices = await stripe.prices.list({
    active: true,
    limit: 50,
    expand: ["data.product"],
  });
  for (const p of prices.data) {
    const productName = typeof p.product === "string" ? p.product : p.product?.name ?? "(unknown)";
    console.log(
      `  ${p.id}  ${fmtAmount(p.unit_amount, p.currency).padEnd(12)}  ${
        p.recurring ? p.recurring.interval : "one-time"
      }  →  ${productName}`
    );
  }
}

async function main() {
  console.log("Stripe key prefix:", (process.env.STRIPE_SECRET_KEY ?? "").slice(0, 8) + "…");
  console.log("Account info:");
  try {
    const acct = await stripe.accounts.retrieve();
    console.log(`  account.id     : ${acct.id}`);
    console.log(`  account.email  : ${acct.email ?? "(none)"}`);
    console.log(`  account.country: ${acct.country ?? "(none)"}`);
    console.log(`  account.charges_enabled: ${acct.charges_enabled}`);
    console.log(
      `  account.livemode: ${(process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_")}`
    );
  } catch (err) {
    console.log(`  account fetch failed: ${err.message}`);
  }

  await describePrice("STRIPE_PRICE_CORE", process.env.STRIPE_PRICE_CORE);
  await describePrice("STRIPE_PRICE_PICTURE_ADDON", process.env.STRIPE_PRICE_PICTURE_ADDON);
  await listAllPrices();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
