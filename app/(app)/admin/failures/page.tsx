"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ShieldAlert,
  Loader2,
  Shield,
  MessageSquare,
  Sparkles,
  RefreshCcw,
  Inbox,
} from "lucide-react";
import { useAppSelector } from "@/hooks/redux";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/formatDate";

interface FailureRow {
  id: string;
  service: "twilio" | "openai";
  createdAt: string | null;
  channelId: string | null;
  operation: string | null;
  message: string | null;
  code: number | null;
}

interface StuckOutboxRow {
  id: string;
  to: string;
  status: "pending" | "failed" | string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface FailuresResponse {
  counts: {
    twilio: { last24h: number; last7d: number; total: number };
    openai: { last24h: number; last7d: number; total: number };
  };
  outbox: { pending: number; deadLettered: number; stuck: StuckOutboxRow[] };
  recent: FailureRow[];
}

export default function AdminFailuresPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAppSelector((state) => state.user);
  const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const [data, setData] = useState<FailuresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      else setRefreshing(true);
      try {
        const res = await fetch("/api/admin/failures", { credentials: "include" });
        if (!res.ok) throw new Error(`Failures fetch failed (${res.status})`);
        setData((await res.json()) as FailuresResponse);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load";
        toast({ title: "Error", description: msg, variant: "destructive" });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!currentUser) return;
    if (!isPrivileged) {
      setLoading(false);
      return;
    }
    fetchAll(true);
  }, [currentUser, isPrivileged, fetchAll]);

  if (!currentUser) {
    return (
      <div className="h-full overflow-y-auto overflow-x-hidden px-4 sm:px-8 py-6 sm:py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!isPrivileged) {
    return (
      <div className="h-full overflow-y-auto overflow-x-hidden px-4 sm:px-8 py-6 sm:py-8">
        <Card className="border-primary/10 max-w-md">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold text-primary mb-2">Access restricted</h2>
            <p className="text-sm text-muted-foreground mb-4">
              The Failures page is restricted to admins.
            </p>
            <Button variant="outline" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-4xl mx-auto space-y-6 px-4 py-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 md:p-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-primary tracking-tight flex items-center gap-2">
              <ShieldAlert className="w-6 h-6" /> Failures
            </h1>
            <p className="text-sm text-muted-foreground">
              Twilio + OpenAI service-failure log and SMS outbox state.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchAll(false)}
            disabled={loading || refreshing}
            className="h-10"
          >
            {refreshing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-1.5" />}
            Refresh
          </Button>
        </div>

        {/* Counts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-4 h-4 text-primary" /> Failure counts
            </CardTitle>
            <CardDescription>service_failure_* audit log totals.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !data ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <CountCard
                  service="Twilio"
                  icon={<MessageSquare className="w-4 h-4" />}
                  c={data.counts.twilio}
                />
                <CountCard
                  service="OpenAI"
                  icon={<Sparkles className="w-4 h-4" />}
                  c={data.counts.openai}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* SMS Outbox state */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="w-4 h-4 text-primary" /> SMS Outbox
            </CardTitle>
            <CardDescription>
              Durable retry queue. The /api/cron sweep processes pending rows on a backoff schedule.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !data ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                    <span className="font-bold text-amber-700 text-sm">{data.outbox.pending}</span> pending retry
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                    <span className="font-bold text-red-700 text-sm">{data.outbox.deadLettered}</span> dead-lettered
                  </div>
                </div>

                {/* Per-row detail so an admin can see WHY a row is stuck
                    (status / attempts / last error) rather than just a count
                    (Craig M4 tracker #92). */}
                {data.outbox.stuck.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No messages stuck in the queue — every outbound SMS has been delivered.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.outbox.stuck.map((o) => {
                      const exhausted = o.status === "failed" || o.attempts >= o.maxAttempts;
                      return (
                        <li
                          key={o.id}
                          className="rounded-xl border border-primary/10 bg-card px-4 py-3 space-y-1.5"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              variant="outline"
                              className={
                                exhausted
                                  ? "text-[10px] font-semibold text-red-700 border-red-300 bg-red-50"
                                  : "text-[10px] font-semibold text-amber-700 border-amber-300 bg-amber-50"
                              }
                            >
                              {exhausted ? "Dead-lettered" : "Pending retry"}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground font-mono">to {o.to}</span>
                            <span className="text-[11px] text-muted-foreground">
                              attempt {o.attempts}/{o.maxAttempts}
                            </span>
                            {!exhausted && o.nextAttemptAt && (
                              <span className="text-[11px] text-muted-foreground ml-auto">
                                next try {formatDateTime(o.nextAttemptAt)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground break-words">
                            {o.lastError
                              ? <>Last error: <span className="font-medium text-foreground">{o.lastError}</span></>
                              : exhausted
                                ? "Retries exhausted with no recorded error — check Twilio for the recipient number."
                                : "Awaiting first attempt or backoff window."}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent failures */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="w-4 h-4 text-primary" /> Recent failures
            </CardTitle>
            <CardDescription>Last 50 service_failure_* entries, newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !data ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : data.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-4">
                No service failures recorded.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.recent.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-primary/10 bg-card px-4 py-3 space-y-1.5"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={
                          r.service === "twilio"
                            ? "text-[10px] font-semibold text-orange-700 border-orange-300 bg-orange-50"
                            : "text-[10px] font-semibold text-purple-700 border-purple-300 bg-purple-50"
                        }
                      >
                        {r.service === "twilio" ? "Twilio" : "OpenAI"}
                      </Badge>
                      {r.operation && (
                        <span className="text-[11px] text-muted-foreground font-mono">{r.operation}</span>
                      )}
                      <span className="text-[11px] text-muted-foreground ml-auto">{formatDateTime(r.createdAt)}</span>
                    </div>
                    {r.message && (
                      <p className="text-xs text-muted-foreground break-words">{r.message}</p>
                    )}
                    {r.code != null && (
                      <p className="text-[11px] text-muted-foreground font-mono">code: {r.code}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CountCard({
  service,
  icon,
  c,
}: {
  service: string;
  icon: React.ReactNode;
  c: { last24h: number; last7d: number; total: number };
}) {
  return (
    <div className="rounded-xl border border-primary/15 bg-card p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
        {icon}
        {service}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="24h" value={c.last24h} />
        <Stat label="7d" value={c.last7d} />
        <Stat label="Total" value={c.total} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
      <p className="text-lg font-bold leading-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
