import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { PromptVersion, PROMPT_KEYS, AuditLog, type PromptKey } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import {
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

  let body: { targetVersion?: number; changeNote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetVersion = Number(body.targetVersion);
  const changeNote =
    typeof body.changeNote === "string" ? body.changeNote.trim() : "";
  if (!Number.isFinite(targetVersion) || targetVersion < 1) {
    return NextResponse.json(
      { error: "targetVersion must be a positive integer" },
      { status: 400 }
    );
  }
  if (!changeNote) {
    return NextResponse.json(
      { error: "changeNote is required to record the rollback reason" },
      { status: 400 }
    );
  }

  try {
    await connectDB();
    const target = await PromptVersion.findOne({ key, version: targetVersion }).lean();
    if (!target) {
      return NextResponse.json({ error: "Target version not found" }, { status: 404 });
    }
    const latest = await PromptVersion.findOne({ key }).sort({ version: -1 }).lean();
    if (latest && latest.version === targetVersion) {
      return NextResponse.json(
        { error: "Target version is already the active version" },
        { status: 400 }
      );
    }
    const nextVersion = (latest?.version ?? 0) + 1;
    const created = await PromptVersion.create({
      key,
      body: target.body,
      version: nextVersion,
      createdBy: new mongoose.Types.ObjectId(auth.payload.userId),
      changeNote: `Rollback to v${targetVersion}: ${changeNote}`,
      rolledBackFromVersion: targetVersion,
      defaultRevision: getCurrentDefaultRevision(key),
    });
    invalidatePromptCache(key);

    await AuditLog.create({
      action: "prompt_rolled_back",
      actorUserId: auth.payload.userId,
      metadata: {
        key,
        newVersion: created.version,
        rolledBackFromVersion: targetVersion,
        changeNote,
      },
    }).catch(() => {});

    return NextResponse.json({
      id: created._id.toString(),
      key,
      version: created.version,
      rolledBackFromVersion: targetVersion,
      changeNote: created.changeNote,
      createdAt: created.createdAt,
    });
  } catch (error) {
    console.error("admin/prompts/[key]/rollback POST error:", error);
    return NextResponse.json({ error: "Failed to rollback prompt" }, { status: 500 });
  }
}
