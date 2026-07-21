"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Shield,
  ShieldAlert,
  Pause,
  XCircle,
  Play,
  Lock,
  Save,
  Users as UsersIcon,
  CreditCard,
  Phone,
  Mail,
  Clock,
  Baby,
  Plus,
  Trash2,
  Eye,
  History,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppSelector } from "@/hooks/redux";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";
import { isPlaceholderEmail } from "@/lib/utils/placeholderEmail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ParticipantDetail {
  userId: string;
  name: string;
  email: string;
  phone: string;
  receivingHoursStart: string | null;
  receivingHoursEnd: string | null;
  timezone: string;
}

interface SubscriptionInfo {
  id: string;
  stripeSubscriptionId: string | null;
  name: string | null;
  plan: string;
  status: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd: string | null;
}

interface BillingHistory {
  lastPaymentStatus: string | null;
  lastPaymentDate: string | null;
  failedCount: number;
}

interface ViewerRow {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  invitingParentUserId: string;
  invitingParentName: string | null;
  otherParentApproved: boolean;
  consentLabel: string;
  grantedAt: string | null;
  lastAccessedAt: string | null;
}

interface MessageHistoryRow {
  id: string;
  senderId: string | null;
  senderName: string;
  originalText: string;
  rewrittenText: string;
  state: string;
  isSystem: boolean;
  isEmergency: boolean;
  createdAt: string | null;
}

interface ChannelDetail {
  channelId: string;
  channelName: string;
  participantsLabel: string;
  channelPhone: string;
  state: "trial" | "active" | "view_only" | "closed";
  subscriptionLabel: string;
  pictureShareEnabled: boolean;
  emergencyBypassEnabled: boolean;
  participants: ParticipantDetail[];
  subscription: SubscriptionInfo | null;
  billingHistory: BillingHistory;
  linkedChildren: Array<{ id: string; name: string; dob?: string }>;
  viewers?: ViewerRow[];
  createdAt: string | null;
}

type AdminAction = "suspend" | "cancel" | "uncancel" | "reactivate" | "close";

// Cancel/uncancel are billing-only — they flip Stripe cancel_at_period_end
// without changing channel.state. The webhook moves the channel to view_only
// when the period actually ends. Other actions still write channel.state.
const ACTION_TARGET_STATE: Record<AdminAction, ChannelDetail["state"] | null> = {
  suspend: "view_only",
  cancel: null,
  uncancel: null,
  reactivate: "active",
  close: "closed",
};

const ACTION_LABEL: Record<AdminAction, string> = {
  suspend: "Suspend",
  cancel: "Cancel at period end",
  uncancel: "Undo cancellation",
  reactivate: "Reactivate",
  close: "Close",
};

import { formatDate as sharedFormatDate } from "@/lib/utils/formatDate";
function formatDate(iso: string | null): string {
  return sharedFormatDate(iso);
}

