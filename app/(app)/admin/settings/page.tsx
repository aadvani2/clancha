"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Phone,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Shield,
  SlidersHorizontal,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { useAppSelector } from "@/hooks/redux";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils/formatDate";

interface ChannelAllocation {
  id: string;
  name: string | null;
  state: string;
  createdAt: string | null;
  allocationOrder: number;
}

interface PhoneEntry {
  id: string;
  number: string;
  isActive: boolean;
  /** How many active channels are currently routing through this number. */
  channelCount: number;
  assignedTo: { id: string; name: string | null; clanchaNumber: string | null } | null;
  createdAt: string | null;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog();
  const { currentUser } = useAppSelector((state) => state.user);
  const isSuperAdmin = currentUser?.role === "super_admin";

  const [numbers, setNumbers] = useState<PhoneEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNumber, setNewNumber] = useState("");
  const [adding, setAdding] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [detailEntry, setDetailEntry] = useState<PhoneEntry | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailChannels, setDetailChannels] = useState<ChannelAllocation[]>([]);
  // Test-environment reset (M4 #95). The card only renders when this deployment
  // is connected to a Stripe test account.
  const [testEnv, setTestEnv] = useState<boolean | null>(null);
  const [testCounts, setTestCounts] = useState<{
    users: number;
    channels: number;
    subscriptions: number;
    numbersInUse: number;
  } | null>(null);
  const [resetting, setResetting] = useState(false);

  const fetchTestStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/test-reset", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setTestEnv(!!data.testEnvironment);
      setTestCounts(data.counts ?? null);
    } catch {
      // Best-effort — if this fails the reset card simply doesn't appear.
    }
  }, []);

  const fetchPool = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/phone-pool", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setNumbers(data.numbers);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isSuperAdmin) {
      setLoading(false);
      return;
    }
    fetchPool();
    fetchTestStatus();
  }, [currentUser, isSuperAdmin, fetchPool, fetchTestStatus]);

  const handleResetTestData = async () => {
    const ok = await confirmDialog({
      title: "Reset all test data?",
      description:
        "This permanently deletes every test user, channel, subscription, message and image, and deletes the matching customers in the Stripe test account. Staff accounts and the number pool are kept. This cannot be undone.",
      confirmLabel: "Reset test data",
      variant: "destructive",
    });
    if (!ok) return;
    setResetting(true);
    try {
      const res = await fetch("/api/admin/test-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: "RESET" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error as string) || `Reset failed (${res.status})`);
      const usersDeleted = data.deleted?.users ?? 0;
      const channelsDeleted = data.deleted?.channels ?? 0;
      const stripeDeleted = data.stripe?.customersDeleted ?? 0;
      const stripeFailed = data.stripe?.customersFailed ?? 0;
      toast({
        title: "Test data reset",
        description: `Removed ${usersDeleted} user${usersDeleted === 1 ? "" : "s"} and ${channelsDeleted} channel${
          channelsDeleted === 1 ? "" : "s"
        }. Stripe: ${stripeDeleted} customer${stripeDeleted === 1 ? "" : "s"} deleted${
          stripeFailed ? `, ${stripeFailed} failed (clear manually in Stripe)` : ""
        }.`,
      });
      await fetchPool();
      await fetchTestStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      toast({ title: "Reset failed", description: msg, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  const handleAdd = async () => {
    const num = newNumber.trim();
    if (!num) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/phone-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ number: num }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error as string) || `Add failed (${res.status})`);
      toast({ title: "Number added to pool" });
      setNewNumber("");
      await fetchPool();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      toast({ title: "Failed to add number", description: msg, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (entry: PhoneEntry) => {
    setPendingId(entry.id);
    try {
      const res = await fetch(`/api/admin/phone-pool/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: !entry.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error as string) || "Toggle failed");
      setNumbers((prev) =>
        prev.map((n) => (n.id === entry.id ? { ...n, isActive: !entry.isActive } : n))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      toast({ title: "Failed to update", description: msg, variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  };

  const handleViewDetails = async (entry: PhoneEntry) => {
    setDetailEntry(entry);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailChannels([]);
    try {
      const res = await fetch(`/api/admin/phone-pool/${entry.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setDetailChannels(data.channels ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (entry: PhoneEntry) => {
    if (entry.channelCount > 0) {
      toast({
        title: "Cannot remove",
        description: `This number is routing ${entry.channelCount} channel${entry.channelCount === 1 ? "" : "s"}.`,
        variant: "destructive",
      });
      return;
    }
    const ok = await confirmDialog({
      title: "Remove this number from the pool?",
      description: `${entry.number} won't be allocated to any new channels after this. Existing channels are unaffected. You can add the number back later if needed.`,
      confirmLabel: "Remove number",
      variant: "destructive",
    });
    if (!ok) return;
    setPendingId(entry.id);
    try {
      const res = await fetch(`/api/admin/phone-pool/${entry.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error as string) || "Delete failed");
      toast({ title: "Number removed" });
      setNumbers((prev) => prev.filter((n) => n.id !== entry.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      toast({ title: "Failed to remove", description: msg, variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  };

  if (!currentUser) {
    return (
      <ScrollArea className="h-full px-4 sm:px-8 py-6 sm:py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ScrollArea>
    );
  }

  if (!isSuperAdmin) {
    return (
      <ScrollArea className="h-full px-4 sm:px-8 py-6 sm:py-8">
        <Card className="border-primary/10 max-w-md">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold text-primary mb-2">Access restricted</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Admin settings are restricted to super admins.
            </p>
            <Button variant="outline" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </ScrollArea>
    );
  }

  // Per spec one Clancha number is shared across many users' channels — so
  // "available" just means the row is active in the pool. The actual
  // routing load per number is shown inline on each card.
  const total = numbers.length;
  const active = numbers.filter((n) => n.isActive).length;

  return (
    <ScrollArea className="h-full">
      {confirmDialogNode}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono">{detailEntry?.number}</DialogTitle>
            <DialogDescription>
              {detailEntry && detailEntry.channelCount === 0
                ? "Not currently assigned to any channel."
                : `Routing ${detailEntry?.channelCount} channel${detailEntry?.channelCount === 1 ? "" : "s"}.`}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : detailChannels.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-2">
              This number hasn&apos;t been allocated to a channel yet.
            </p>
          ) : (
            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {detailChannels.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-primary/10 px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-xs font-semibold text-muted-foreground" title="Allocation order">
                      #{c.allocationOrder}
                    </span>
                    <span className="truncate font-medium">{c.name || "Unnamed channel"}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {c.state.replace("_", " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <div className="max-w-3xl mx-auto space-y-6 px-4 py-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 md:p-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-primary tracking-tight flex items-center gap-2">
            <SlidersHorizontal className="w-6 h-6" /> Admin Settings
          </h1>
          <p className="text-sm text-muted-foreground">System configuration — super admins only.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className="w-4 h-4 text-primary" /> Phone number pool
            </CardTitle>
            <CardDescription>
              Manage the Twilio numbers available for new channels. Listed busiest first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Plain-English explanation of the allocation rule (M4 tracker
                #105) so the ordering and per-number load make sense at a glance. */}
            <div className="rounded-lg border border-primary/10 bg-primary/5 px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-primary">How numbers are allocated</p>
              <p>
                Each user&apos;s channels are spread across different numbers: their first channel
                goes on the first number, their second on the next, their third on the one after,
                and so on — so a user never has two channels on the same number.
              </p>
              <p>
                Because every user starts from the top of the same list, the number at the top
                carries everyone&apos;s first channel (so it has the most channels), and the counts
                decrease down the list. Tap a number to see its channels in allocation order.
              </p>
            </div>

            {/* Summary stats — global counts. Per-number routing load is
                shown inline on each card below. */}
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-primary/5 border border-primary/10 rounded-lg px-3 py-1.5">
                <span className="font-bold text-primary text-sm">{total}</span> total
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                <span className="font-bold text-emerald-700 text-sm">{active}</span> active
              </div>
            </div>

            {/* Number list */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : numbers.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-4">
                No numbers in the pool yet. Add one below.
              </p>
            ) : (
              <ul className="space-y-2">
                {numbers.map((entry) => (
                  <li
                    key={entry.id}
                    className={`flex flex-col items-start gap-3 rounded-xl border px-4 py-3 transition-opacity min-[420px]:flex-row min-[420px]:items-center ${
                      entry.isActive ? "border-primary/15 bg-card" : "border-muted bg-muted/40 opacity-60"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleViewDetails(entry)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left rounded-lg -m-1 p-1 transition-colors hover:bg-primary/5"
                      title="View assigned channels and allocation order"
                    >
                      <Phone className="w-4 h-4 text-primary/60 shrink-0" />
                      <span className="min-w-0 break-all font-mono text-sm hover:underline">{entry.number}</span>
                    </button>

                    <div className="flex w-full flex-wrap items-center gap-2 min-[420px]:w-auto min-[420px]:justify-end">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-semibold shrink-0 ${
                          entry.channelCount === 0
                            ? "text-emerald-700 border-emerald-300 bg-emerald-50"
                            : "text-amber-700 border-amber-300 bg-amber-50"
                        }`}
                        title={
                          entry.channelCount === 0
                            ? "Not currently routing any channel"
                            : `Routing ${entry.channelCount} channel${entry.channelCount === 1 ? "" : "s"}`
                        }
                      >
                        {entry.channelCount === 0
                          ? "Unassigned"
                          : `${entry.channelCount} channel${entry.channelCount === 1 ? "" : "s"}`}
                      </Badge>

                      <button
                        type="button"
                        onClick={() => handleToggle(entry)}
                        disabled={pendingId === entry.id}
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary disabled:opacity-50"
                        aria-label={entry.isActive ? "Deactivate" : "Activate"}
                        title={entry.isActive ? "Deactivate" : "Activate"}
                      >
                        {pendingId === entry.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : entry.isActive ? (
                          <ToggleRight className="w-5 h-5 text-primary" />
                        ) : (
                          <ToggleLeft className="w-5 h-5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(entry)}
                        disabled={entry.channelCount > 0 || pendingId === entry.id}
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label={`Remove ${entry.number}`}
                        title={
                          entry.channelCount > 0
                            ? `Cannot remove — routing ${entry.channelCount} channel${entry.channelCount === 1 ? "" : "s"}`
                            : "Remove"
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Add number form */}
            <div className="flex flex-col gap-2 pt-1 border-t border-primary/10 sm:flex-row">
              <Input
                placeholder="+441234567890"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !adding && handleAdd()}
                className="h-11 flex-1 font-mono"
              />
              <Button onClick={handleAdd} disabled={adding || !newNumber.trim()} className="h-11 w-full shrink-0 sm:w-auto">
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
                {adding ? "Adding…" : "Add"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Use E.164 format, e.g. <span className="font-mono">+441234567890</span>. Only unassigned numbers can be removed.
            </p>
          </CardContent>
        </Card>

        {/* Test-environment reset — only shown when connected to a Stripe test
            account, so it can never run against live data (M4 #95). */}
        {testEnv && (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <AlertTriangle className="w-4 h-4" /> Test environment — reset data
              </CardTitle>
              <CardDescription>
                Clear all test data so you can start a fresh test run. This is only available because this
                deployment is connected to a Stripe test account; it can never run against live data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {testCounts && (
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="rounded-lg border border-primary/10 bg-primary/5 px-3 py-1.5">
                    <span className="font-bold text-primary text-sm">{testCounts.users}</span> test users
                  </span>
                  <span className="rounded-lg border border-primary/10 bg-primary/5 px-3 py-1.5">
                    <span className="font-bold text-primary text-sm">{testCounts.channels}</span> channels
                  </span>
                  <span className="rounded-lg border border-primary/10 bg-primary/5 px-3 py-1.5">
                    <span className="font-bold text-primary text-sm">{testCounts.subscriptions}</span> subscriptions
                  </span>
                  <span className="rounded-lg border border-primary/10 bg-primary/5 px-3 py-1.5">
                    <span className="font-bold text-primary text-sm">{testCounts.numbersInUse}</span> numbers in use
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Deletes every user and viewer account, all channels, subscriptions, messages, images and
                invites, and the matching customers in the Stripe test account. Staff accounts, the number
                pool and the AI prompts are kept. Frees all five numbers for immediate reuse.
              </p>
              <Button
                variant="destructive"
                onClick={handleResetTestData}
                disabled={resetting}
                className="h-11"
              >
                {resetting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                {resetting ? "Resetting…" : "Reset test data"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
