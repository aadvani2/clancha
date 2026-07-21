import { describe, it, expect, afterEach } from "vitest";
import {
  isTestEnvironment,
  resetAllTestData,
  deleteUserCascade,
  NotTestEnvironmentError,
} from "@/lib/services/testReset";

// The single safety invariant behind the test-data reset: it must only ever be
// possible against a Stripe TEST account, never live. These tests pin the
// guard, including that the destructive functions refuse before touching the
// database when the environment isn't a test one.

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
});

describe("testReset – environment guard", () => {
  it("treats an sk_test_ key as a test environment", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    expect(isTestEnvironment()).toBe(true);
  });

  it("treats an sk_live_ key as NOT a test environment", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    expect(isTestEnvironment()).toBe(false);
  });

  it("treats a missing key as NOT a test environment", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(isTestEnvironment()).toBe(false);
  });

  it("refuses a full reset against a live key (before any DB access)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    await expect(resetAllTestData()).rejects.toBeInstanceOf(NotTestEnvironmentError);
  });

  it("refuses a user delete against a live key (before any DB access)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    await expect(
      deleteUserCascade("000000000000000000000000")
    ).rejects.toBeInstanceOf(NotTestEnvironmentError);
  });
});
