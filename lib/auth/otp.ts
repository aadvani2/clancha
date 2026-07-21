import crypto from "crypto";

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;

export function generateOtpCode(): string {
  const digits = crypto.randomInt(0, Math.pow(10, OTP_LENGTH)).toString();
  return digits.padStart(OTP_LENGTH, "0");
}

export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function verifyOtpHash(code: string, hashedCode: string): boolean {
  return hashOtpCode(code) === hashedCode;
}

export function getOtpExpiry(): Date {
  const date = new Date();
  date.setMinutes(date.getMinutes() + OTP_EXPIRY_MINUTES);
  return date;
}
