# Stripe Test Environment

Staging (`13.134.240.203`) runs against **Craig's Stripe test mode account** as of 2026-05-22. Production swap-over to the live `rk_live_…` restricted key happens at go-live — not before.

## Account

- Owner: Craig (Clancha)
- Mode: **test** (`livemode: false` on every Stripe response)
- Currency: GBP
- Connect: not used (single direct customer per Clancha account)

## Active credentials on staging

Set in `/home/ubuntu/clancha/.env`. Rotate by replacing the value and running `pm2 reload clancha-admin --update-env`.

| Var | Value source |
|-----|--------------|
| `STRIPE_SECRET_KEY` | `sk_test_51SYTl0RnkEYfqYBI…` (Craig's test secret key) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_51SYTl0RnkEYfqYBI…` (Craig's test publishable key) |
| `STRIPE_PRICE_CORE` | `price_1TZajPRnkEYfqYBIbMiLgYbz` → £14.99 / month / `prod_UYi9VQahQJNzHr` |
| `STRIPE_PRICE_PICTURE_ADDON` | `price_1TZakKRnkEYfqYBIKyiijH0K` → £4.99 / month / `prod_UYiAMQ5FmXGTcu` |
| `STRIPE_WEBHOOK_SECRET` | **Pending Craig** — see "Webhook setup" below |

## Webhook setup (Craig action required)

The webhook signing secret is per-endpoint. Craig (or an admin on his Stripe account) must:

1. Go to **Stripe Dashboard → Developers → Webhooks → Add endpoint** in **test mode**.
2. Endpoint URL: `https://clancha.stagingenv.app/api/webhooks/stripe`
3. Subscribe to these events (matches `app/api/webhooks/stripe/route.ts`):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `payment_intent.succeeded`
4. Copy the **Signing secret** (`whsec_…`) and send to the developer through 1Password or another out-of-band channel.
5. Developer sets `STRIPE_WEBHOOK_SECRET=whsec_…` in staging `.env` and reloads pm2.

**Until this is done, webhook events from Craig's account will be rejected with a signature-verification error.** Outbound flows (create customer, create subscription, retrieve price) still work because they don't require the webhook secret.

## Test cards

Use any future expiry and any 3-digit CVC. Postcode `SW1A 1AA` for UK billing.

| Card | Behaviour |
|------|-----------|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 9995` | `card_declined`, `insufficient_funds` — drives Active → View-only transition (item #20) |
| `4000 0027 6000 3184` | 3DS challenge required (test the SCA flow) |
| `4000 0000 0000 0341` | Attaches OK but charge fails — for testing `invoice.payment_failed` |
| `4000 0000 0000 0002` | Generic decline |

Full list: https://docs.stripe.com/testing#cards

## Verifying the setup

```bash
# 1. Keys authenticate
curl -s -u "$STRIPE_SECRET_KEY:" https://api.stripe.com/v1/prices/$STRIPE_PRICE_CORE | jq .unit_amount
# Expect: 1499

curl -s -u "$STRIPE_SECRET_KEY:" https://api.stripe.com/v1/prices/$STRIPE_PRICE_PICTURE_ADDON | jq .unit_amount
# Expect: 499

# 2. App picks up env (after pm2 reload --update-env)
ssh ubuntu@13.134.240.203 "source ~/.nvm/nvm.sh && pm2 logs clancha-admin --lines 50 --nostream | grep -i stripe"
```

## Stripe dashboard reference

- Test dashboard: https://dashboard.stripe.com/test
- Test customers: https://dashboard.stripe.com/test/customers
- Test subscriptions: https://dashboard.stripe.com/test/subscriptions
- Test webhook events: https://dashboard.stripe.com/test/webhooks
- Test logs (raw API calls): https://dashboard.stripe.com/test/logs

## Production switch-over (NOT YET — for reference)

When ready to go live:

1. Rotate Craig's `rk_live_…` restricted key (it was shared in plaintext over email). Replace with a freshly minted restricted key from the live Stripe dashboard with the scopes from the Stripe handover doc.
2. Replace `STRIPE_SECRET_KEY` with the new `rk_live_…`.
3. Replace `STRIPE_PRICE_CORE` with `price_1SZWUnRnkEYfqYBI9hMxHGxO` (live).
4. Replace `STRIPE_PRICE_PICTURE_ADDON` with `price_1Sl4SERnkEYfqYBIwX0Jkgxi` (live).
5. Replace `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` with the live publishable key from Craig.
6. Create a fresh webhook endpoint in **live mode** pointing at the production host, subscribed to the same events. Set `STRIPE_WEBHOOK_SECRET` to the new live `whsec_…`.
7. Run smoke test with a real card (small amount), then cancel.

## Previous (non-Craig) test account

Before 2026-05-22 staging used a different developer-owned test account: `sk_test_51NLoBaSJIUGZFS1w…`. The `.env.backup-20260522-093550` on staging has the prior config. That account is no longer used and any customers/subs/invoices in it are dev artefacts only.
