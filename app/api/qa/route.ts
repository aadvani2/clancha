import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Message, Channel, User, AuditLog } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { getOpenAIClient } from "@/lib/services/openai";
import { getActivePrompt } from "@/lib/services/promptStore";
import { hasFabricatedQuote, FABRICATION_REFUSAL } from "@/lib/services/qaFabrication";
import type { Types } from "mongoose";

/**
 * Stateless Q&A over rewritten message history for a channel.
 * POST body: { channelId, question }
 *
 * Privacy invariant: only `rewrittenText` is ever read or surfaced. The
 * `originalText` of either user is NEVER fetched (Doc 3 "Portal Message
 * Visibility Rules") so the LLM cannot expose it even if asked.
 *
 * Fabrication invariant: messages are labelled with their speaker in the
 * context, the prompt forbids quotation marks, and the response is
 * post-validated — any quoted substring in the answer must appear verbatim
 * in the context, otherwise the answer is replaced with a neutral refusal
 * and an audit log entry is written. This is the defence Craig flagged in
 * M4 tracker #32/#33 after gpt-5-mini returned an attributed quote that
 * didn't exist in the visible history.
 */

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  try {
    const body = await request.json();
    const { channelId, question } = body;

    if (!channelId || typeof channelId !== "string") {
      return NextResponse.json(
        { error: "channelId is required" },
        { status: 400 }
      );
    }
    if (!question || typeof question !== "string" || !question.trim()) {
      return NextResponse.json(
        { error: "question is required" },
        { status: 400 }
      );
    }

    await connectDB();

    const channel = await Channel.findById(channelId).lean();
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const isMember = (channel.users as Types.ObjectId[]).some(
      (id) => id.toString() === payload.userId
    );
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // System-message scoping (privacy — #33, mirrors the messages route): a
    // system message with a non-null `systemRecipientUserId` is private to that
    // user (e.g. the A1 intro embedding B's join token, A2 queued, A8/A9 image
    // notices). Q&A must never pull one addressed to the OTHER parent into this
    // user's factual context. Non-system messages and genuinely-shared system
    // notices (null/absent recipient) stay in scope.
    const messages = await Message.find({
      channelId,
      state: "delivered",
      $or: [
        { isSystem: { $ne: true } },
        { systemRecipientUserId: null },
        { systemRecipientUserId: { $exists: false } },
        { systemRecipientUserId: payload.userId },
      ],
    })
      .sort({ createdAt: 1 })
      .select("rewrittenText createdAt senderId isSystem")
      .limit(100)
      .lean();

    // Resolve sender display names so the LLM has a stable speaker label per
    // line. Without this the model has to infer who said what from the
    // question text, which is when it confabulates quoted utterances.
    const senderIds = Array.from(
      new Set(
        messages
          .map((m) => (m.senderId ? m.senderId.toString() : null))
          .filter((x): x is string => !!x)
      )
    );
    const senders = senderIds.length
      ? await User.find({ _id: { $in: senderIds } })
          .select("_id name")
          .lean()
      : [];
    const senderNameById = new Map<string, string>();
    for (const u of senders) {
      const n = (u as { name?: string }).name?.trim();
      senderNameById.set(u._id.toString(), n || "Unknown");
    }

    const context = messages
      .map((m) => {
        const ts = new Date(m.createdAt).toISOString();
        const speaker = m.isSystem
          ? "Clancha"
          : m.senderId
            ? senderNameById.get(m.senderId.toString()) ?? "Unknown"
            : "Unknown";
        return `[${ts}] ${speaker}: ${m.rewrittenText}`;
      })
      .join("\n");

    const openai = getOpenAIClient();
    if (!openai) {
      return NextResponse.json(
        { error: "Q&A not configured" },
        { status: 503 }
      );
    }

    // Q&A scope per spec (milestone.txt:24-26): factual lookup ONLY over the
    // user's own + permitted-rewritten message history. Refuse summaries,
    // behavioural analysis, advice, and any request for the other user's
    // original wording. Do not invent.
    const qaSystemPrompt = await getActivePrompt("qa_system");
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      reasoning_effort: "minimal",
      messages: [
        { role: "system", content: qaSystemPrompt },
        {
          role: "user",
          content: `Message history:\n${context || "(no messages)"}\n\nQuestion: ${question.trim()}`,
        },
      ],
    });

    let answer = response.choices[0]?.message?.content ?? "No answer generated.";
    let fabricated = false;

    // Hard guard: any quoted substring in the answer must appear verbatim
    // somewhere in the context. If not, the model is fabricating an
    // attribution and we replace its output with a refusal.
    if (hasFabricatedQuote(answer, context)) {
      fabricated = true;
      answer = FABRICATION_REFUSAL;
    }

    try {
      await AuditLog.create({
        action: fabricated ? "qa_fabrication_blocked" : "qa_answered",
        channelId,
        actorUserId: payload.userId,
        metadata: {
          questionLength: question.trim().length,
          messagesInContext: messages.length,
          fabricated,
        },
      });
    } catch (err) {
      console.error("[qa] audit log write failed:", err);
    }

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("qa error:", error);
    return NextResponse.json(
      { error: "Failed to answer question" },
      { status: 500 }
    );
  }
}
