import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { Channel, Message, Image, ModeratorAssignment, User } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { formatBothPartiesLabel } from "@/lib/utils/formatChannelLabel";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  // Ensure only super_admin, admin, or moderator can access
  if (payload.role !== "super_admin" && payload.role !== "admin" && payload.role !== "moderator") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "10", 10);
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "all";
  const unassignedOnly = searchParams.get("unassigned") === "true";
  const currentModeratorId = searchParams.get("moderatorId");

  try {
    await connectDB();

    const query: any = { state: { $nin: ["closed"] } };

    // Handle 'unassigned' filter for assignment dialogs
    if (unassignedOnly) {
      const allAssignments = await ModeratorAssignment.find({}).lean();
      
      // We want to exclude channels assigned to OTHER moderators
      // But we must INCLUDE channels assigned to the current moderator if we're editing them
      const otherAssignments = currentModeratorId 
        ? allAssignments.filter(a => a.userId.toString() !== currentModeratorId)
        : allAssignments;
      
      const excludedChannelIds = otherAssignments.map(a => a.channelId);
      query._id = { $nin: excludedChannelIds };
    }

    // Map filter values to DB conditions. "active_sms" and "active_picture"
    // are UI-level distinctions; both correspond to state="active" with
    // different pictureShareEnabled.
    if (status === "active_sms") {
      query.state = "active";
      query.pictureShareEnabled = { $ne: true };
    } else if (status === "active_picture") {
      query.state = "active";
      query.pictureShareEnabled = true;
    } else if (status !== "all") {
      query.state = status;
    }

    if (search.trim()) {
      // Match channel-level name + number, plus any participant's name —
      // since the row label now composes both users, searching either
      // parent's name should land the channel.
      const matchingUsers = await User.find({
        name: { $regex: search, $options: "i" },
      })
        .select("_id")
        .lean();
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { clanchaNumber: { $regex: search, $options: "i" } },
        { users: { $in: matchingUsers.map((u) => u._id) } },
      ];
    }

    const skip = (page - 1) * limit;

    const [channels, total] = await Promise.all([
      Channel.find(query)
        .populate<{ subscriptionId: { currentPeriodEnd: Date } | null }>({
          path: "subscriptionId",
          select: "currentPeriodEnd",
        })
        .populate<{ users: Array<{ _id: unknown; name?: string | null; phone?: string | null }> }>({
          path: "users",
          select: "name phone",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Channel.countDocuments(query),
    ]);

    const channelIdsOnPage = (channels as any[]).map((c) => c._id);
    const heldAgg =
      channelIdsOnPage.length > 0
        ? await Message.aggregate<{ _id: unknown; n: number }>([
            {
              $match: {
                channelId: { $in: channelIdsOnPage },
                state: "held",
                deliveredAt: null,
              },
            },
            { $group: { _id: "$channelId", n: { $sum: 1 } } },
          ])
        : [];
    const imgAgg =
      channelIdsOnPage.length > 0
        ? await Image.aggregate<{ _id: unknown; n: number }>([
            { $match: { channelId: { $in: channelIdsOnPage }, state: "pending" } },
            { $group: { _id: "$channelId", n: { $sum: 1 } } },
          ])
        : [];
    const heldMap = new Map(heldAgg.map((x) => [String(x._id), x.n]));
    const imgMap = new Map(imgAgg.map((x) => [String(x._id), x.n]));

    const items = channels.map((c: any) => {
      const cid = c._id.toString();
      const pendingModerationCount = (heldMap.get(cid) ?? 0) + (imgMap.get(cid) ?? 0);

      return {
        id: cid,
        clanchaNumber: c.clanchaNumber,
        name: formatBothPartiesLabel(c.users, c.name),
        state: c.state,
        pictureShareEnabled: !!c.pictureShareEnabled,
        subscriptionExpiry: c.subscriptionId?.currentPeriodEnd
          ? new Date(c.subscriptionId.currentPeriodEnd).toISOString()
          : null,
        unsafeMessageCount: pendingModerationCount,
        pendingModerationCount,
        createdAt: c.createdAt,
      };
    });

    return NextResponse.json({
      channels: items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Admin channels list error:", error);
    return NextResponse.json(
      { error: "Failed to list channels" },
      { status: 500 }
    );
  }
}

