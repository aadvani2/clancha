import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  const isHttps = protocol === "https" || request.url.startsWith("https:");

  response.cookies.set("token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" ? isHttps : false,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
