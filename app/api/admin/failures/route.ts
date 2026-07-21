import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db/connect";
import { AuditLog, SmsOutbox } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * GET /api/admin/failures — service-failure summary for /admin/failures.
 *
 * Returns:
 *  - counts.twilio.{last24h, last7d, total}
 *  - counts.openai.{last24h, last7d, total}
 *  - outbox.{pending, deadLettered, stuck: [{ to, status, attempts, maxAttempts,
 *      nextAttemptAt, lastError, ... }]}
 *  - recent: last 50 service_failure_* rows, newest first
 *
 * Backs M4 tracker #59 (dedicated Failures page) and #92 (surface WHY outbox
 * rows are stuck — status/attempts/lastError). All admins + super admins can read.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(_request: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  if (auth.payload.role !== "super_admin" && auth.payload.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await connectDB();

    const now = Date.now();
    const since24h = new Date(now - DAY_MS);
    const since7d = new Date(now - 7 * DAY_MS);

    const [
      twilio24h,
      twilio7d,
      twilioTotal,
      openai24h,
      openai7d,
      openaiTotal,
      outboxPending,
      outboxDead,
      recent,
      stuckOutbox,
    ] = await Promise.all([
      AuditLog.countDocuments({ action: "service_failure_twilio", createdAt: { $gte: since24h } }),
      AuditLog.countDocuments({ action: "service_failure_twilio", createdAt: { $gte: since7d } }),
      AuditLog.countDocuments({ action: "service_failure_twilio" }),
      AuditLog.countDocuments({ action: "service_failure_openai", createdAt: { $gte: since24h } }),
      AuditLog.countDocuments({ action: "service_failure_openai", createdAt: { $gte: since7d } }),
      AuditLog.countDocuments({ action: "service_failure_openai" }),
      SmsOutbox.countDocuments({ status: "pending" }),
      SmsOutbox.countDocuments({ status: "failed" }),
      AuditLog.find({ action: { $in: ["service_failure_twilio", "service_failure_openai"] } })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      // Rows that are NOT delivered: still pending (awaiting a retry) or failed
      // (retries exhausted / dead-lettered). These are what an admin sees as
      // "stuck in the retry queue" — surface status/attempts/lastError so they
      // can tell a real delivery problem from a row simply waiting on backoff
      // (M4 tracker #92). Oldest first so the longest-stuck appear at the top.
      SmsOutbox.find({ status: { $in: ["pending", "failed"] } })
        .sort({ createdAt: 1 })
        .limit(50)
        .lean(),
    ]);

    return NextResponse.json({
      counts: {
        twilio: { last24h: twilio24h, last7d: twilio7d, total: twilioTotal },
        openai: { last24h: openai24h, last7d: openai7d, total: openaiTotal },
      },
      outbox: {
        pending: outboxPending,
        deadLettered: outboxDead,
        stuck: stuckOutbox.map((o) => ({
          id: o._id.toString(),
          // Redact to the last 4 digits — admins need to identify the row, not
          // read full recipient numbers.
          to: typeof o.to === "string" && o.to.length >= 4 ? `***${o.to.slice(-4)}` : "***",
          status: o.status,
          attempts: o.attempts ?? 0,
          maxAttempts: o.maxAttempts ?? 0,
          nextAttemptAt: o.nextAttemptAt ? new Date(o.nextAttemptAt).toISOString() : null,
          lastError: o.lastError ?? null,
          createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : null,
          updatedAt: o.updatedAt ? new Date(o.updatedAt).toISOString() : null,
        })),
      },
      recent: recent.map((r: any) => ({
        id: r._id.toString(),
        service: r.action === "service_failure_twilio" ? "twilio" : "openai",
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        channelId: r.channelId ? r.channelId.toString() : null,
        operation: (r.metadata as any)?.operation ?? null,
        message: (r.metadata as any)?.message ?? (r.metadata as any)?.error ?? null,
        code: (r.metadata as any)?.code ?? null,
        simulated: !!(r.metadata as any)?.simulated,
        metadata: r.metadata ?? null,
      })),
    });
  } catch (error) {
    console.error("[admin/failures GET]", error);
    return NextResponse.json({ error: "Failed to read failure summary" }, { status: 500 });
  }
}
