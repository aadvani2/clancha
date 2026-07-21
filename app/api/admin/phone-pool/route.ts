import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { PhoneNumber, Channel } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * GET  /api/admin/phone-pool  — list all phone numbers (super admin)
 * POST /api/admin/phone-pool  — add a phone number to the pool
 */

export async function GET(_request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await connectDB();
    // Oldest first so a number's position is its allocation order (the number
    // carrying everyone's first channel was added first). We re-sort by live
    // load below; this is the stable tie-break.
    const numbers = await PhoneNumber.find({})
      .sort({ createdAt: 1 })
      .populate("channelId", "name clanchaNumber")
      .lean();

    // Per spec a single Clancha number can be shared across many users'
    // channels (different recipients reuse the same pool number). The
    // legacy PhoneNumber.channelId field only stored the most-recent
    // assignment, so count live channels by clanchaNumber instead.
    const numberStrings = numbers.map((n) => n.number).filter(Boolean);
    const counts = await Channel.aggregate([
      {
        $match: {
          clanchaNumber: { $in: numberStrings },
          state: { $nin: ["closed"] },
        },
      },
      { $group: { _id: "$clanchaNumber", count: { $sum: 1 } } },
    ]);
    const countByNumber = new Map<string, number>(
      counts.map((c: { _id: string; count: number }) => [c._id, c.count])
    );

    const result = numbers.map((n) => {
      const ch = n.channelId as any;
      const channelCount = countByNumber.get(n.number) ?? 0;
      return {
        id: n._id.toString(),
        number: n.number,
        isActive: n.isActive,
        channelCount,
        assignedTo: ch
          ? { id: ch._id?.toString(), name: ch.name ?? null, clanchaNumber: ch.clanchaNumber ?? null }
          : null,
        createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : null,
      };
    });

    // Order by use (M4 tracker #105). Busiest number first — the one carrying
    // everyone's first channel sits on top, then the second-channel number, and
    // so on, with counts decreasing down the list and unassigned numbers at the
    // bottom. Array.prototype.sort is stable, so equal-count numbers keep the
    // allocation (oldest-first) order set by the query above.
    result.sort((a, b) => b.channelCount - a.channelCount);

    return NextResponse.json({ numbers: result });
  } catch (error) {
    console.error("[admin/phone-pool GET] error:", error);
    return NextResponse.json({ error: "Failed to fetch phone pool" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { number } = (await request.json()) as { number?: string };
    if (!number || typeof number !== "string" || !number.trim()) {
      return NextResponse.json({ error: "number is required" }, { status: 400 });
    }

    const normalised = number.trim();
    if (!/^\+?[1-9]\d{6,14}$/.test(normalised)) {
      return NextResponse.json(
        { error: "Invalid phone number format. Use E.164 format, e.g. +441234567890" },
        { status: 400 }
      );
    }

    await connectDB();

    const existing = await PhoneNumber.findOne({ number: normalised }).lean();
    if (existing) {
      return NextResponse.json({ error: "Number already in pool" }, { status: 409 });
    }

    const doc = await PhoneNumber.create({ number: normalised, isActive: true });
    return NextResponse.json(
      { id: doc._id.toString(), number: doc.number, isActive: doc.isActive, assignedTo: null },
      { status: 201 }
    );
  } catch (error) {
    console.error("[admin/phone-pool POST] error:", error);
    return NextResponse.json({ error: "Failed to add number" }, { status: 500 });
  }
}
