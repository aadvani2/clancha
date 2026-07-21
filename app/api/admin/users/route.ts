import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User, Channel, ChannelViewer } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import type { Types } from "mongoose";

/**
 * GET /api/admin/users
 *
 * Admin-only directory of every user account on the system. Backs the
 * /admin/users page (M4 tracker item 5). Supports pagination + role/search
 * filters and computes a per-user channel count.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "admin" && auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(5, parseInt(searchParams.get("limit") || "20", 10)));
  const role = (searchParams.get("role") || "all").trim();
  const search = (searchParams.get("search") || "").trim();

  try {
    await connectDB();

    const query: Record<string, unknown> = {};
    if (role !== "all") query.role = role;
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }
    // Hide shadow/placeholder rows created when a channel invite hasn't yet
    // been accepted. They use synthetic emails like clancha_pending_invite@
    // clancha.system or clancha_<phone>@invited.com and have no real account
    // identity yet. The records stay in the DB so the invite-acceptance flow
    // can promote them to real users — they just shouldn't appear in the
    // admin Users list.
    query.email = { $not: { $regex: "^clancha_[^@]*@(invited\\.com|clancha\\.system)$", $options: "i" } };

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select("_id phone email name role createdAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Batch channel-count for the visible page only — keeps the lookup cheap.
    const userIds = users.map((u) => u._id);

    // Regular users/admins: counted via Channel.users array.
    const counts = await Channel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { users: { $in: userIds } } },
      { $unwind: "$users" },
      { $match: { users: { $in: userIds } } },
      { $group: { _id: "$users", n: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.n]));

    // Viewers: their channels live in ChannelViewer, not Channel.users.
    const viewerCounts = await ChannelViewer.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { userId: { $in: userIds }, status: "active" } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
    ]);
    for (const vc of viewerCounts) {
      const existing = countMap.get(vc._id.toString()) ?? 0;
      countMap.set(vc._id.toString(), existing + vc.n);
    }

    const items = users.map((u) => ({
      id: u._id.toString(),
      name: u.name ?? null,
      email: u.email ?? null,
      phone: u.phone ?? null,
      role: u.role,
      channelCount: countMap.get(u._id.toString()) ?? 0,
      createdAt: u.createdAt,
    }));

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("admin/users error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