function StateBadge({ label, state }: { label: string; state: ChannelDetail["state"] }) {
  const tone =
    state === "active"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : state === "trial"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : state === "view_only"
          ? "bg-orange-50 text-orange-700 border-orange-200"
          : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${tone}`}>
      {label}
    </span>
  );
}

export default function AdminChannelDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog();
  const channelId = params.id as string;
  const { currentUser } = useAppSelector((state) => state.user);
  const isSuperAdmin = currentUser?.role === "super_admin";

  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<AdminAction | null>(null);
  const [participantDraft, setParticipantDraft] = useState<ParticipantDetail[] | null>(null);
  const [childrenDraft, setChildrenDraft] = useState<Array<{ id: string; name: string; dob: string }>>([]);
  const [newChildName, setNewChildName] = useState("");
  const [newChildDob, setNewChildDob] = useState("");
  const [savingChildren, setSavingChildren] = useState(false);
  // Message history (M4 #88) — fetched on demand from the audit-logged route.
  const [messages, setMessages] = useState<MessageHistoryRow[] | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messagesCapped, setMessagesCapped] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/channels/${channelId}/detail`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) {
          toast({ title: "Access denied", description: "Super admin only.", variant: "destructive" });
          return;
        }
        throw new Error(`Failed (${res.status})`);
      }
      const data = (await res.json()) as ChannelDetail;
      setDetail(data);
      setParticipantDraft(data.participants);
      setChildrenDraft(
        data.linkedChildren.map((c) => ({ id: c.id, name: c.name, dob: c.dob ?? "" }))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [channelId, toast]);

  // Fetch the full read-only message history. Each call hits the audit-logged
  // admin route (M4 #88), so we only fire it when the admin opens the section.
  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const res = await fetch(`/api/admin/channels/${channelId}/messages`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 403) {
          setMessagesError("Super admin only.");
          return;
        }
        throw new Error(`Failed (${res.status})`);
      }
      const data = (await res.json()) as { messages: MessageHistoryRow[]; capped: boolean };
      setMessages(data.messages);
      setMessagesCapped(!!data.capped);
    } catch (err: unknown) {
      setMessagesError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setMessagesLoading(false);
    }
  }, [channelId]);

  const handleToggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && messages === null && !messagesLoading) {
      loadMessages();
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    if (!isSuperAdmin) {
      setLoading(false);
      return;
    }
    if (!channelId) return;
    fetchDetail();
  }, [currentUser, isSuperAdmin, channelId, fetchDetail]);

  const updateParticipant = (
    userId: string,
    field: "receivingHoursStart" | "receivingHoursEnd",
    value: string
  ) => {
    setParticipantDraft((prev) =>
      prev ? prev.map((p) => (p.userId === userId ? { ...p, [field]: value || null } : p)) : prev
    );
  };

  const handleSaveHours = async () => {
    if (!participantDraft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          participantUpdates: participantDraft.map((p) => ({
            userId: p.userId,
            receivingHoursStart: p.receivingHoursStart,
            receivingHoursEnd: p.receivingHoursEnd,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || `Save failed (${res.status})`);
      }
      toast({ title: "Receiving hours saved" });
      await fetchDetail();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      toast({ title: "Failed to save", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddChild = () => {
    const name = newChildName.trim();
    if (!name) return;
    setChildrenDraft((prev) => [
      ...prev,
      { id: `new-${Date.now()}`, name, dob: newChildDob },
    ]);
    setNewChildName("");
    setNewChildDob("");
  };

  const handleRemoveChild = async (id: string) => {
    const target = childrenDraft.find((c) => c.id === id);
    const label = target?.name?.trim() || "this child";
    const ok = await confirmDialog({
      title: "Remove this child?",
      description: `Remove ${label} from this channel's linked children. Either parent can add them back later.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setChildrenDraft((prev) => prev.filter((c) => c.id !== id));
  };

  const handleSaveChildren = async () => {
    setSavingChildren(true);
    try {
      const res = await fetch(`/api/admin/channels/${channelId}/detail`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          linkedChildren: childrenDraft.map((c) => ({ name: c.name, dob: c.dob || undefined })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error as string) || `Save failed (${res.status})`);
      toast({ title: "Children saved" });
      await fetchDetail();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      toast({ title: "Failed to save children", description: msg, variant: "destructive" });
    } finally {
      setSavingChildren(false);
    }
  };

  const handleAction = async (action: AdminAction) => {
    if (!detail) return;
    setActionInFlight(action);
    try {
      const targetState = ACTION_TARGET_STATE[action];
      const payload: Record<string, unknown> = { action };
      if (targetState) payload.state = targetState;
      const res = await fetch(`/api/admin/channels/${channelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || `Action failed (${res.status})`);
      }
      const description =
        action === "cancel"
          ? "Subscription will end at the current period close; channel stays Active until then."
          : action === "uncancel"
            ? "Subscription cancellation has been undone."
            : `Channel state is now ${targetState}.`;
      toast({ title: `${ACTION_LABEL[action]} applied`, description });
      await fetchDetail();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Action failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setActionInFlight(null);
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
              Channel administration is restricted to super admins.
            </p>
            <Button variant="outline" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </ScrollArea>
    );
  }

  if (loading || !detail) {
    return (
      <ScrollArea className="h-full px-4 sm:px-8 py-6 sm:py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ScrollArea>
    );
  }

  const canSuspend = detail.state === "active" || detail.state === "trial";
  const canReactivate = detail.state === "view_only" || detail.state === "closed";
  const canClose = detail.state !== "closed";
  // Cancel = schedule cancel_at_period_end. Only meaningful when the channel
  // has an active (non-cancelling, non-closed) Stripe subscription.
  const isCancelling = !!detail.subscription?.cancelAtPeriodEnd;
  const canCancel = detail.state !== "closed" && !isCancelling;
  const canUncancel = isCancelling;

  return (
    <ScrollArea className="h-full">
      {confirmDialogNode}
      <div className="max-w-5xl mx-auto space-y-6 px-4 py-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 md:p-8">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-primary tracking-tight">
              {detail.participantsLabel?.trim() ||
                detail.channelName?.trim() ||
                `Channel ${detail.channelId.slice(-6)}`}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="break-all">Clancha number: {detail.channelPhone}</span>
              <StateBadge label={detail.subscriptionLabel} state={detail.state} />
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="w-4 h-4 text-primary" /> Participants
            </CardTitle>
            <CardDescription>The two channel users.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {detail.participants.map((p) => (
                <div key={p.userId} className="rounded-xl border border-primary/10 p-4 space-y-2 bg-primary/5">
                  <p className="text-sm font-semibold text-primary">{p.name?.trim() || "Unnamed"}</p>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />
                    <span className="font-mono">{formatPhoneForDisplay(p.phone)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />
                    {isPlaceholderEmail(p.email) ? (
                      <span className="italic">No email yet — invite not accepted</span>
                    ) : (
                      <span>{p.email || "—"}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="w-4 h-4 text-primary" /> Receiving hours
              </CardTitle>
              <CardDescription>
                {detail.state === "closed"
                  ? "Read-only — channel is closed."
                  : "Hours during which each user receives messages. Editable."}
              </CardDescription>
            </div>
            <Button onClick={handleSaveHours} disabled={saving || detail.state === "closed"} size="sm" className={`h-10 w-full sm:h-8 sm:w-auto ${detail.state === "closed" ? "hidden" : ""}`}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(participantDraft ?? detail.participants).map((p) => (
                <div
                  key={p.userId}
                  className="space-y-2 pt-3 border-t border-primary/10 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-col gap-1 min-[420px]:flex-row min-[420px]:items-baseline min-[420px]:justify-between">
                    <p className="text-sm font-medium">{p.name?.trim() || formatPhoneForDisplay(p.phone) || p.userId}</p>
                    <p className="text-xs text-muted-foreground">{p.timezone}</p>
                  </div>
                  {/* Native time inputs have an intrinsic min-width that
                      overflows two 380px-breakpoint columns and overlaps on
                      phones (Craig, M4 feedback 05/07/26 §2.8) — stack below
                      sm and let the inputs shrink. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1 min-w-0">
                      <Label htmlFor={`adm-rh-start-${p.userId}`} className="text-xs">
                        Start
                      </Label>
                      <Input
                        id={`adm-rh-start-${p.userId}`}
                        type="time"
                        value={p.receivingHoursStart ?? ""}
                        onChange={(e) =>
                          updateParticipant(p.userId, "receivingHoursStart", e.target.value)
                        }
                        disabled={detail.state === "closed"}
                        className={`w-full min-w-0 ${detail.state === "closed" ? "bg-muted" : ""}`}
                      />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <Label htmlFor={`adm-rh-end-${p.userId}`} className="text-xs">
                        End
                      </Label>
                      <Input
                        id={`adm-rh-end-${p.userId}`}
                        type="time"
                        value={p.receivingHoursEnd ?? ""}
                        onChange={(e) =>
                          updateParticipant(p.userId, "receivingHoursEnd", e.target.value)
                        }
                        disabled={detail.state === "closed"}
                        className={`w-full min-w-0 ${detail.state === "closed" ? "bg-muted" : ""}`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="w-4 h-4 text-primary" /> Billing
            </CardTitle>
            <CardDescription>Subscription state for this channel.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">State</dt>
                <dd className="mt-1"><StateBadge label={detail.subscriptionLabel} state={detail.state} /></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Plan</dt>
                <dd className="mt-1 font-medium">{detail.subscription?.plan ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Stripe status</dt>
                <dd className="mt-1 font-medium">{detail.subscription?.status ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Renews</dt>
                <dd className="mt-1 font-medium">{formatDate(detail.subscription?.currentPeriodEnd ?? null)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Picture Sharing</dt>
                <dd className="mt-1 font-medium">{detail.pictureShareEnabled ? "Active" : "Inactive"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Stripe sub ID</dt>
                <dd className="mt-1 font-mono text-xs break-all">
                  {detail.subscription?.stripeSubscriptionId ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Last payment</dt>
                <dd className="mt-1 flex items-center gap-2">
                  {detail.billingHistory.lastPaymentStatus ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${
                        detail.billingHistory.lastPaymentStatus === "paid"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : detail.billingHistory.lastPaymentStatus === "open"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-red-50 text-red-700 border-red-200"
                      }`}
                    >
                      {detail.billingHistory.lastPaymentStatus}
                    </span>
                  ) : (
                    <span className="font-medium text-sm">—</span>
                  )}
                  {detail.billingHistory.lastPaymentDate && (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(detail.billingHistory.lastPaymentDate)}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Failed payments</dt>
                <dd className="mt-1">
                  <span
                    className={`text-sm font-semibold ${
                      detail.billingHistory.failedCount > 0 ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {detail.billingHistory.failedCount > 0
                      ? `${detail.billingHistory.failedCount} failed`
                      : "None"}
                  </span>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Baby className="w-4 h-4 text-primary" /> Linked children
              </CardTitle>
              <CardDescription>
                {detail.state === "closed"
                  ? "Read-only — channel is closed."
                  : "Children associated with this channel. Editable by super admins."}
              </CardDescription>
            </div>
            <Button onClick={handleSaveChildren} disabled={savingChildren || detail.state === "closed"} size="sm" className={`w-full sm:w-auto ${detail.state === "closed" ? "hidden" : ""}`}>
              {savingChildren ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
              {savingChildren ? "Saving…" : "Save"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {childrenDraft.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No children linked yet.</p>
            ) : (
              <ul className="space-y-2">
                {childrenDraft.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/10 bg-primary/5 px-3 py-2"
                  >
                    <Baby className="w-3.5 h-3.5 text-primary/60 shrink-0" />
                    <span className="min-w-0 flex-1 break-words text-sm font-medium">{c.name}</span>
                    {c.dob && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {formatDate(c.dob)}
                      </span>
                    )}
                    {detail.state !== "closed" && (
                      <button
                        type="button"
                        onClick={() => handleRemoveChild(c.id)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Remove ${c.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Add child form — hidden for closed channels */}
            {detail.state !== "closed" && <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-primary/10">
              <Input
                placeholder="Child's name"
                value={newChildName}
                onChange={(e) => setNewChildName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddChild()}
                className="flex-1"
              />
              <Input
                type="date"
                value={newChildDob}
                onChange={(e) => setNewChildDob(e.target.value)}
                className="w-full sm:w-40"
                aria-label="Date of birth"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddChild}
                disabled={!newChildName.trim()}
                className="shrink-0"
              >
                <Plus className="w-4 h-4 mr-1.5" /> Add
              </Button>
            </div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="w-4 h-4 text-primary" /> Third-party viewers
            </CardTitle>
            <CardDescription>
              Per-channel viewer attachments and consent state. Read-only — operational visibility for compliance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!detail?.viewers || detail.viewers.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No third-party viewer on this channel.</p>
            ) : (
              <ul className="space-y-2">
                {detail.viewers.map((v) => {
                  const consentTone = v.otherParentApproved
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-amber-50 text-amber-700 border-amber-200";
                  return (
                    <li
                      key={v.id}
                      className="rounded-lg border border-primary/10 bg-primary/5 px-3 py-2.5 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-medium text-sm">{v.name || "(no name)"}</span>
                        <span className="text-xs text-muted-foreground">— {v.email}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${consentTone}`}>
                          {v.consentLabel}
                        </span>
                        {v.invitingParentName && (
                          <span className="text-[11px] text-muted-foreground">
                            Invited by {v.invitingParentName}
                          </span>
                        )}
                        {v.lastAccessedAt && (
                          <span className="text-[11px] text-muted-foreground">
                            Last active {formatDate(v.lastAccessedAt)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-primary/20">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="w-4 h-4 text-primary" /> Message history
              </CardTitle>
              <CardDescription>
                Full read-only audit view of every message on this channel — both parents&apos; original
                text and the delivered rewrite, side by side. Admin-only; each view is recorded in the audit
                trail.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleHistory}
              disabled={messagesLoading}
              className="w-full sm:w-auto shrink-0"
            >
              {messagesLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Eye className="w-4 h-4 mr-1.5" />
              )}
              {historyOpen ? "Hide history" : "View history"}
            </Button>
          </CardHeader>
          {historyOpen && (
            <CardContent className="space-y-3">
              {messagesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : messagesError ? (
                <p className="text-sm text-destructive">{messagesError}</p>
              ) : !messages || messages.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No messages on this channel yet.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    Audit view — shows both parties&apos; originals and rewrites. Not visible to users or
                    viewers.
                  </div>
                  {messagesCapped && (
                    <p className="text-[11px] text-muted-foreground">
                      Showing the earliest 500 messages.
                    </p>
                  )}
                  <ol className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                    {messages.map((m) => (
                      <li
                        key={m.id}
                        className={`rounded-lg border px-3 py-2.5 space-y-2 ${
                          m.isSystem
                            ? "border-slate-200 bg-slate-50"
                            : "border-primary/10 bg-white"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold text-primary">{m.senderName}</span>
                          {m.isSystem && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border border-slate-300 bg-slate-100 text-slate-600">
                              System
                            </span>
                          )}
                          {m.isEmergency && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-red-200 bg-red-50 text-red-700">
                              <AlertTriangle className="w-2.5 h-2.5" /> Emergency
                            </span>
                          )}
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border border-primary/15 bg-primary/5 text-primary/80">
                            {m.state}
                          </span>
                          {m.createdAt && (
                            <span className="ml-auto text-[11px] text-muted-foreground">
                              {formatDate(m.createdAt)}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                              Original
                            </p>
                            <p className="text-sm whitespace-pre-wrap break-words text-foreground">
                              {m.originalText === "[Image]" || /^https?:\/\//.test(m.originalText ?? "")
                                ? <span className="inline-flex items-center gap-1.5 text-muted-foreground italic"><span>🖼️</span> Photo shared</span>
                                : m.originalText || <span className="text-muted-foreground italic">—</span>}
                            </p>
                          </div>
                          <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-0.5">
                              Rewritten
                            </p>
                            <p className="text-sm whitespace-pre-wrap break-words text-foreground">
                              {m.rewrittenText === "[Image]" || /^https?:\/\//.test(m.rewrittenText ?? "")
                                ? <span className="inline-flex items-center gap-1.5 text-muted-foreground italic"><span>🖼️</span> Photo shared</span>
                                : m.rewrittenText || <span className="text-muted-foreground italic">—</span>}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="w-4 h-4 text-primary" /> Admin actions
            </CardTitle>
            <CardDescription>State transitions are audit-logged.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap">
              {canSuspend && (
                <Button
                  variant="outline"
                  onClick={() => handleAction("suspend")}
                  disabled={!!actionInFlight}
                >
                  {actionInFlight === "suspend" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Pause className="w-4 h-4 mr-1.5" />
                  )}
                  Suspend
                </Button>
              )}
              {canCancel && (
                <Button
                  variant="outline"
                  onClick={() => handleAction("cancel")}
                  disabled={!!actionInFlight}
                >
                  {actionInFlight === "cancel" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <XCircle className="w-4 h-4 mr-1.5" />
                  )}
                  Cancel at period end
                </Button>
              )}
              {canUncancel && (
                <Button
                  variant="outline"
                  onClick={() => handleAction("uncancel")}
                  disabled={!!actionInFlight}
                >
                  {actionInFlight === "uncancel" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-1.5" />
                  )}
                  Undo cancellation
                </Button>
              )}
              {canReactivate && (
                <Button
                  variant="outline"
                  onClick={() => handleAction("reactivate")}
                  disabled={!!actionInFlight}
                >
                  {actionInFlight === "reactivate" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-1.5" />
                  )}
                  Reactivate
                </Button>
              )}
              {canClose && (
                <Button
                  variant="destructive"
                  onClick={() => handleAction("close")}
                  disabled={!!actionInFlight}
                >
                  {actionInFlight === "close" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Lock className="w-4 h-4 mr-1.5" />
                  )}
                  Close
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              <strong className="text-foreground">Cancel at period end</strong> schedules the subscription to end on
              the next billing date. The channel stays Active until then — no refund.{" "}
              <strong className="text-foreground">Undo cancellation</strong> removes that schedule with no new charge.{" "}
              <strong className="text-foreground">Suspend</strong> immediately moves the channel to view-only
              (admin intervention; billing is unaffected).{" "}
              <strong className="text-foreground">Reactivate</strong> brings a view-only or closed channel back to Active.{" "}
              <strong className="text-foreground">Close</strong> permanently ends the channel and stops billing —
              this can't be undone.
            </p>
            {isCancelling && detail.subscription?.currentPeriodEnd && (
              <p className="text-xs text-amber-700 mt-2 font-medium">
                Scheduled to end on {sharedFormatDate(detail.subscription.currentPeriodEnd)}. Click
                <span className="font-bold"> Undo cancellation </span>
                above to keep the subscription active.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
