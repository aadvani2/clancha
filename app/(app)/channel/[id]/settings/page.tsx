"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Baby, Plus, Trash2, Shield, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAppSelector } from "@/hooks/redux";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDate } from "@/lib/utils/formatDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateOfBirthInput } from "@/components/ui/date-of-birth-input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ViewerManagement } from "@/components/channel/ViewerManagement";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ParticipantHours {
  userId: string;
  name: string;
  phone: string;
  receivingHoursStart: string | null;
  receivingHoursEnd: string | null;
  timezone: string;
}

export default function ChannelSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const channelId = params.id as string;
  const { toast } = useToast();
  const currentUser = useAppSelector((state) => state.user.currentUser);
  const isViewer = currentUser?.role === "viewer";
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog();

  const handleRemoveChild = async (idx: number) => {
    const target = children[idx];
    const label = target?.name?.trim() || `child ${idx + 1}`;
    const ok = await confirmDialog({
      title: "Remove this child?",
      description: `Remove ${label} from this channel's linked children. Either parent can add them back later.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setChildren((prev) => prev.filter((_, i) => i !== idx));
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelPhone, setChannelPhone] = useState("");
  const [participant, setParticipant] = useState<{ phone: string; name: string } | null>(null);
  const [subscriptionName, setSubscriptionName] = useState("");
  const [subscriptionExpiry, setSubscriptionExpiry] = useState<string | null>(null);
  const [rewriteTone, setRewriteTone] = useState("calm_clear");
  const [emergencyBypassEnabled, setEmergencyBypassEnabled] = useState(true);
  const [pictureShareEnabled, setPictureShareEnabled] = useState(false);
  const [pictureShareInitial, setPictureShareInitial] = useState(false);
  // Scheduled-removal date (#82) and whether the current user is the one
  // billed for the add-on (#81).
  const [pictureShareRemoveAt, setPictureShareRemoveAt] = useState<string | null>(null);
  const [pictureAddonPurchasedByMe, setPictureAddonPurchasedByMe] = useState(false);
  // #100: whether the payer is known, who they are, and — for the viewer
  // enabling — whether it attaches to their core sub (creator) or is standalone
  // (joining user). Drives the grey-out and the role-aware copy (#101).
  const [pictureAddonPayerKnown, setPictureAddonPayerKnown] = useState(false);
  const [pictureAddonPayerName, setPictureAddonPayerName] = useState<string | null>(null);
  const [pictureAddonAttachesToCore, setPictureAddonAttachesToCore] = useState(false);
  const [channelState, setChannelState] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantHours[] | null>(null);
  // Linked children — per-channel, editable by either parent (and admin).
  const [children, setChildren] = useState<Array<{ name: string; dob: string }>>([]);

  useEffect(() => {
    // Viewers are read-only — no access to channel settings per spec.
    // The API already 403s the GET, but rendering the empty form is
    // misleading. Send them back to the channel view.
    if (currentUser && isViewer) {
      router.replace(`/channel/${channelId}`);
    }
  }, [currentUser, isViewer, router, channelId]);

  useEffect(() => {
    if (!channelId || isViewer) return;
    fetch("/api/channels/" + channelId + "/settings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.state) setChannelState(d.state);
        if (d.channelName != null) setChannelName(d.channelName);
        if (d.channelPhone != null) setChannelPhone(d.channelPhone);
        if (d.participant) setParticipant(d.participant);
        if (d.subscriptionName != null) setSubscriptionName(d.subscriptionName);
        if (d.subscriptionExpiry != null) setSubscriptionExpiry(d.subscriptionExpiry);
        if (d.rewriteTone) setRewriteTone(d.rewriteTone);
        if (typeof d.emergencyBypassEnabled === "boolean")
          setEmergencyBypassEnabled(d.emergencyBypassEnabled);
        if (typeof d.pictureShareEnabled === "boolean") {
          // When a removal is already scheduled the user's saved intent is OFF.
          // Initialise the toggle to that effective state so it doesn't snap
          // back to ON after a page refresh (Test 82).
          const effectiveEnabled = d.pictureShareEnabled && !d.pictureShareRemoveAt;
          setPictureShareEnabled(effectiveEnabled);
          setPictureShareInitial(effectiveEnabled);
        }
        if (d.pictureShareRemoveAt !== undefined) setPictureShareRemoveAt(d.pictureShareRemoveAt);
        if (typeof d.pictureAddonPurchasedByMe === "boolean")
          setPictureAddonPurchasedByMe(d.pictureAddonPurchasedByMe);
        if (typeof d.pictureAddonPayerKnown === "boolean")
          setPictureAddonPayerKnown(d.pictureAddonPayerKnown);
        if (d.pictureAddonPayerName !== undefined)
          setPictureAddonPayerName(d.pictureAddonPayerName);
        if (typeof d.pictureAddonAttachesToCore === "boolean")
          setPictureAddonAttachesToCore(d.pictureAddonAttachesToCore);
        if (Array.isArray(d.participants)) setParticipants(d.participants);
        if (Array.isArray(d.linkedChildren)) {
          setChildren(
            d.linkedChildren.map((c: { name?: string; dob?: string | null }) => ({
              name: c.name ?? "",
              dob: c.dob ?? "",
            }))
          );
        }
      })
      .finally(() => setLoading(false));
  }, [channelId]);

  const updateParticipantHours = (
    userId: string,
    field: "receivingHoursStart" | "receivingHoursEnd",
    value: string
  ) => {
    setParticipants((prev) =>
      prev
        ? prev.map((p) => (p.userId === userId ? { ...p, [field]: value || null } : p))
        : prev
    );
  };

  // Returning from the Picture Sharing Checkout (#81) — confirm enablement.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("picture") === "enabled") {
      setPictureShareEnabled(true);
      setPictureShareInitial(true);
      toast({
        title: "Picture Sharing enabled",
        description: "Your payment is set up — Picture Sharing is now on for this channel.",
      });
      window.history.replaceState({}, "", `/channel/${channelId}/settings`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // Turning Picture Sharing OFF is a scheduled removal (#82): confirm and
    // explain access is kept until the period end, with no refund.
    if (pictureShareInitial && !pictureShareEnabled) {
      const dateStr = subscriptionExpiry ? formatDate(subscriptionExpiry) : null;
      const ok = await confirmDialog({
        title: "Turn off Picture Sharing?",
        description: dateStr
          ? `Picture Sharing will be removed on ${dateStr}. You will keep access until then. No refund is given for the current period.`
          : "Picture Sharing will be removed at the end of your current billing period. You will keep access until then. No refund is given for the current period.",
        confirmLabel: "Turn off",
        variant: "destructive",
      });
      if (!ok) {
        setPictureShareEnabled(true); // revert the toggle
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/channels/" + channelId + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channelName: channelName.trim() || undefined,
          subscriptionName: subscriptionName.trim() || undefined,
          participantPhone: participant?.phone?.trim() || undefined,
          rewriteTone,
          emergencyBypassEnabled,
          ...(pictureShareEnabled !== pictureShareInitial ? { pictureShareEnabled } : {}),
          ...(participants
            ? {
                participantUpdates: participants.map((p) => ({
                  userId: p.userId,
                  receivingHoursStart: p.receivingHoursStart,
                  receivingHoursEnd: p.receivingHoursEnd,
                })),
              }
            : {}),
          // Drop blank rows; server will also validate.
          linkedChildren: children
            .filter((c) => c.name.trim().length > 0)
            .map((c) => ({ name: c.name.trim(), dob: c.dob || undefined })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Failed to save",
          description: (data.error as string) || `Something went wrong (${res.status})`,
          variant: "destructive",
        });
        return;
      }

      // Joining user enabling the add-on with no subscription: pay on their
      // own customer via Stripe Checkout (#81).
      if (data.pictureCheckoutUrl) {
        toast({
          title: "Redirecting to secure checkout",
          description: "Add a payment method to enable Picture Sharing for this channel.",
        });
        window.location.href = data.pictureCheckoutUrl as string;
        return;
      }

      if (data.pictureRemoveAt) {
        // Scheduled removal confirmed (#82).
        setPictureShareRemoveAt(data.pictureRemoveAt as string);
        toast({
          title: "Picture Sharing will be removed",
          description: `You'll keep access until ${formatDate(
            data.pictureRemoveAt as string
          )}. No refund for the current period.`,
        });
      } else {
        toast({
          title: "Settings saved",
          description: "Your channel settings have been updated.",
        });
        if (pictureShareEnabled) setPictureShareRemoveAt(null);
      }
      setPictureShareInitial(pictureShareEnabled);
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : "Network error. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (isViewer) {
    return (
      <ScrollArea className="h-full px-4 sm:px-8 py-6 sm:py-8">
        <Card className="border-primary/10 max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-primary">Access restricted</h2>
              <p className="text-sm text-muted-foreground">
                Channel settings are managed by the channel members. Viewers can read messages but cannot change settings.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href={`/channel/${channelId}`}>Back to channel</Link>
            </Button>
          </CardContent>
        </Card>
      </ScrollArea>
    );
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-8">
        <p className="text-muted-foreground">Loading settings…</p>
      </div>
    );
  }

  // view_only and closed channels are fully read-only for non-admin users.
  const isReadOnly = channelState === "view_only" || channelState === "closed";

  // Non-payer cannot cancel an active add-on (#100): grey out + lock the toggle
  // when Picture Sharing is on, the payer is known, and it isn't the viewer.
  const pictureLocked =
    isReadOnly ||
    ((pictureShareInitial || !!pictureShareRemoveAt) &&
      pictureAddonPayerKnown &&
      !pictureAddonPurchasedByMe);

  // Role-aware Picture Sharing copy (#101).
  const pictureShareHelp = (() => {
    // Check removal scheduling first — independent of pictureShareInitial so
    // the "will be removed" copy still shows after a page refresh where the
    // toggle is now initialised to OFF (Test 82).
    if (pictureShareRemoveAt) {
      return pictureAddonPurchasedByMe
        ? `Picture Sharing will be removed on ${formatDate(
            pictureShareRemoveAt
          )}. You'll keep access until then — turn it back on to keep it.`
        : `Picture Sharing will be removed on ${formatDate(
            pictureShareRemoveAt
          )}. You'll keep access until then.`;
    }
    if (pictureShareInitial) {
      if (pictureAddonPurchasedByMe) {
        return "Picture Sharing is on for this channel, billed to you (£4.99/mo). You can turn it off — you'll keep access until the end of the current billing period.";
      }
      if (pictureLocked) {
        return `Picture Sharing is on for this channel and paid for by ${
          pictureAddonPayerName ?? "the other user"
        }. You're not charged for it, and only they can turn it off.`;
      }
      // Payer unknown (legacy channel) — keep it changeable, neutral wording.
      return "Picture Sharing is on for this channel. You'll keep access until the end of the current billing period.";
    }
    // Enabling — role-aware.
    if (pictureAddonAttachesToCore) {
      return `Add Picture Sharing to this channel. Either user can enable it; whoever turns it on pays the £4.99/mo. It's added to your existing subscription, pro-rated and charged today, then renews at £19.98/month on your billing date${
        subscriptionExpiry ? ` (${formatDate(subscriptionExpiry)})` : ""
      }.`;
    }
    return "Add Picture Sharing to this channel. Either user can enable it; whoever turns it on pays the £4.99/mo. You'll be taken to secure checkout to pay on your own card — £4.99 today, renewing monthly on your own billing date.";
  })();

  return (
    <ScrollArea className="h-full">
      {confirmDialogNode}
      <div className="max-w-xl mx-auto px-4 py-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
        <Button variant="ghost" size="icon" asChild className="mb-4">
          <Link href={"/channel/" + channelId}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>

        {isReadOnly && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              This channel is{" "}
              <span className="font-semibold">
                {channelState === "closed" ? "closed" : "view-only"}
              </span>{" "}
              — settings are read-only. Message history is still accessible.
            </p>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Channel settings</CardTitle>
            <CardDescription>
              Channel details, rewrite tone, and emergency bypass.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="channelName">Channel name</Label>
              <Input
                id="channelName"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="e.g. Family channel"
                disabled={isReadOnly}
                className={isReadOnly ? "bg-muted" : ""}
              />
            </div>

            <div className="space-y-2">
              <Label>Channel phone</Label>
              <Input value={channelPhone} readOnly disabled className="bg-muted" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="participantPhone">Participant phone</Label>
              <Input
                id="participantPhone"
                value={participant?.phone ?? ""}
                onChange={(e) =>
                  setParticipant((p) =>
                    p ? { ...p, phone: e.target.value } : { phone: e.target.value, name: "" }
                  )
                }
                placeholder="e.g. +447700900123"
                disabled={isReadOnly}
                className={isReadOnly ? "bg-muted" : ""}
              />
              {participant?.name && (
                <p className="text-xs text-muted-foreground">Name: {participant.name}</p>
              )}
            </div>

            {/* Subscription name/expiry are billing fields — hidden when read-only */}
            {!isReadOnly && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="subscriptionName">Subscription name</Label>
                  <Input
                    id="subscriptionName"
                    value={subscriptionName}
                    onChange={(e) => setSubscriptionName(e.target.value)}
                    placeholder="e.g. Premium Family"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Subscription expiry</Label>
                  <Input
                    value={formatDate(subscriptionExpiry)}
                    readOnly
                    disabled
                    className="bg-muted"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>Rewrite tone</Label>
              <Select value={rewriteTone} onValueChange={isReadOnly ? undefined : setRewriteTone} disabled={isReadOnly}>
                <SelectTrigger className={isReadOnly ? "bg-muted" : ""}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="calm_clear">Calm & Clear</SelectItem>
                  <SelectItem value="firm_fair">Firm & Fair</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Tone change only applies to messages you send.
              </p>
            </div>

            {participants && participants.length > 0 && (
              <div className="space-y-3 p-4 rounded-xl border border-primary/10 bg-primary/5">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Receiving hours</h3>
                  <p className="text-xs text-muted-foreground">
                    Hours during which each user receives messages. Set per user — admins can amend either.
                  </p>
                </div>
                <div className="space-y-4">
                  {participants.map((p) => {
                    const label = p.name?.trim() || p.phone || p.userId;
                    return (
                      <div key={p.userId} className="space-y-2 pt-3 border-t border-primary/10 first:border-t-0 first:pt-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">{p.timezone}</p>
                        </div>
                        {/* Stack below sm — two native time inputs overlap in
                            380px-breakpoint columns on phones (Craig §2.8). */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1 min-w-0">
                            <Label htmlFor={`rh-start-${p.userId}`} className="text-xs">
                              Start
                            </Label>
                            <Input
                              id={`rh-start-${p.userId}`}
                              type="time"
                              value={p.receivingHoursStart ?? ""}
                              onChange={(e) =>
                                updateParticipantHours(p.userId, "receivingHoursStart", e.target.value)
                              }
                              disabled={isReadOnly}
                              className={`w-full min-w-0 ${isReadOnly ? "bg-muted" : ""}`}
                            />
                          </div>
                          <div className="space-y-1 min-w-0">
                            <Label htmlFor={`rh-end-${p.userId}`} className="text-xs">
                              End
                            </Label>
                            <Input
                              id={`rh-end-${p.userId}`}
                              type="time"
                              value={p.receivingHoursEnd ?? ""}
                              onChange={(e) =>
                                updateParticipantHours(p.userId, "receivingHoursEnd", e.target.value)
                              }
                              disabled={isReadOnly}
                              className={`w-full min-w-0 ${isReadOnly ? "bg-muted" : ""}`}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-primary/10 bg-primary/5 transition-all duration-300">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-md bg-white shadow-sm border border-primary/5 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                      <path d="M12 8v4" />
                      <path d="M12 16h.01" />
                    </svg>
                  </span>
                  <label htmlFor="emergency" className="text-sm font-semibold cursor-pointer">
                    Emergency Bypass
                  </label>
                </div>
                <p className="text-xs text-muted-foreground max-w-[340px]">
                  When enabled, typing &ldquo;Emergency&rdquo; allows urgent messages to bypass the recipient&rsquo;s receiving hours for immediate delivery.
                </p>
              </div>

              <button
                id="emergency"
                type="button"
                role="switch"
                aria-checked={emergencyBypassEnabled}
                disabled={isReadOnly}
                onClick={() => { if (!isReadOnly) setEmergencyBypassEnabled(!emergencyBypassEnabled); }}
                className={`${
                  emergencyBypassEnabled ? "bg-primary" : "bg-muted"
                } relative inline-flex h-8 w-14 shrink-0 rounded-full border-2 border-transparent transition-all duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${isReadOnly ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:scale-105 active:scale-95"}`}
              >
                <span
                  aria-hidden="true"
                  className={`${
                    emergencyBypassEnabled ? "translate-x-6" : "translate-x-0"
                  } pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-300 ease-in-out`}
                />
              </button>
            </div>

            {!isReadOnly && <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-primary/10 bg-primary/5 transition-all duration-300">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-md bg-white shadow-sm border border-primary/5 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </span>
                  <label htmlFor="pictureShare" className="text-sm font-semibold cursor-pointer">
                    Picture Sharing (£4.99/mo)
                  </label>
                </div>
                <p className="text-xs text-muted-foreground max-w-[340px]">
                  {pictureShareHelp}
                </p>
                <p className="text-xs text-muted-foreground max-w-[340px] mt-1.5 italic">
                  Images are checked by Clancha before they appear.
                </p>
              </div>

              <button
                id="pictureShare"
                type="button"
                role="switch"
                aria-checked={pictureShareEnabled}
                disabled={pictureLocked}
                onClick={() => {
                  if (!pictureLocked) setPictureShareEnabled(!pictureShareEnabled);
                }}
                title={
                  pictureLocked
                    ? "Only the person paying for Picture Sharing can turn it off."
                    : undefined
                }
                className={`${
                  pictureShareEnabled ? "bg-primary" : "bg-muted"
                } relative inline-flex h-8 w-14 shrink-0 rounded-full border-2 border-transparent transition-all duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  pictureLocked
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer hover:scale-105 active:scale-95"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`${
                    pictureShareEnabled ? "translate-x-6" : "translate-x-0"
                  } pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-300 ease-in-out`}
                />
              </button>
            </div>}

            {/* Linked children — per-channel, both parents can edit. Saved
                alongside the rest of the form so one Save covers everything. */}
            <div className="space-y-3 p-4 rounded-xl border border-primary/10 bg-primary/5">
              <div className="flex items-center gap-2">
                <Baby className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Linked children</h3>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                Names of the children this channel is about. Either parent can add or remove.
              </p>

              {children.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">No children added yet.</p>
              ) : (
                <div className="space-y-2">
                  {children.map((child, idx) => (
                    <div key={idx} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1 min-w-0 space-y-1">
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Name</Label>
                        <Input
                          value={child.name}
                          onChange={(e) =>
                            setChildren((prev) =>
                              prev.map((c, i) => (i === idx ? { ...c, name: e.target.value } : c))
                            )
                          }
                          placeholder="Child's name"
                          className="h-10"
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="w-full sm:w-44 space-y-1">
                        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Date of birth (optional)</Label>
                        <DateOfBirthInput
                          value={child.dob}
                          onChange={(iso) =>
                            setChildren((prev) =>
                              prev.map((c, i) => (i === idx ? { ...c, dob: iso } : c))
                            )
                          }
                          className="h-10"
                          disabled={isReadOnly}
                        />
                      </div>
                      {!isReadOnly && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 shrink-0 text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemoveChild(idx)}
                          aria-label="Remove this child"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!isReadOnly && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => setChildren((prev) => [...prev, { name: "", dob: "" }])}
                    disabled={children.length >= 12}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add child
                  </Button>
                  {children.length >= 12 && (
                    <p className="text-[11px] text-muted-foreground">
                      Maximum of 12 children per channel.
                    </p>
                  )}
                </>
              )}
            </div>

            {!isReadOnly && (
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
            </form>
          </CardContent>
        </Card>

        {/* Third-party viewers — list, invite, revoke. Hidden when channel is read-only. */}
        {channelId && !isReadOnly && <ViewerManagement channelId={channelId} />}
      </div>
    </ScrollArea>
  );
}
