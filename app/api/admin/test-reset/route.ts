import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import {
  isTestEnvironment,
  getTestDataCounts,
  resetAllTestData,
  NotTestEnvironmentError,
} from "@/lib/services/testReset";

/**
 * Super-admin test-environment data reset (M4 #95, Craig's request). The whole
 * route is inert outside a Stripe test environment — see isTestEnvironment().
 */

// Status + counts so the admin UI knows whether to show the reset control and
// what it would clear.
export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const testEnvironment = isTestEnvironment();
  const counts = testEnvironment ? await getTestDataCounts() : null;
  return NextResponse.json({ testEnvironment, counts });
}

// Full wipe of all test data. Requires an explicit confirm token in the body so
// it can't fire from a stray request.
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isTestEnvironment()) {
    return NextResponse.json(
      { error: "Test data reset is disabled — this is not a Stripe test environment." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== "RESET") {
    return NextResponse.json(
      { error: 'Confirmation required: send { "confirm": "RESET" }.' },
      { status: 400 }
    );
  }

  try {
    const summary = await resetAllTestData({
      // Default to syncing Stripe; allow opting out (Craig can clear Stripe by hand).
      deleteStripe: body.deleteStripe !== false,
      actorUserId: auth.payload.userId,
    });
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof NotTestEnvironmentError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("admin/test-reset POST error:", err);
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
}
