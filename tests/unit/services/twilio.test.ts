import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Twilio service", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("getTwilioClient", () => {
    it("should return null when credentials are not configured", async () => {
      const originalSid = process.env.TWILIO_ACCOUNT_SID;
      const originalToken = process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;

      vi.resetModules();
      const { getTwilioClient } = await import("@/lib/services/twilio");
      const client = getTwilioClient();
      expect(client).toBeNull();

      process.env.TWILIO_ACCOUNT_SID = originalSid;
      process.env.TWILIO_AUTH_TOKEN = originalToken;
    });

    it("should check for credentials before creating client", async () => {
      // Twilio requires account SID to start with 'AC'
      process.env.TWILIO_ACCOUNT_SID = "ACtest1234567890123456789012345678";
      process.env.TWILIO_AUTH_TOKEN = "test-token";
      vi.resetModules();
      const { getTwilioClient } = await import("@/lib/services/twilio");
      const client = getTwilioClient();
      expect(client).not.toBeNull();
    });
  });

  describe("getTwilioVoiceUrl", () => {
    it("should return correct voice message URL", async () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://test.example.com";
      vi.resetModules();
      const { getTwilioVoiceUrl } = await import("@/lib/services/twilio");
      const url = getTwilioVoiceUrl();
      expect(url).toBe("https://test.example.com/api/webhooks/twilio/voice-message");
    });

    it("should use default URL when env var is not set", async () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      vi.resetModules();
      const { getTwilioVoiceUrl } = await import("@/lib/services/twilio");
      const url = getTwilioVoiceUrl();
      expect(url).toBe("https://example.com/api/webhooks/twilio/voice-message");
    });
  });
});
