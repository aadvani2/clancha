import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { JoinToken, User, Channel } from "@/lib/db/models";
import { hashJoinToken } from "@/lib/auth/joinToken";

function maskPhone(phone: string): string {
  if (!phone) return "***";
  return phone.length >= 4 ? `***${phone.slice(-4)}` : "***";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  // Tokens are 11-char base62 short codes since the M4 05/07/26 feedback
  // (§1.3 — short A1 links); older 64-hex tokens still in the wild also pass.
  if (!token || typeof token !== "string" || token.length < 8) {
    return NextResponse.json(
      { status: "invalid", reason: "missing or malformed token" },
      { status: 400 }
    );
  }

  await connectDB();

  const tokenHash = hashJoinToken(token);
  const record = await JoinToken.findOne({ tokenHash }).lean();
  if (!record) {
    return NextResponse.json({ status: "invalid" }, { status: 404 });
  }

  if (record.consumedAt) {
    return NextResponse.json({ status: "consumed" });
  }

  const [recipient, channel] = await Promise.all([
    User.findById(record.userId).select("phone name").lean(),
    Channel.findById(record.channelId).select("users state clanchaNumber").lean(),
  ]);

  if (!recipient || !channel) {
    return NextResponse.json({ status: "invalid" }, { status: 404 });
  }

  if (channel.state === "closed") {
    return NextResponse.json({ status: "channel_closed" });
  }

  // Inviter = the other user on the channel (channel.users always has exactly
  // two entries; the recipient is record.userId, so the other one is inviter).
  const inviterId = channel.users.find(
    (u) => u.toString() !== record.userId.toString()
  );
  const inviter = inviterId
    ? await User.findById(inviterId).select("name").lean()
    : null;

  return NextResponse.json({
    status: "ok",
    phoneMasked: maskPhone(recipient.phone),
    inviterName:
      (typeof inviter?.name === "string" && inviter.name.trim()) ||
      "another Clancha user",
    recipientName:
      (typeof recipient.name === "string" && recipient.name.trim()) || null,
    channelId: record.channelId.toString(),
  });
}
