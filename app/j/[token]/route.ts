import { NextResponse } from "next/server";
import { getPortalBaseUrl } from "@/lib/messaging/appendixA";

/**
 * Short join-link redirect: /j/<token> → /join?t=<token>.
 * Keeps the A1 SMS short (Craig, M4 feedback 05/07/26 §1.3) while the join
 * page itself keeps its existing ?t= contract for old links.
 *
 * The target is built from NEXT_PUBLIC_APP_URL, not the request origin —
 * behind the staging nginx proxy the request origin resolves to
 * localhost:3000.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const target = new URL("/join", getPortalBaseUrl());
  if (token) target.searchParams.set("t", token);
  return NextResponse.redirect(target);
}
