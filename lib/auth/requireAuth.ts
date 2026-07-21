import { NextResponse } from "next/server";
import { getTokenFromCookie } from "@/lib/auth/getToken";
import { verifyToken } from "@/lib/auth/jwt";
import type { JwtPayload } from "@/lib/auth/jwt";

export async function requireAuth(): Promise<
  { payload: JwtPayload; response?: never } | { payload?: never; response: NextResponse }
> {
  const token = await getTokenFromCookie();
  if (!token) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const payload = verifyToken(token);
  if (!payload) {
    return { response: NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }) };
  }
  return { payload };
}
