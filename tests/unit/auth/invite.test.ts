import { describe, it, expect } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  verifyInviteTokenHash,
  getInviteExpiry,
  isInviteExpired,
  generateInviteLink,
} from "@/lib/auth/invite";

describe("Invite utilities", () => {
  describe("generateInviteToken", () => {
    it("should generate a 64-character hex token", () => {
      const token = generateInviteToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should generate different tokens on each call", () => {
      const tokens = new Set(
        Array.from({ length: 10 }, () => generateInviteToken())
      );
      expect(tokens.size).toBe(10);
    });
  });

  describe("hashInviteToken", () => {
    it("should return a hex string", () => {
      const hash = hashInviteToken("test-token");
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it("should produce consistent hashes for same input", () => {
      const hash1 = hashInviteToken("test-token");
      const hash2 = hashInviteToken("test-token");
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = hashInviteToken("token1");
      const hash2 = hashInviteToken("token2");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("verifyInviteTokenHash", () => {
    it("should return true for matching token and hash", () => {
      const token = generateInviteToken();
      const hash = hashInviteToken(token);
      expect(verifyInviteTokenHash(token, hash)).toBe(true);
    });

    it("should return false for non-matching token", () => {
      const hash = hashInviteToken("token1");
      expect(verifyInviteTokenHash("token2", hash)).toBe(false);
    });
  });

  describe("getInviteExpiry", () => {
    it("should return a date in the future", () => {
      const expiry = getInviteExpiry();
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
    });

    it("should use default 72 hours expiry", () => {
      const before = Date.now();
      const expiry = getInviteExpiry();
      const after = Date.now();
      const seventyTwoHours = 72 * 60 * 60 * 1000;
      expect(expiry.getTime() - before).toBeGreaterThanOrEqual(
        seventyTwoHours - 1000
      );
      expect(expiry.getTime() - after).toBeLessThanOrEqual(
        seventyTwoHours + 1000
      );
    });

    it("should accept custom hours", () => {
      const before = Date.now();
      const expiry = getInviteExpiry(24);
      const twentyFourHours = 24 * 60 * 60 * 1000;
      expect(expiry.getTime() - before).toBeGreaterThanOrEqual(
        twentyFourHours - 1000
      );
    });
  });

  describe("isInviteExpired", () => {
    it("should return false for future date", () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 1);
      expect(isInviteExpired(futureDate)).toBe(false);
    });

    it("should return true for past date", () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);
      expect(isInviteExpired(pastDate)).toBe(true);
    });
  });

  describe("generateInviteLink", () => {
    it("should generate correct link with token and channelId", () => {
      const link = generateInviteLink(
        "abc123",
        "channel456",
        "https://example.com"
      );
      expect(link).toBe(
        "https://example.com/invite/accept?token=abc123&channelId=channel456"
      );
    });

    it("should use NEXT_PUBLIC_APP_URL when no baseUrl provided", () => {
      const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
      process.env.NEXT_PUBLIC_APP_URL = "https://test.app";
      const link = generateInviteLink("token", "channel");
      expect(link).toBe(
        "https://test.app/invite/accept?token=token&channelId=channel"
      );
      process.env.NEXT_PUBLIC_APP_URL = originalUrl;
    });

    it("should fallback to localhost when no env var", () => {
      const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
      delete process.env.NEXT_PUBLIC_APP_URL;
      const link = generateInviteLink("token", "channel");
      expect(link).toBe(
        "http://localhost:3000/invite/accept?token=token&channelId=channel"
      );
      process.env.NEXT_PUBLIC_APP_URL = originalUrl;
    });
  });
});
