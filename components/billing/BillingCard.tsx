"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CreditCard,
  Receipt,
  ExternalLink,
  Loader2,
  Calendar,
  Image as ImageIcon,
  MessageSquare,
  X,
  Undo2,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PaymentMethod {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

interface BillingSubscription {
  id: string;
  plan: "core" | "picture_addon";
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  /** Unit amount in the smallest currency unit (pence for GBP). null when
   * the plan key isn't a known core/picture_addon. */
  unitAmount: number | null;
  currency: string;
  channel: {
    id: string;
    name: string | null;
    clanchaNumber: string | null;
    state: string | null;
    pictureShareEnabled: boolean;
  } | null;
}

interface BillingInvoice {
  id: string;
  number: string | null;
  amount: number;
  currency: string;
  status: string;
  created: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

interface BillingSummary {
  hasStripeCustomer: boolean;
  paymentMethod: PaymentMethod | null;
  subscriptions: BillingSubscription[];
  invoices: BillingInvoice[];
  customerPortalUrl: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatAmount(amount: number, currency: string) {
  const value = amount / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(value);
}

const statusTone: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  trialing: "bg-amber-50 text-amber-700 border-amber-200",
  past_due: "bg-red-50 text-red-700 border-red-200",
  canceled: "bg-slate-100 text-slate-600 border-slate-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  open: "bg-amber-50 text-amber-700 border-amber-200",
  void: "bg-slate-100 text-slate-600 border-slate-200",
  uncollectible: "bg-red-50 text-red-700 border-red-200",
};

export function BillingCard() {
  const { toast } = useToast();
  const [data, setData] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subBusy, setSubBusy] = useState<Record<string, string>>({});
  const [cancelAllBusy, setCancelAllBusy] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [confirmCancelAll, setConfirmCancelAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/summary", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load billing");
      }
      const body = (await res.json()) as BillingSummary;
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCancelOne = async (subId: string) => {
    setConfirmCancelId(null);
    setSubBusy((p) => ({ ...p, [subId]: "cancelling" }));
    try {
      const res = await fetch("/api/subscription/cancel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: subId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Cancellation failed");
      toast({ title: "Cancellation scheduled", description: body.message });
      setData((prev) =>
        prev
          ? {
              ...prev,
              subscriptions: prev.subscriptions.map((s) =>
                s.id === subId ? { ...s, cancelAtPeriodEnd: true } : s
              ),
            }
          : prev
      );
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Cancellation failed",
        variant: "destructive",
      });
    } finally {
      setSubBusy((p) => { const n = { ...p }; delete n[subId]; return n; });
    }
  };

  const handleUncancelOne = async (subId: string) => {
    setSubBusy((p) => ({ ...p, [subId]: "uncancelling" }));
    try {
      const res = await fetch("/api/subscription/uncancel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: subId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to undo cancellation");
      toast({ title: "Cancellation undone", description: body.message });
      setData((prev) =>
        prev
          ? {
              ...prev,
              subscriptions: prev.subscriptions.map((s) =>
                s.id === subId ? { ...s, cancelAtPeriodEnd: false } : s
              ),
            }
          : prev
      );
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to undo",
        variant: "destructive",
      });
    } finally {
      setSubBusy((p) => { const n = { ...p }; delete n[subId]; return n; });
    }
  };

  const handleCancelAll = async () => {
    setConfirmCancelAll(false);
    setCancelAllBusy(true);
    try {
      const res = await fetch("/api/subscription/cancel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelAll: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Cancellation failed");
      toast({ title: "All subscriptions scheduled for cancellation", description: body.message });
      setData((prev) =>
        prev
          ? {
              ...prev,
              subscriptions: prev.subscriptions.map((s) =>
                s.status === "active" || s.status === "trialing"
                  ? { ...s, cancelAtPeriodEnd: true }
                  : s
              ),
            }
          : prev
      );
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Cancellation failed",
        variant: "destructive",
      });
    } finally {
      setCancelAllBusy(false);
    }
  };

  const activeSubs = data?.subscriptions.filter(
    (s) => s.status === "active" || s.status === "trialing"
  ) ?? [];
  const pendingCancelCount = activeSubs.filter((s) => s.cancelAtPeriodEnd).length;
  const cancelableCount = activeSubs.filter((s) => !s.cancelAtPeriodEnd).length;

  return (
    <Card className="border-primary/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="w-5 h-5" /> Billing
        </CardTitle>
        <CardDescription>
          Payment method, next billing dates and recent invoices for your Clancha subscription.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !data?.hasStripeCustomer ? (
          <p className="text-sm text-muted-foreground">
            No payment method on file yet. Once you subscribe to a channel, your billing details will appear here.
          </p>
        ) : (
          <>
            {/* Payment method */}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70 mb-2">
                Payment method
              </p>
              {data.paymentMethod ? (
                <div className="flex items-center justify-between rounded-xl border border-primary/10 bg-primary/5 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-semibold capitalize">
                        {data.paymentMethod.brand} •••• {data.paymentMethod.last4}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Expires {String(data.paymentMethod.expMonth).padStart(2, "0")}/
                        {String(data.paymentMethod.expYear).slice(-2)}
                      </p>
                    </div>
                  </div>
                  {data.customerPortalUrl && (
                    <Button asChild size="sm" variant="outline" className="rounded-full">
                      <a href={data.customerPortalUrl} target="_blank" rel="noopener noreferrer">
                        Update <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No default payment method set in Stripe.</p>
              )}
            </div>

            {/* Subscriptions per channel */}
            {data.subscriptions.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70 mb-2">
                  Active subscriptions ({data.subscriptions.length})
                </p>
                <div className="space-y-2">
                  {data.subscriptions.map((sub) => {
                    const Icon = sub.plan === "picture_addon" ? ImageIcon : MessageSquare;
                    const busy = subBusy[sub.id];
                    const isCancelling = sub.cancelAtPeriodEnd;
                    const isConfirming = confirmCancelId === sub.id;
                    const canCancel = !isCancelling && (sub.status === "active" || sub.status === "trialing");
                    return (
                      <div
                        key={sub.id}
                        className={`rounded-xl border overflow-hidden transition-colors ${
                          isConfirming
                            ? "border-destructive/30"
                            : isCancelling
                            ? "border-amber-200 bg-amber-50/50"
                            : "border-primary/10"
                        }`}
                      >
                        {/* Main row */}
                        <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <Icon className="w-4 h-4 text-primary shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">
                                {sub.channel?.name || "Unnamed channel"}
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                  {sub.plan === "picture_addon" ? "Core SMS + Picture sharing" : "Core SMS"}
                                </span>
                              </p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Calendar className="w-3 h-3" />
                                {isCancelling
                                  ? `Cancels on ${formatDate(sub.currentPeriodEnd)}`
                                  : `Renews ${formatDate(sub.currentPeriodEnd)}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            {sub.unitAmount !== null && (
                              <span className="text-sm font-semibold text-[#2F4A44]">
                                {formatAmount(sub.unitAmount, sub.currency)}
                                <span className="text-[10px] font-normal text-muted-foreground ml-1">/mo</span>
                              </span>
                            )}
                            <span
                              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${isCancelling ? "bg-amber-50 text-amber-700 border-amber-200" : (statusTone[sub.status] ?? "bg-slate-50 text-slate-600 border-slate-200")}`}
                            >
                              {isCancelling
                                ? "Cancelling"
                                : sub.status === "trialing"
                                ? "Trial"
                                : sub.status === "past_due"
                                ? "Past due"
                                : sub.status[0].toUpperCase() + sub.status.slice(1)}
                            </span>

                            {busy ? (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            ) : isCancelling ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-xs rounded-lg"
                                onClick={() => handleUncancelOne(sub.id)}
                              >
                                <Undo2 className="w-3 h-3 mr-1" /> Undo
                              </Button>
                            ) : canCancel && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2.5 text-xs rounded-lg border border-destructive/25 bg-destructive/5 text-destructive/70 hover:text-destructive hover:bg-destructive/15 hover:border-destructive/40"
                                onClick={() => setConfirmCancelId(isConfirming ? null : sub.id)}
                              >
                                <X className="w-3 h-3 mr-1" /> Cancel
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Inline confirm strip */}
                        {isConfirming && (
                          <div className="px-3 py-3 bg-destructive/5 border-t border-destructive/20 space-y-3">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                              <p className="text-xs text-destructive leading-relaxed">
                                Are you sure? This channel will move to view-only on{" "}
                                <span className="font-semibold">{formatDate(sub.currentPeriodEnd)}</span>.
                                Message history remains readable. You can undo this before that date.
                              </p>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-3 text-xs rounded-lg"
                                onClick={() => setConfirmCancelId(null)}
                              >
                                Keep subscription
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-8 px-3 text-xs rounded-lg"
                                onClick={() => handleCancelOne(sub.id)}
                              >
                                Yes, cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Monthly subtotal — shows next-renewal amount (excludes cancelling channels) */}
                {(() => {
                  const allActiveSubs = data.subscriptions.filter(
                    (s) => (s.status === "active" || s.status === "trialing") && s.unitAmount !== null
                  );
                  if (allActiveSubs.length === 0) return null;

                  const renewingSubs = allActiveSubs.filter((s) => !s.cancelAtPeriodEnd);
                  const cancellingSubs = allActiveSubs.filter((s) => s.cancelAtPeriodEnd);
                  const nextTotal = renewingSubs.reduce((sum, s) => sum + (s.unitAmount ?? 0), 0);
                  const savingsAmount = cancellingSubs.reduce((sum, s) => sum + (s.unitAmount ?? 0), 0);
                  const currency = allActiveSubs[0].currency;

                  // Find earliest cancellation date for the savings note
                  const earliestCancelDate = cancellingSubs.length > 0
                    ? cancellingSubs.reduce((earliest, s) =>
                        s.currentPeriodEnd < earliest ? s.currentPeriodEnd : earliest,
                        cancellingSubs[0].currentPeriodEnd
                      )
                    : null;

                  return (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between rounded-xl bg-primary/5 px-3 py-2 border border-primary/10">
                        <span className="text-xs font-semibold uppercase tracking-widest text-primary/70">
                          {cancellingSubs.length > 0 ? "Next renewal" : "Monthly total"}
                        </span>
                        <span className="text-sm font-bold text-[#2F4A44]">
                          {nextTotal > 0 ? (
                            <>
                              {formatAmount(nextTotal, currency)}
                              <span className="text-[10px] font-normal text-muted-foreground ml-1">/mo</span>
                            </>
                          ) : (
                            <span className="text-[13px] font-semibold text-muted-foreground">£0.00</span>
                          )}
                        </span>
                      </div>
                      {cancellingSubs.length > 0 && savingsAmount > 0 && earliestCancelDate && (
                        <p className="text-[11px] text-amber-700 px-1">
                          Saving {formatAmount(savingsAmount, currency)}/mo from {formatDate(earliestCancelDate)} after {cancellingSubs.length === 1 ? "1 cancellation" : `${cancellingSubs.length} cancellations`}.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Cancel all — hidden for now */}

                {/* Single sub pending: show undo-all if everything is being cancelled */}
                {pendingCancelCount > 1 && cancelableCount === 0 && (
                  <div className="mt-3 pt-3 border-t border-primary/10">
                    <p className="text-xs text-amber-700 mb-2">
                      All your subscriptions are scheduled for cancellation.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Invoices */}
            {data.invoices.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70 mb-2 flex items-center gap-1.5">
                  <Receipt className="w-3 h-3" />
                  Recent invoices
                </p>
                <div className="flex flex-col gap-2 sm:hidden">
                  {data.invoices.map((inv) => (
                    <div key={inv.id} className="rounded-xl border border-primary/10 bg-primary/5 p-3 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#2F4A44]">
                            {formatAmount(inv.amount, inv.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(inv.created)}
                          </p>
                          {inv.number && (
                            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {inv.number}
                            </p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusTone[inv.status] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}
                        >
                          {inv.status}
                        </span>
                      </div>
                      {inv.hostedUrl ? (
                        <Button asChild variant="outline" size="sm" className="h-10 w-full rounded-xl">
                          <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer">
                            View invoice <ExternalLink className="w-3 h-3 ml-1" />
                          </a>
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">Invoice link unavailable.</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-hidden rounded-xl border border-primary/10 sm:block">
                  <table className="w-full text-sm">
                    <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-primary/5">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Date</th>
                        <th className="text-left px-3 py-2 font-semibold">Invoice</th>
                        <th className="text-right px-3 py-2 font-semibold">Amount</th>
                        <th className="text-left px-3 py-2 font-semibold">Status</th>
                        <th className="text-right px-3 py-2 font-semibold sr-only">View</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.invoices.map((inv) => (
                        <tr key={inv.id} className="border-t border-primary/10">
                          <td className="px-3 py-2 text-muted-foreground">{formatDate(inv.created)}</td>
                          <td className="px-3 py-2 text-muted-foreground font-mono text-xs">
                            {inv.number ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {formatAmount(inv.amount, inv.currency)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusTone[inv.status] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {inv.hostedUrl ? (
                              <a
                                href={inv.hostedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                View <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Stripe portal link */}
            {data.customerPortalUrl && (
              <div className="pt-2 border-t border-primary/10">
                <Button asChild variant="outline" className="w-full sm:w-auto rounded-2xl">
                  <a href={data.customerPortalUrl} target="_blank" rel="noopener noreferrer">
                    Manage billing in Stripe <ExternalLink className="w-3 h-3 ml-1.5" />
                  </a>
                </Button>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Open Stripe&apos;s billing portal to update payment details, download invoices, or change plans.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
