import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — browser-driven E2E tests.
 *
 * Vitest covers API-layer integration tests under tests/. Playwright lives
 * in /e2e and drives the actual UI. Two reasons to keep them separate:
 *  - Different runners, different conventions.
 *  - Vitest tests run mocked DB (`tests/setup.ts`); Playwright must hit the
 *    real running app.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 180_000, // payment + webhook flows can be slow
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile-pixel",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "chromium-mobile-iphone",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
