import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, PendingChannelRequest, AuditLog } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;
  if (!since || Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "since query param required (ISO date)" }, { status: 400 });
  }

  try {
    await connectDB();
    const userId = new mongoose.Types.ObjectId(payload.userId);

    const newChannel = await Channel.findOne({
      users: userId,
      createdAt: { $gt: since },
      state: { $nin: ["closed"] },
    })
      .select("_id clanchaNumber name state pictureShareEnabled emergencyBypassEnabled createdAt")
      .sort({ createdAt: -1 })
      .lean();

    if (newChannel) {
      return NextResponse.json({
        status: "completed",
        channel: {
          id: newChannel._id.toString(),
          clanchaNumber: newChannel.clanchaNumber,
          name: newChannel.name ?? null,
          state: newChannel.state,
          pictureShareEnabled: newChannel.pictureShareEnabled,
          emergencyBypassEnabled: newChannel.emergencyBypassEnabled,
          createdAt: newChannel.createdAt,
        },
      });
    }

    const failure = await AuditLog.findOne({
      action: "channel_creation_payment_failed",
      actorUserId: userId,
      createdAt: { $gt: since },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (failure) {
      const meta = failure.metadata as { hostedInvoiceUrl?: string | null } | undefined;
      return NextResponse.json({
        status: "failed",
        error:
          "Your payment was declined. Update your payment method to try again.",
        hostedInvoiceUrl: meta?.hostedInvoiceUrl ?? null,
      });
    }

    const stillPending = await PendingChannelRequest.exists({ userId });
    if (stillPending) {
      return NextResponse.json({ status: "pending" });
    }

    return NextResponse.json({ status: "unknown" });
  } catch (error) {
    console.error("pending-status error:", error);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
