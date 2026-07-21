import { test, expect, Page, FrameLocator } from "@playwright/test";

/**
 * Subscription end-to-end journey
 * ───────────────────────────────
 * 1. New user signs up via OTP (bypass code).
 * 2. Picks Standard plan, completes Stripe checkout (test card 4242…),
 *    waits for the webhook to create the first channel.
 * 3. From the dashboard, adds a SECOND channel with Picture Sharing on.
 * 4. Logs in as super-admin in a separate browser context.
 * 5. Opens the admin channel detail page for one of the channels and
 *    clicks the "Cancel" action.
 * 6. Asserts the channel state flips to view_only.
 *
 * Prerequisites — see e2e/README.md for full setup. tl;dr:
 *   - npm run dev               (terminal 1)
 *   - stripe listen --forward-to localhost:3000/api/webhooks/stripe (terminal 2)
 *   - .env: OTP_TEST_BYPASS_CODE=000000, STRIPE_WEBHOOK_SECRET=<from listen>,
 *           STRIPE_PRICE_CORE / STRIPE_PRICE_PICTURE_ADDON (GBP).
 *   - node scripts/seed-super-admin.js
 *   - node scripts/seed-phone-numbers.js
 */

// Universal Stripe test card. Works without 3DS / SCA on UK/US test accounts.
// Indian Stripe test accounts also fire 3DS/RBI e-mandate flows on this card —
// the e-mandate consent click below handles the first-checkout case, but
// server-side prorations cannot be auto-confirmed in India test mode. Use a
// UK/US test account (see e2e/README.md) to exercise the full journey.
const TEST_CARD = "4242424242424242";
const TEST_OTP = "000000";

const SUPER_ADMIN_EMAIL = "superadmin@clancha.com";
const SUPER_ADMIN_PASSWORD = "superadminpassword123";

function rand(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
}

function randomUkPhone(): string {
  // UK mobile: +447 + 9 digits.
  return `+447${rand(9)}`;
}

function randomEmail(prefix: string): string {
  return `${prefix}+${Math.random().toString(36).slice(2, 8)}@example.test`;
}

// ──────────────────────────────────────────────────────────────────────
// Page helpers
// ──────────────────────────────────────────────────────────────────────

async function fillSignupForm(
  page: Page,
  data: { name: string; email: string; phone: string }
) {
  await page.goto("/signup");
  await page.locator("#name").fill(data.name);
  await page.locator("#email").fill(data.email);
  await page.locator("#gender").selectOption("male");
  // type="date" needs YYYY-MM-DD.
  await page.locator("#dob").fill("1990-01-01");

  // react-phone-number-input renders a <input type="tel"> with placeholder
  // "Enter phone number". The label "Mobile Number" is on a wrapper div, so
  // getByLabel won't reliably reach the input. Match by placeholder instead.
  const phoneInput = page.getByPlaceholder("Enter phone number");
  await phoneInput.click();
  // Pasting the full E.164 number lets react-phone-number-input auto-detect
  // the country code and set the dropdown.
  await phoneInput.fill(data.phone);

  await page.getByRole("button", { name: /^sign up$/i }).click();
  await page.waitForURL(/\/verify-otp/, { timeout: 15_000 });
}

async function submitOtp(page: Page) {
  await page.locator("#otp").fill(TEST_OTP);
  await page.getByRole("button", { name: /^verify$/i }).click();
  // Signup → /subscription, login → /dashboard.
  await page.waitForURL(/\/(subscription|dashboard)/, { timeout: 15_000 });
}

async function pickPlan(page: Page, planName: "Standard" | "Premium") {
  if (!page.url().includes("/subscription")) {
    await page.goto("/subscription");
  }
  // The plan card's button is disabled until selectedPlan === plan.name,
  // which only happens onMouseEnter. Hovering over the card enables the
  // button before we click it.
  const card = page.locator('div.relative.group').filter({ hasText: planName });
  await card.first().hover();
  await page
    .getByRole("button", { name: new RegExp(`select ${planName}|get ${planName}`, "i") })
    .first()
    .click();
  await page.waitForURL(/\/checkout/, { timeout: 15_000 });
}

