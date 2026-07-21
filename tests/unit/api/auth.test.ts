import {
  describe, it, expect, vi, beforeAll, afterAll, afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import {
  setupTestDatabase, teardownTestDatabase, clearTestDatabase,
} from "@/tests/helpers/db";
import { User } from "@/lib/db/models";
import { createUserData, generatePhone } from "@/tests/helpers/fixtures";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@/lib/db/connect", () => ({ default: vi.fn() }));

const mockSendVerification = vi.fn();
const mockCheckVerification = vi.fn();

vi.mock("@/lib/auth/twilio-verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/twilio-verify")>();
  return {
    ...real,
    sendVerificationWithTwilioVerify: mockSendVerification,
    checkVerificationWithTwilioVerify: mockCheckVerification,
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeSendOtpRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/auth/send-otp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeVerifyOtpRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function callSendOtp(body: object) {
  const { POST } = await import("@/app/api/auth/send-otp/route");
  return POST(makeSendOtpRequest(body));
}

async function callVerifyOtp(body: object) {
  const { POST } = await import("@/app/api/auth/verify-otp/route");
  return POST(makeVerifyOtpRequest(body));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/send-otp", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("returns 400 when phone is missing", async () => {
    const res = await callSendOtp({});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/phone/i);
  });

  it("returns 400 when phone is invalid", async () => {
    const res = await callSendOtp({ phone: "not-a-phone" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid/i);
  });

  it("returns 404 in login mode when user does not exist", async () => {
    const res = await callSendOtp({ phone: "+15551234567", mode: "login" });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/no account/i);
  });

  it("returns 400 in signup mode when user already exists", async () => {
    const phone = "+15551112222";
    await User.create({ ...createUserData({ phone }) });
    mockSendVerification.mockResolvedValue(undefined);

    const res = await callSendOtp({ phone, mode: "signup" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/already exists/i);
  });

  it("sends OTP and returns 200 in login mode for existing user", async () => {
    const phone = "+15553334444";
    await User.create({ ...createUserData({ phone }) });
    mockSendVerification.mockResolvedValue(undefined);

    const res = await callSendOtp({ phone, mode: "login" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockSendVerification).toHaveBeenCalledOnce();
  });

  it("sends OTP and returns 200 in signup mode for new phone", async () => {
    mockSendVerification.mockResolvedValue(undefined);

    const res = await callSendOtp({ phone: "+15555556666", mode: "signup" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockSendVerification).toHaveBeenCalledOnce();
  });

  it("sends OTP without mode restriction when no mode is specified", async () => {
    mockSendVerification.mockResolvedValue(undefined);

    const res = await callSendOtp({ phone: "+15557778888" });
    expect(res.status).toBe(200);
    expect(mockSendVerification).toHaveBeenCalledOnce();
  });

  it("returns 500 when Twilio throws an error", async () => {
    const phone = "+15551234567";
    await User.create({ ...createUserData({ phone }) });
    mockSendVerification.mockRejectedValue(new Error("Twilio error"));

    const res = await callSendOtp({ phone, mode: "login" });
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/verify-otp", () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  afterEach(async () => { await clearTestDatabase(); vi.clearAllMocks(); vi.resetModules(); });

  it("returns 400 when phone is missing", async () => {
    const res = await callVerifyOtp({ code: "123456" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when code is missing", async () => {
    const res = await callVerifyOtp({ phone: "+15551234567" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when OTP code is invalid", async () => {
    mockCheckVerification.mockResolvedValue(false);

    const res = await callVerifyOtp({ phone: "+15551234567", code: "000000" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid|expired/i);
  });

  it("creates a new user and returns JWT token on first login", async () => {
    const phone = "+15559990001";
    mockCheckVerification.mockResolvedValue(true);

    const res = await callVerifyOtp({
      phone,
      code: "123456",
      name: "Test User",
      email: "test@example.com",
      mode: "signup",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
    expect(data.user.phone).toContain("15559990001");
    expect(data.user.email).toBe("test@example.com");

    // User was persisted in DB (phone stored with + for consistency with channel-created users)
    const user = await User.findOne({ email: "test@example.com" });
    expect(user).toBeTruthy();
    expect(user!.name).toBe("Test User");

    // JWT cookie set
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("token=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("logs in an existing user without creating a duplicate", async () => {
    // The verify-otp route looks up by phone (with or without +).
    const normalizedPhone = "15559990002";
    const existingUser = await User.create({ phone: `+${normalizedPhone}`, role: "user" });
    mockCheckVerification.mockResolvedValue(true);

    const res = await callVerifyOtp({ phone: `+${normalizedPhone}`, code: "123456", mode: "login" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.phone).toContain(normalizedPhone);

    const userCount = await User.countDocuments({ $or: [{ phone: normalizedPhone }, { phone: `+${normalizedPhone}` }] });
    expect(userCount).toBe(1);

    const token = data.token;
    expect(token).toBeDefined();
    const { verifyToken } = await import("@/lib/auth/jwt");
    const payload = verifyToken(token);
    expect(payload?.userId).toBe(existingUser._id.toString());
  });

  it("updates email on existing user when email is supplied and not already set", async () => {
    const normalizedPhone = "15559990003";
    await User.create({ phone: `+${normalizedPhone}`, role: "user" });
    mockCheckVerification.mockResolvedValue(true);

    const res = await callVerifyOtp({
      phone: `+${normalizedPhone}`,
      code: "123456",
      email: "newemail@example.com",
      mode: "login",
    });
    expect(res.status).toBe(200);

    const user = await User.findOne({ $or: [{ phone: normalizedPhone }, { phone: `+${normalizedPhone}` }] });
    expect(user!.email).toBe("newemail@example.com");
  });

  it("returns 400 when email is already in use by another account", async () => {
    const sharedEmail = "shared@example.com";
    // Create an existing user that already owns this email
    await User.create({ phone: "15559990010", email: sharedEmail, role: "user" });
    // A second user without that email
    const normalizedPhone2 = "15559990004";
    await User.create({ phone: normalizedPhone2, role: "user" });
    mockCheckVerification.mockResolvedValue(true);

    const res = await callVerifyOtp({
      phone: `+${normalizedPhone2}`,
      code: "123456",
      email: sharedEmail,
      mode: "login",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/already in use/i);
  });

  it("returns user object with correct role field", async () => {
    const normalizedPhone = "15559990005";
    await User.create({ phone: `+${normalizedPhone}`, role: "moderator" });
    mockCheckVerification.mockResolvedValue(true);

    const res = await callVerifyOtp({ phone: `+${normalizedPhone}`, code: "123456", mode: "login" });
    const data = await res.json();
    expect(data.user.role).toBe("moderator");
  });

  it("returns 404 when mode is login and no account exists", async () => {
    mockCheckVerification.mockResolvedValue(true);

    const res = await callVerifyOtp({
      phone: "+15559999999",
      code: "123456",
      mode: "login",
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/no account|sign up/i);

    const userCount = await User.countDocuments({});
    expect(userCount).toBe(0);
  });
});
