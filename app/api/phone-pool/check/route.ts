import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import connectDB from "@/lib/db/connect";
import { PhoneNumber, Channel } from "@/lib/db/models";
import mongoose from "mongoose";

export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  const { payload } = auth;

  await connectDB();

  const pool = await PhoneNumber.find({ isActive: true }, { number: 1 }).lean();
  const poolSize = pool.length;

  if (poolSize === 0) {
    return NextResponse.json({ available: false, poolSize: 0 });
  }

  const userChannels = await Channel.find(
    { users: new mongoose.Types.ObjectId(payload.userId) },
    { clanchaNumber: 1 }
  ).lean();

  const usedByUser = new Set(userChannels.map((c) => c.clanchaNumber));
  const available = pool.some((p) => !usedByUser.has(p.number));

  return NextResponse.json({ available, poolSize });
}