/**
 * Fill a field across all candidate Stripe Element iframes.
 *
 * Stripe ships two element flavours that we may encounter:
 *   - Legacy CardElement: input names are `cardnumber`, `exp-date`, `cvc`, `postal`.
 *   - New PaymentElement: input names are `number`, `expiry`, `cvc`, `postalCode`.
 *
 * Rather than hard-code one, walk the iframes and try multiple selectors
 * (name attribute, autocomplete, placeholder, aria-label). First visible
 * match wins.
 */
async function fillStripeElement(
  page: Page,
  candidates: {
    names: string[];
    autocomplete?: string;
    placeholder?: string;
    ariaLabel?: string | RegExp;
  },
  value: string
) {
  const max = 12;
  for (let i = 0; i < max; i++) {
    const frame: FrameLocator = page.frameLocator(
      `iframe[name^="__privateStripeFrame"] >> nth=${i}`
    );
    const selectors: string[] = [
      ...candidates.names.map((n) => `input[name="${n}"]`),
      ...(candidates.autocomplete ? [`input[autocomplete="${candidates.autocomplete}"]`] : []),
      ...(candidates.placeholder ? [`input[placeholder="${candidates.placeholder}"]`] : []),
    ];
    for (const sel of selectors) {
      const input = frame.locator(sel);
      if (await input.isVisible({ timeout: 600 }).catch(() => false)) {
        await input.fill(value);
        return true;
      }
    }
    if (candidates.ariaLabel) {
      const input = frame.getByRole("textbox", { name: candidates.ariaLabel });
      if (await input.isVisible({ timeout: 600 }).catch(() => false)) {
        await input.fill(value);
        return true;
      }
    }
  }
  return false;
}

async function completeStripeCheckout(page: Page) {
  // Step 1 — billing details (required before the Stripe Payment Element
  // mounts; create-payment-intent is called when "Continue to payment" is
  // clicked, and only then does Elements render).
  await page.locator("#customerName").fill("E2E Test User");
  await page.locator("#line1").fill("1 Test Street");
  await page.locator("#city").fill("London");
  await page.locator("#state").fill("London");
  await page.locator("#postal_code").fill("EC1A 1BB");
  // Country defaults to "IN"; switch to GB so address validation matches GBP plan.
  await page.locator("#country").fill("GB");

  await page.getByRole("button", { name: /continue to payment/i }).click();

  // Step 2 — wait for Elements to mount, then fill card.
  await page.waitForSelector('iframe[name^="__privateStripeFrame"]', { timeout: 30_000 });
  // Settling delay — iframes can mount before their inputs are interactive.
  await page.waitForTimeout(3_000);

  const filledCard = await fillStripeElement(
    page,
    {
      names: ["number", "cardnumber"],
      autocomplete: "cc-number",
      placeholder: "1234 1234 1234 1234",
      ariaLabel: /card number/i,
    },
    TEST_CARD
  );
  if (!filledCard) throw new Error("Stripe Elements: card number field not found across all candidate iframes");

  await fillStripeElement(
    page,
    {
      names: ["expiry", "exp-date"],
      autocomplete: "cc-exp",
      placeholder: "MM / YY",
      ariaLabel: /expiration|expiry/i,
    },
    "1234"
  );

  await fillStripeElement(
    page,
    {
      names: ["cvc"],
      autocomplete: "cc-csc",
      placeholder: "CVC",
      ariaLabel: /cvc|security code/i,
    },
    "123"
  );

  // Postal is optional in some layouts (PaymentElement may show it, may not).
  await fillStripeElement(
    page,
    {
      names: ["postalCode", "postal"],
      autocomplete: "postal-code",
      placeholder: "EC1A 1BB",
      ariaLabel: /postal|zip/i,
    },
    "EC1A 1BB"
  ).catch(() => undefined);

  // Pay button: GBP env shows "Pay £14.99"; USD env (legacy) shows "Pay $14.99".
  await page.getByRole("button", { name: /^pay (£|\$)/i }).click();

  // Indian Stripe accounts trigger an RBI e-mandate consent screen
  // ("Securely save your card with Visa") between payment submit and
  // confirmation. It renders inside one of the Stripe iframes; if we don't
  // click through, the payment never completes and the webhook never fires.
  // Best-effort: poll all candidate iframes for ~10s for the consent button.
  // If it never appears (UK/US accounts, or already-consented customer),
  // skip silently — the payment is going through normally.
  const consentDeadline = Date.now() + 10_000;
  while (Date.now() < consentDeadline) {
    let clicked = false;
    for (let i = 0; i < 12; i++) {
      const frame = page.frameLocator(`iframe[name^="__privateStripeFrame"] >> nth=${i}`);
      const btn = frame.getByRole("button", { name: /securely save my card|save and continue|continue/i });
      if (await btn.isVisible({ timeout: 400 }).catch(() => false)) {
        await btn.click().catch(() => undefined);
        clicked = true;
        break;
      }
    }
    if (clicked) break;
    await page.waitForTimeout(500);
  }
}

