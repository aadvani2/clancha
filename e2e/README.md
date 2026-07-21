# Playwright E2E

Browser-driven end-to-end tests. Vitest under `tests/` covers API-layer
integration; Playwright drives the actual UI.

## Run

```bash
# One-time
npx playwright install chromium

# Each run — needs three terminals:

# Terminal 1: dev server
npm run dev

# Terminal 2: Stripe webhooks forwarded to local
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Copy the printed `whsec_…` into .env as STRIPE_WEBHOOK_SECRET, then
# restart Terminal 1.

# Terminal 3: tests
npm run test:e2e
# or with the inspector
npm run test:e2e:ui
```

## Required env (in .env)

```
OTP_TEST_BYPASS_CODE=000000
STRIPE_SECRET_KEY=sk_test_<from your UK/US Stripe test account>
STRIPE_WEBHOOK_SECRET=whsec_<from `stripe listen`>
STRIPE_PRICE_CORE=price_<GBP £14.99 — from scripts/setup-stripe-products.mjs>
STRIPE_PRICE_PICTURE_ADDON=price_<GBP £4.99 — from same script>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_<paired publishable key>
```

`OTP_TEST_BYPASS_CODE` is gated on `NODE_ENV !== "production"` — it cannot
be enabled in production no matter what env says.

## Stripe account requirement (important)

This test exercises mid-cycle prorations (the second channel). On a Stripe
account whose country is **India**, prorations trigger RBI e-mandate / SCA
flows that have no confirmation UI server-side, so `invoice.paid` never
fires for the second channel and the test hangs.

**Use a UK or US Stripe test account.** One-time setup:

1. Sign up at https://dashboard.stripe.com/register — pick UK or US as the
   country.
2. Stay in **test mode** (top-left toggle). No real verification needed for
   test mode — you'll get test keys immediately.
3. Copy `sk_test_…` and `pk_test_…` from
   https://dashboard.stripe.com/test/apikeys → into `.env`.
4. Generate the GBP products on the new account:
   ```bash
   node scripts/setup-stripe-products.mjs
   ```
   This script reads the new `STRIPE_SECRET_KEY` from `.env`, creates
   `Clancha Core` (£14.99/mo) and `Clancha Picture Sharing Add-on`
   (£4.99/mo) on the new account, and updates `.env` with the new price IDs.
5. Restart `stripe listen` in its terminal (it picks up keys from
   `~/.config/stripe/`). Re-copy the printed `whsec_…` into `.env`.
6. Restart `npm run dev`.

Verify with `node scripts/inspect-stripe.mjs` — the account country should
not be `IN` and the two GBP prices should show.

## Required seeds

- Super admin must exist:
  ```bash
  node scripts/seed-super-admin.js
  ```
- Phone number pool must be non-empty (otherwise `/subscription` blocks):
  ```bash
  node scripts/seed-phone-numbers.js
  ```

## What the test exercises

`subscription-journey.spec.ts` walks one user through:

1. Signup with a random UK phone + email + name (OTP bypassed via the test code).
2. `/subscription` → pick Standard → `/checkout` → fill Stripe Elements with
   `4242 4242 4242 4242`, expiry `12/34`, CVC `123` → submit.
3. Poll dashboard until the webhook lands and the first channel appears.
4. From dashboard, "Add channel" with a fresh phone + Picture Sharing toggle on.
5. Wait for the second channel to appear.
6. New browser context: super-admin logs in via `/admin/login`.
7. Super-admin opens `/admin/channels/<channel-id>`, clicks **Cancel**.
8. Asserts the channel state is now `view_only` (via `/api/admin/channels/<id>/detail`).

## Known fragility

- **Stripe Elements selectors** — Playwright must drill into multiple
  iframes named `__privateStripeFrame…`. Stripe sometimes changes layout
  variants. If a field can't be filled, the test fails with a clear error.
- **Add-channel UI** — the spec tries `getByRole("button", "Add channel")`
  and a few synonyms. If your dashboard uses a different label, update
  `addSecondChannelWithPicture()`.
- **Webhook latency** — the test polls for 90s; on slow networks bump it.
- **No cleanup** — test creates real Stripe test-mode subscriptions and
  Mongo records. Drop the dev DB or wipe Stripe test-mode periodically.
