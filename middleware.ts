import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = [
  "/dashboard",
  "/subscription",
  "/checkout",
  "/admin",
  "/moderator",
  "/moderators",
  "/activity",
  "/settings",
  "/channel",
];
const AUTH_PATHS = ["/login", "/signup", "/verify-otp", "/admin/login", "/viewer/login"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const token =
    request.cookies.get("token")?.value ??
    request.headers.get("authorization")?.replace("Bearer ", "");

  if (isProtectedPath(pathname) && !isAuthPath(pathname) && !token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPath(pathname) && token && pathname !== "/verify-otp") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/subscription",
    "/checkout",
    "/admin/:path*",
    "/moderator/:path*",
    "/moderators/:path*",
    "/activity",
    "/settings",
    "/channel/:path*",
    "/login",
    "/signup",
    "/verify-otp",
    "/viewer/login",
  ],
};
