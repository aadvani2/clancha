import { describe, it, expect } from "vitest";
import { signToken, verifyToken, type JwtPayload } from "@/lib/auth/jwt";

describe("JWT utilities", () => {
  const testPayload: Omit<JwtPayload, "iat" | "exp"> = {
    userId: "user123",
    phone: "+15551234567",
    role: "user",
  };

  describe("signToken", () => {
    it("should create a valid JWT token", () => {
      const token = signToken(testPayload);
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);
    });

    it("should include payload data in token", () => {
      const token = signToken(testPayload);
      const decoded = verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.userId).toBe(testPayload.userId);
      expect(decoded?.phone).toBe(testPayload.phone);
      expect(decoded?.role).toBe(testPayload.role);
    });
  });

  describe("verifyToken", () => {
    it("should return payload for valid token", () => {
      const token = signToken(testPayload);
      const decoded = verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.userId).toBe(testPayload.userId);
    });

    it("should return null for invalid token", () => {
      const decoded = verifyToken("invalid.token.here");
      expect(decoded).toBeNull();
    });

    it("should return null for empty token", () => {
      const decoded = verifyToken("");
      expect(decoded).toBeNull();
    });

    it("should return null for malformed token", () => {
      const decoded = verifyToken("not-a-jwt");
      expect(decoded).toBeNull();
    });

    it("should include iat and exp in decoded payload", () => {
      const token = signToken(testPayload);
      const decoded = verifyToken(token);
      expect(decoded?.iat).toBeDefined();
      expect(decoded?.exp).toBeDefined();
      expect(typeof decoded?.iat).toBe("number");
      expect(typeof decoded?.exp).toBe("number");
    });
  });
});
