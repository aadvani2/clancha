import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Message, Channel, User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { processRewritingMessage } from "@/lib/services/rewritePipeline";
import { isWithinReceivingHours, getInitialMessageState } from "@/lib/utils/routing";
import type { Types } from "mongoose";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    const body = await request.json();
    const { channelId, text } = body;

    if (!channelId || typeof channelId !== "string") {
      return NextResponse.json(
        { error: "channelId is required" },
        { status: 400 }
      );
    }
    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }

    await connectDB();

    const channel = await Channel.findById(channelId).lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    if (channel.state === "view_only" || channel.state === "closed") {
      return NextResponse.json(
        { error: "Cannot send messages in this channel" },
        { status: 403 }
      );
    }

    const userIdStr = payload.userId;
    const isMember = (channel.users as Types.ObjectId[]).some(
      (id) => id.toString() === userIdStr
    );
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const recipientUserId = (channel.users as Types.ObjectId[]).find(
      (id) => id.toString() !== userIdStr
    );
    if (!recipientUserId) {
      return NextResponse.json({ error: "No recipient in channel" }, { status: 400 });
    }

    // const recipientPrefs = await UserChannelPreferences.findOne({
    //   userId: recipientUserId,
    //   channelId: channel._id,
    // }).lean();

    const receiver = await User.findById(recipientUserId).lean();

    // CHANNEL IS THE ABSOLUTE SOURCE OF TRUTH:
    // If channel receiving hours are null, it means ALWAYS OPEN (24/7).
    // We ignore recipient personal preferences to ensure symmetry within the channel.
    const hStart = receiver?.receivingHoursStart ?? null;
    const hEnd = receiver?.receivingHoursEnd ?? null;

    const withinHours = isWithinReceivingHours({
      receivingHoursStart: hStart,
      receivingHoursEnd: hEnd,
      timezone: receiver?.timezone ?? "Europe/London",
    });

    const decision = getInitialMessageState(
      text.trim(),
      channel.emergencyBypassEnabled,
      withinHours
    );

    // ── Emergency Trigger Detection ───────────────────────────────────────────
    if (decision.isTrigger) {
      if (channel.emergencyBypassEnabled) {
        const lastQueued = await Message.findOne({
          channelId: channel._id,
          senderId: userIdStr,
          state: "queued"
        }).sort({ createdAt: -1 });

        if (lastQueued) {
          lastQueued.state = "rewriting";
          lastQueued.isEmergency = true; // Still marked as emergency, but will be rewritten by processing
          await lastQueued.save();
          
          // Trigger the rewrite and delivery pipeline
          await processRewritingMessage(lastQueued._id.toString());
          
          return NextResponse.json({
            trigger: true,
            success: true,
            message: "Emergency message delivered successfully",
          });
        }
        return NextResponse.json({
          trigger: true,
          success: false,
          error: "No pending messages to deliver",
        });
      }
      return NextResponse.json({
        trigger: true,
        success: false,
        error: "Emergency bypass is not enabled for this channel",
      });
    }

    const newMessage = await Message.create({
      channelId: channel._id,
      senderId: userIdStr,
      originalText: text.trim(),
      rewrittenText: text.trim(),
      state: decision.state,
      isEmergency: decision.isEmergency,
    });

    if (decision.state === "rewriting") {
      await processRewritingMessage(newMessage._id.toString());
    }

    const updated = await Message.findById(newMessage._id).lean();
    return NextResponse.json({
      id: updated!._id.toString(),
      channelId: updated!.channelId.toString(),
      senderId: updated!.senderId ? updated!.senderId.toString() : null,
      originalText: updated!.originalText,
      rewrittenText: updated!.rewrittenText,
      state: updated!.state,
      isEmergency: updated!.isEmergency,
      deliveredAt: updated!.deliveredAt ?? null,
      createdAt: updated!.createdAt,
    });
  } catch (error) {
    console.error("messages/send error:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
