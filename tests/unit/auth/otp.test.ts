import { describe, it, expect } from "vitest";
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpHash,
  getOtpExpiry,
} from "@/lib/auth/otp";

describe("OTP utilities", () => {
  describe("generateOtpCode", () => {
    it("should generate a 6-digit code", () => {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    });

    it("should generate different codes on each call", () => {
      const codes = new Set(Array.from({ length: 10 }, () => generateOtpCode()));
      expect(codes.size).toBeGreaterThan(1);
    });

    it("should pad codes with leading zeros when needed", () => {
      const codes = Array.from({ length: 100 }, () => generateOtpCode());
      codes.forEach((code) => {
        expect(code.length).toBe(6);
      });
    });
  });

  describe("hashOtpCode", () => {
    it("should return a hex string", () => {
      const hash = hashOtpCode("123456");
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it("should produce consistent hashes for same input", () => {
      const hash1 = hashOtpCode("123456");
      const hash2 = hashOtpCode("123456");
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = hashOtpCode("123456");
      const hash2 = hashOtpCode("654321");
      expect(hash1).not.toBe(hash2);
    });

    it("should produce a 64-character SHA-256 hash", () => {
      const hash = hashOtpCode("123456");
      expect(hash.length).toBe(64);
    });
  });

  describe("verifyOtpHash", () => {
    it("should return true for matching code and hash", () => {
      const code = "123456";
      const hash = hashOtpCode(code);
      expect(verifyOtpHash(code, hash)).toBe(true);
    });

    it("should return false for non-matching code", () => {
      const hash = hashOtpCode("123456");
      expect(verifyOtpHash("654321", hash)).toBe(false);
    });

    it("should return false for empty code", () => {
      const hash = hashOtpCode("123456");
      expect(verifyOtpHash("", hash)).toBe(false);
    });
  });

  describe("getOtpExpiry", () => {
    it("should return a date in the future", () => {
      const expiry = getOtpExpiry();
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
    });

    it("should return a date approximately 10 minutes in the future", () => {
      const before = Date.now();
      const expiry = getOtpExpiry();
      const after = Date.now();
      const tenMinutes = 10 * 60 * 1000;
      expect(expiry.getTime() - before).toBeGreaterThanOrEqual(tenMinutes - 100);
      expect(expiry.getTime() - after).toBeLessThanOrEqual(tenMinutes + 100);
    });
  });
});
