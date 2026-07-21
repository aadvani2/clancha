import crypto from "crypto";
import { JoinToken } from "@/lib/db/models/joinToken";
import type { Types } from "mongoose";

/**
 * Join tokens ride inside the A1 SMS, so length is money: the old 64-hex-char
 * token made A1 our single most expensive message (Craig, M4 feedback
 * 05/07/26 §1.3). 11 base-62 chars ≈ 65 bits of entropy — plenty for a
 * single-use, SHA-256-hashed token whose claim flow is additionally gated by
 * an SMS OTP to the recipient's own phone.
 */
const JOIN_TOKEN_LENGTH = 11;
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateJoinToken(): string {
  let out = "";
  while (out.length < JOIN_TOKEN_LENGTH) {
    const bytes = crypto.randomBytes(JOIN_TOKEN_LENGTH * 2);
    for (const b of bytes) {
      // 248 = 62 * 4; reject 248-255 to avoid modulo bias.
      if (b < 248 && out.length < JOIN_TOKEN_LENGTH) out += BASE62[b % 62];
    }
  }
  return out;
}

export function hashJoinToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function buildJoinLink(token: string, baseUrl: string): string {
  // Short path: /j/<token> (redirects to /join?t=<token>). Old-format
  // /join?t=... links already in the wild keep working unchanged.
  return `${baseUrl.replace(/\/$/, "")}/j/${token}`;
}

/**
 * Create a join token for a given (user, channel) pair. Idempotent — if an
 * unconsumed token already exists for that pair, return its plaintext value
 * is NOT possible (we only store the hash), so we always issue a new token
 * and let any old unconsumed token sit unused. A1 will rarely fire twice for
 * the same recipient/channel anyway; the gate at the call site is "no prior
 * delivered inbound on this channel".
 */
export async function createJoinTokenForUserChannel(
  userId: Types.ObjectId | string,
  channelId: Types.ObjectId | string
): Promise<string> {
  const token = generateJoinToken();
  const tokenHash = hashJoinToken(token);
  await JoinToken.create({ tokenHash, userId, channelId });
  return token;
}