async function waitForChannelCount(page: Page, expectedAtLeast: number, timeoutMs = 150_000) {
  // The dashboard fetches /api/channels client-side. We poll the API directly
  // because the dashboard requires currentUser.isSubscribed to be true before
  // it renders the list, and that flips on a separate /api/users/me cycle.
  const start = Date.now();
  let lastSeen = 0;
  while (Date.now() - start < timeoutMs) {
    const res = await page.request.get("/api/channels");
    if (res.ok()) {
      const data = (await res.json()) as { channels?: Array<{ id: string; state: string }> };
      const count = data.channels?.length ?? 0;
      lastSeen = count;
      if (count >= expectedAtLeast) return data.channels ?? [];
    }
    await page.waitForTimeout(2_000);
  }

  // Failure diagnostic: surface server-side state so the next debugging step
  // is "look at the dev server log + stripe listen", not "rerun the test".
  const channelsRes = await page.request.get("/api/channels");
  const channelsBody = await channelsRes.text().catch(() => "(read failed)");
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${expectedAtLeast} channel(s). ` +
      `Last seen count: ${lastSeen}. /api/channels body: ${channelsBody.slice(0, 800)}\n\n` +
      `Likely causes if this hits on the SECOND channel specifically:\n` +
      `  1. Stripe has not fired invoice.paid for the proration. Check the\n` +
      `     terminal running \`stripe listen\` for events between modal submit\n` +
      `     and now — you should see invoice.created → invoice.finalized →\n` +
      `     invoice.payment_succeeded → invoice.paid.\n` +
      `  2. Webhook ran but the subsequent-channel branch in\n` +
      `     app/api/webhooks/stripe/route.ts did not pick up the\n` +
      `     PendingChannelRequest. Check the dev server log for\n` +
      `     "Subsequent channel created from pending".\n` +
      `  3. Stripe has no default payment method on the customer, so the\n` +
      `     proration invoice is open/unpaid. Check Stripe dashboard →\n` +
      `     Customers → latest test customer → Invoices.\n`
  );
}

async function refreshUserStateInBrowser(page: Page) {
  // The dashboard only refreshes /api/users/me into Redux when navigated
  // to with ?payment=success or ?welcome=true. Without that param the
  // browser keeps the stale signup-time user (isSubscribed: false) and
  // "Create channel" toasts "Subscription Required".
  //
  // Wait for the dashboard's useEffect to pick up the welcome flag, fetch
  // /api/users/me, and write the refreshed user to localStorage.
  await page.goto("/dashboard?welcome=true");
  await page.waitForFunction(
    () => {
      try {
        const raw = window.localStorage.getItem("user");
        if (!raw) return false;
        const u = JSON.parse(raw) as { isSubscribed?: boolean };
        return u.isSubscribed === true;
      } catch {
        return false;
      }
    },
    null,
    { timeout: 30_000 }
  );
}

