import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { OutageSimulation } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";
import { invalidateOutageCache } from "@/lib/services/outageSimulation";

/**
 * GET   /api/admin/outage-simulation  — read current flag state (super admin)
 * PATCH /api/admin/outage-simulation  — toggle one or both flags. Body:
 *         { twilio?: boolean, openai?: boolean }
 *
 * Backs the /admin/failures simulation panel (M4 tracker #57/#58).
 */

async function getOrCreate() {
  let row = await OutageSimulation.findOne({});
  if (!row) {
    row = await OutageSimulation.create({});
  }
  return row;
}

function shape(row: { twilioOutageActive: boolean; openaiOutageActive: boolean; twilioToggledAt?: Date | null; openaiToggledAt?: Date | null }) {
  return {
    twilioOutageActive: row.twilioOutageActive,
    openaiOutageActive: row.openaiOutageActive,
    twilioToggledAt: row.twilioToggledAt ? row.twilioToggledAt.toISOString() : null,
    openaiToggledAt: row.openaiToggledAt ? row.openaiToggledAt.toISOString() : null,
  };
}

export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin" && auth.payload.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await connectDB();
    const row = await getOrCreate();
    return NextResponse.json(shape(row));
  } catch (error) {
    console.error("[admin/outage-simulation GET]", error);
    return NextResponse.json({ error: "Failed to read outage simulation state" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can toggle outage simulation" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { twilio?: boolean; openai?: boolean };
    if (typeof body.twilio !== "boolean" && typeof body.openai !== "boolean") {
      return NextResponse.json({ error: "Provide at least one of: twilio, openai" }, { status: 400 });
    }

    await connectDB();
    const row = await getOrCreate();

    const now = new Date();
    if (typeof body.twilio === "boolean" && body.twilio !== row.twilioOutageActive) {
      row.twilioOutageActive = body.twilio;
      row.twilioToggledBy = auth.payload.userId as unknown as typeof row.twilioToggledBy;
      row.twilioToggledAt = now;
    }
    if (typeof body.openai === "boolean" && body.openai !== row.openaiOutageActive) {
      row.openaiOutageActive = body.openai;
      row.openaiToggledBy = auth.payload.userId as unknown as typeof row.openaiToggledBy;
      row.openaiToggledAt = now;
    }
    await row.save();

    // Flush the in-process cache so the change takes effect immediately on
    // this server. Other server instances pick it up within the 5s TTL.
    invalidateOutageCache();

    return NextResponse.json(shape(row));
  } catch (error) {
    console.error("[admin/outage-simulation PATCH]", error);
    return NextResponse.json({ error: "Failed to update outage simulation" }, { status: 500 });
  }
}
