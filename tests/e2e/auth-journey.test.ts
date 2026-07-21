/**
 * E2E Journey: Authentication
 *
 * Tests the complete sign-up and login flows through the API layer,
 * including OTP sending, verification, JWT issuance, and user creation.
 */
import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User } from "@/lib/db/models";
import { verifyToken } from "@/lib/auth/jwt";

vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

const mockSendOtp = vi.fn().mockResolvedValue(undefined);
const mockCheckOtp = vi.fn();

vi.mock("@/lib/auth/twilio-verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/twilio-verify")>();
  return {
    ...real,
    sendVerificationWithTwilioVerify: mockSendOtp,
    checkVerificationWithTwilioVerify: mockCheckOtp,
  };
});

function makeSendOtpReq(body: object) {
  return new NextRequest("http://localhost/api/auth/send-otp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeVerifyOtpReq(body: object) {
  return new NextRequest("http://localhost/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("Journey: New user sign-up", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("completes full sign-up: OTP sent → verified → user created → JWT returned", async () => {
    const phone = "+15551234001";
    const email = "alice@example.com";
    const name = "Alice";

    // Step 1: Request OTP (signup mode)
    const { POST: sendOtpPost } = await import("@/app/api/auth/send-otp/route");
    const sendRes = await sendOtpPost(makeSendOtpReq({ phone, mode: "signup" }));
    expect(sendRes.status).toBe(200);
    expect(mockSendOtp).toHaveBeenCalledWith(phone);

    // Step 2: Verify OTP with correct code
    mockCheckOtp.mockResolvedValue(true);
    const { POST: verifyPost } = await import("@/app/api/auth/verify-otp/route");
    const verifyRes = await verifyPost(makeVerifyOtpReq({
      phone,
      code: "123456",
      email,
      name,
      mode: "signup",
    }));
    expect(verifyRes.status).toBe(200);

    const body = await verifyRes.json();
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();

    // JWT is valid and contains correct user info
    const payload = verifyToken(body.token);
    expect(payload).not.toBeNull();
    expect(payload!.role).toBe("user");
    expect(payload!.phone).toContain(phone.replace("+", ""));

    // User persisted in database
    const user = await User.findOne({ email });
    expect(user).toBeTruthy();
    expect(user!.name).toBe("Alice");
    expect(user!.role).toBe("user");

    // HttpOnly cookie set with token
    const cookie = verifyRes.headers.get("set-cookie");
    expect(cookie).toContain("token=");
    expect(cookie).toContain("HttpOnly");
  });

  it("rejects sign-up OTP request for a phone that is already registered", async () => {
    const phone = "+15551234002";
    await User.create({ phone, role: "user" });

    const { POST: sendOtpPost } = await import("@/app/api/auth/send-otp/route");
    const sendRes = await sendOtpPost(makeSendOtpReq({ phone, mode: "signup" }));
    expect(sendRes.status).toBe(400);
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it("rejects OTP verification with wrong code", async () => {
    const phone = "+15551234003";
    mockCheckOtp.mockResolvedValue(false);

    const { POST: verifyPost } = await import("@/app/api/auth/verify-otp/route");
    const res = await verifyPost(makeVerifyOtpReq({ phone: "+15551234003", code: "000000" }));
    expect(res.status).toBe(400);

    const user = await User.findOne({ phone });
    expect(user).toBeNull();
  });
});

describe("Journey: Returning user login", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("completes full login: OTP sent → verified → JWT returned for existing user", async () => {
    // verify-otp normalizes phone by stripping non-digits before DB lookup.
    // Store the user with the normalized phone so the lookup succeeds.
    const normalizedPhone = "15551235001";
    const existingUser = await User.create({
      phone: normalizedPhone,
      email: "bob@example.com",
      role: "user",
    });
    const phone = `+${normalizedPhone}`;

    // Step 1: Request OTP (login mode)
    const { POST: sendOtpPost } = await import("@/app/api/auth/send-otp/route");
    const sendRes = await sendOtpPost(makeSendOtpReq({ phone, mode: "login" }));
    expect(sendRes.status).toBe(200);
    expect(mockSendOtp).toHaveBeenCalled();

    // Step 2: Verify correct OTP
    mockCheckOtp.mockResolvedValue(true);
    const { POST: verifyPost } = await import("@/app/api/auth/verify-otp/route");
    const verifyRes = await verifyPost(makeVerifyOtpReq({
      phone,
      code: "654321",
      mode: "login",
    }));
    expect(verifyRes.status).toBe(200);

    const body = await verifyRes.json();
    expect(body.token).toBeDefined();

    const payload = verifyToken(body.token);
    expect(payload!.userId).toBe(existingUser._id.toString());

    // No duplicate user created
    const count = await User.countDocuments({ phone: normalizedPhone });
    expect(count).toBe(1);
  });

  it("rejects login OTP request for unregistered phone", async () => {
    const { POST: sendOtpPost } = await import("@/app/api/auth/send-otp/route");
    const res = await sendOtpPost(makeSendOtpReq({ phone: "+15551299999", mode: "login" }));
    expect(res.status).toBe(404);
    expect(mockSendOtp).not.toHaveBeenCalled();
  });
});
