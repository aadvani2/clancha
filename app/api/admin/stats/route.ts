import { NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { User, Channel, Message } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "admin" && auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await connectDB();

    const [userCount, channelCount, messageCount] = await Promise.all([
      User.countDocuments(),
      Channel.countDocuments({ state: { $nin: ["closed"] } }),
      Message.countDocuments(),
    ]);

    return NextResponse.json({
      userCount,
      channelCount,
      messageCount,
    });
  } catch (error) {
    console.error("admin/stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
