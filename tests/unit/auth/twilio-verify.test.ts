import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkVerificationWithTwilioVerify,
  sendVerificationWithTwilioVerify,
} from "@/lib/auth/twilio-verify";

const { twilioFactory } = vi.hoisted(() => ({
  twilioFactory: vi.fn(),
}));

vi.mock("twilio", () => ({
  default: twilioFactory,
}));

describe("Twilio Verify helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    twilioFactory.mockReset();
  });

  it("skips Twilio when sending in OTP bypass mode", async () => {
    vi.stubEnv("OTP_TEST_BYPASS_CODE", "000000");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await sendVerificationWithTwilioVerify("+447476626433");

    expect(twilioFactory).not.toHaveBeenCalled();
  });

  it("accepts the configured bypass code without calling Twilio", async () => {
    vi.stubEnv("OTP_TEST_BYPASS_CODE", "000000");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      checkVerificationWithTwilioVerify("+447476626433", " 000000 ")
    ).resolves.toBe(true);

    expect(twilioFactory).not.toHaveBeenCalled();
  });

  it("rejects other codes in bypass mode without calling Twilio", async () => {
    vi.stubEnv("OTP_TEST_BYPASS_CODE", "000000");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      checkVerificationWithTwilioVerify("+447476626433", "123456")
    ).resolves.toBe(false);

    expect(twilioFactory).not.toHaveBeenCalled();
  });
});
