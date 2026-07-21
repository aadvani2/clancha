import { NextResponse } from "next/server";

/**
 * Short own-domain terms link for SMS: /terms → the live terms page on the
 * marketing site (Craig, M4 feedback 05/07/26 §1.3 — short branded links,
 * no public shorteners).
 */
export async function GET() {
  return NextResponse.redirect("https://www.clancha.co.uk/terms-of-use/", 308);
}
