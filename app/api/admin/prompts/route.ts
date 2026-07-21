import { NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { PromptVersion, PROMPT_KEYS, type PromptKey } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import {
  getDefaultPrompt,
  getCurrentDefaultRevision,
} from "@/lib/services/promptStore";

function isPrivileged(role: string | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (!isPrivileged(auth.payload.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await connectDB();
    const items = await Promise.all(
      PROMPT_KEYS.map(async (key) => {
        const typedKey = key as PromptKey;
        const minRevision = getCurrentDefaultRevision(typedKey);
        const latest = await PromptVersion.findOne({ key })
          .sort({ version: -1 })
          .populate("createdBy", "name email phone")
          .lean();
        const isStale =
          !!latest && (latest.defaultRevision ?? 0) < minRevision;
        const useDefault = !latest || isStale;
        return {
          key,
          version: latest?.version ?? 0,
          body: useDefault ? getDefaultPrompt(typedKey) : latest!.body,
          isDefault: useDefault,
          isStaleOverride: isStale,
          currentDefaultRevision: minRevision,
          savedDefaultRevision: latest?.defaultRevision ?? null,
          updatedAt: latest?.createdAt ?? null,
          updatedBy: latest?.createdBy
            ? {
                id: (latest.createdBy as any)._id?.toString(),
                name: (latest.createdBy as any).name,
                email: (latest.createdBy as any).email,
                phone: (latest.createdBy as any).phone,
              }
            : null,
          changeNote: latest?.changeNote ?? null,
        };
      })
    );
    return NextResponse.json({ prompts: items });
  } catch (error) {
    console.error("admin/prompts GET error:", error);
    return NextResponse.json({ error: "Failed to fetch prompts" }, { status: 500 });
  }
}
