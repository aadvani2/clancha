import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { PromptVersion, PROMPT_KEYS, AuditLog, type PromptKey } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import {
  getDefaultPrompt,
  invalidatePromptCache,
  getCurrentDefaultRevision,
} from "@/lib/services/promptStore";
import mongoose from "mongoose";

function isPrivileged(role: string | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

function isValidKey(k: string): k is PromptKey {
  return (PROMPT_KEYS as readonly string[]).includes(k);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (!isPrivileged(auth.payload.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { key } = await params;
  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Unknown prompt key" }, { status: 400 });
  }

  try {
    await connectDB();
    const versions = await PromptVersion.find({ key })
      .sort({ version: -1 })
      .populate("createdBy", "name email phone")
      .lean();

    return NextResponse.json({
      key,
      defaultBody: getDefaultPrompt(key),
      versions: versions.map((v) => ({
        id: v._id.toString(),
        version: v.version,
        body: v.body,
        changeNote: v.changeNote,
        rolledBackFromVersion: v.rolledBackFromVersion ?? null,
        createdAt: v.createdAt,
        createdBy: v.createdBy
          ? {
              id: (v.createdBy as any)._id?.toString(),
              name: (v.createdBy as any).name,
              email: (v.createdBy as any).email,
              phone: (v.createdBy as any).phone,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error("admin/prompts/[key] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch prompt" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (!isPrivileged(auth.payload.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { key } = await params;
  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Unknown prompt key" }, { status: 400 });
  }

  let body: { body?: string; changeNote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newBody = typeof body.body === "string" ? body.body.trim() : "";
  const changeNote =
    typeof body.changeNote === "string" ? body.changeNote.trim() : "";

  if (!newBody) {
    return NextResponse.json({ error: "Prompt body cannot be empty" }, { status: 400 });
  }
  if (!changeNote) {
    return NextResponse.json(
      { error: "changeNote is required to record what changed" },
      { status: 400 }
    );
  }
  if (key === "rewrite_system" && !newBody.includes("{{TONE_INSTRUCTION}}")) {
    return NextResponse.json(
      {
        error:
          "rewrite_system must contain the literal token {{TONE_INSTRUCTION}} so per-channel tone can be injected",
      },
      { status: 400 }
    );
  }

  try {
    await connectDB();
    const latest = await PromptVersion.findOne({ key }).sort({ version: -1 }).lean();
    if (latest && latest.body === newBody) {
      return NextResponse.json(
        { error: "Body is identical to the current active version" },
        { status: 400 }
      );
    }
    const nextVersion = (latest?.version ?? 0) + 1;
    const created = await PromptVersion.create({
      key,
      body: newBody,
      version: nextVersion,
      createdBy: new mongoose.Types.ObjectId(auth.payload.userId),
      changeNote,
      defaultRevision: getCurrentDefaultRevision(key),
    });
    invalidatePromptCache(key);

    await AuditLog.create({
      action: "prompt_edited",
      actorUserId: auth.payload.userId,
      metadata: {
        key,
        version: created.version,
        changeNote,
        bodyLength: newBody.length,
      },
    }).catch(() => {});

    return NextResponse.json({
      id: created._id.toString(),
      key,
      version: created.version,
      changeNote: created.changeNote,
      createdAt: created.createdAt,
    });
  } catch (error) {
    console.error("admin/prompts/[key] POST error:", error);
    return NextResponse.json({ error: "Failed to save prompt" }, { status: 500 });
  }
}