async function addSecondChannelWithPicture(page: Page, otherUserPhone: string) {
  await refreshUserStateInBrowser(page);

  await page.getByRole("button", { name: /create channel/i }).first().click();

  // Wait for the modal dialog to appear, then scope selectors to it.
  // The modal's PhoneInput doesn't set a placeholder, so getByPlaceholder
  // would match the signup page's input instead. Scoping to the dialog +
  // input[type="tel"] is reliable.
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });

  const phoneInput = dialog.locator('input[type="tel"]');
  await phoneInput.click();
  await phoneInput.fill(otherUserPhone);

  // Picture Sharing card is a div with onClick toggling state.
  await dialog.getByText("Picture Sharing Add-on").click();

  // Submit. Button text is "Create Channel & Start Bridge".
  await dialog
    .getByRole("button", { name: /create channel.*bridge|start bridge|^create$/i })
    .click();

  // For subsequent channels the modal stays open in "Payment Processing"
  // state while the second invoice.paid webhook fires. The next
  // waitForChannelCount in the spec will pick up the new channel.
}

async function loginAsSuperAdmin(page: Page) {
  await page.goto("/admin/login");
  // Admin login uses email + password.
  await page.locator('input[type="email"], input[name="email"]').first().fill(SUPER_ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(SUPER_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).first().click();
  await page.waitForURL(/\/admin|\/dashboard/, { timeout: 15_000 });
}

async function readChannelStateFromAdmin(page: Page, channelId: string): Promise<string> {
  const res = await page.request.get(`/api/admin/channels/${channelId}/detail`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { state: string };
  return body.state;
}

// ──────────────────────────────────────────────────────────────────────
// The journey
// ──────────────────────────────────────────────────────────────────────

// TODO: rewrite this test to drive Stripe Checkout's hosted page. We
// switched off client-side Elements per Craig's Stripe Developer Handover
// (Doc 3) on 2026-05-22 — Checkout redirects to checkout.stripe.com which
// Playwright can navigate but the iframe selectors and fill-helpers below
// are obsolete. Skipping until the hosted-Checkout flow is wired in.
test.skip("subscription journey: signup → buy core → buy core+addon → admin cancels → view-only", async ({
  browser,
}) => {
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();

  const phone = randomUkPhone();
  const email = randomEmail("e2e-user");
  const name = "E2E User";
  const otherUserPhone = randomUkPhone();

  await test.step("Sign up new user (OTP bypass)", async () => {
    await fillSignupForm(userPage, { name, email, phone });
    await submitOtp(userPage);
  });

  await test.step("Pick Standard plan and complete checkout", async () => {
    await pickPlan(userPage, "Standard");
    await completeStripeCheckout(userPage);
  });

  await test.step("First channel arrives via invoice.paid webhook", async () => {
    const channels = await waitForChannelCount(userPage, 1);
    expect(channels.length).toBeGreaterThanOrEqual(1);
  });

  await test.step("Add a second channel with Picture Sharing", async () => {
    await addSecondChannelWithPicture(userPage, otherUserPhone);
  });

  await test.step("Second channel arrives", async () => {
    await waitForChannelCount(userPage, 2);
  });

  // Capture channel ids for the admin step.
  const allChannels = await waitForChannelCount(userPage, 2);
  expect(allChannels.length).toBeGreaterThanOrEqual(2);
  const channelToCancel = allChannels[0].id;

  // Admin context (separate cookies).
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  await test.step("Super-admin logs in", async () => {
    await loginAsSuperAdmin(adminPage);
  });

  await test.step("Admin opens channel detail and clicks Cancel", async () => {
    const before = await readChannelStateFromAdmin(adminPage, channelToCancel);
    expect(["active", "trial"]).toContain(before);

    await adminPage.goto(`/admin/channels/${channelToCancel}`);
    await adminPage.getByRole("button", { name: /^cancel$/i }).click();
    // Wait for the PATCH to settle.
    await adminPage.waitForResponse((res) =>
      res.url().includes(`/api/admin/channels/${channelToCancel}`) && res.request().method() === "PATCH"
    );
  });

  await test.step("Channel state is now view_only", async () => {
    const after = await readChannelStateFromAdmin(adminPage, channelToCancel);
    expect(after).toBe("view_only");
  });

  await userContext.close();
  await adminContext.close();
});
