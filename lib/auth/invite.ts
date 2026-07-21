import crypto from "crypto";

const INVITE_TOKEN_LENGTH = 32;
const INVITE_EXPIRY_HOURS = 72;

export function generateInviteToken(): string {
  return crypto.randomBytes(INVITE_TOKEN_LENGTH).toString("hex");
}

export function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyInviteTokenHash(token: string, hashedToken: string): boolean {
  return hashInviteToken(token) === hashedToken;
}

export function getInviteExpiry(hours: number = INVITE_EXPIRY_HOURS): Date {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date;
}

export function isInviteExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

export function generateInviteLink(
  token: string,
  channelId: string,
  baseUrl?: string
): string {
  const base = baseUrl || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}/invite/accept?token=${token}&channelId=${channelId}`;
}
