"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChannelList, type ChannelItem } from "@/components/channel/ChannelList";
import { AdminChannelTable } from "@/components/admin/AdminChannelTable";
import { CreateChannelModal } from "@/components/CreateChannelModal";
import { WelcomeChannelDialog } from "@/components/channel/WelcomeChannelDialog";
import { JoinerWelcomeDialog } from "@/components/channel/JoinerWelcomeDialog";
import { useAppSelector, useAppDispatch } from "@/hooks/redux";
import { setUser } from "@/store/userSlice";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

// Stripe Checkout drops the user back at /dashboard?welcome=1&session_id=...
// before the invoice.paid webhook has finished materialising the channel from
// the PendingChannelRequest. The bare GET above runs once on mount and used to
// resolve to an empty list, so the user saw "No channels yet" and assumed
// payment failed. We treat any "welcome=…" param (the previous code only
// matched the literal string "true" but the success_url emits "welcome=1") as
// a signal to wait for the webhook and show the assigned-number guidance.
const hasWelcomeFlag = (params: URLSearchParams): boolean => {
  const v = params.get("welcome");
  return v !== null && v !== "" && v !== "0" && v !== "false";
};

const newestByCreated = (list: ChannelItem[]): ChannelItem | null => {
  if (list.length === 0) return null;
  return [...list].sort(
    (a, b) =>
      new Date(b.createdAt as unknown as string).getTime() -
      new Date(a.createdAt as unknown as string).getTime()
  )[0];
};

export default function DashboardPage() {
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [welcomeChannel, setWelcomeChannel] = useState<ChannelItem | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const welcomeHandledRef = useRef(false);
  const [joinerChannel, setJoinerChannel] = useState<ChannelItem | null>(null);
  const [joinerInviterName, setJoinerInviterName] = useState<string | null>(null);
  const [joinerOpen, setJoinerOpen] = useState(false);
  const joinerHandledRef = useRef(false);
  const { isAuthenticated } = useAppSelector((state) => state.auth);
  const { currentUser } = useAppSelector((state) => state.user);
  const router = useRouter();
  const { toast } = useToast();


  useEffect(() => {
    setLoading(true);
    fetch("/api/channels", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data.channels) setChannels(data.channels);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  const onChannelCreated = (ch: ChannelItem) => {
    setChannels((prev) => [...prev, ch]);
    setCreateOpen(false);
    // Mirror the first-signup confirmation: each channel gets its own neutral
    // Clancha number from the shared pool, so after an additional channel is
    // created surface that number + the other party's name and prompt the user
    // to save it (#102). Reuses the WelcomeChannelDialog used post-Checkout.
    setWelcomeChannel(ch);
    setWelcomeOpen(true);
  };

  const dispatch = useAppDispatch();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success" || hasWelcomeFlag(params)) {
        fetch(`/api/users/me?t=${Date.now()}`, { credentials: "include" })
          .then((res) => res.json())
          .then((data) => {
            if (data.id) {
                const updatedUser = {
                    id: data.id,
                    email: data.email,
                    role: data.role,
                    phone: data.phone,
                    name: data.name,
                    maxChannels: 5,
                    isSubscribed: data.isSubscribed,
                    isPictureAddonEnabled: data.isPictureAddonEnabled,
                    subscriptionQuantity: data.subscriptionQuantity,
                };
                dispatch(setUser(updatedUser));
                localStorage.setItem("user", JSON.stringify(updatedUser));

                if (data.isSubscribed) {
                    toast({
                        title: "Subscription Active",
                        description: "Your subscription is now active. You can create channels!",
                        variant: "default",
                    });
                }
            }
          });
    }
  }, [dispatch, toast]);

  // Post-Checkout return: wait for the channel to materialise, then surface
  // the assigned Clancha number + save-as-contact guidance. Runs once per
  // mount when welcome=1 is set on the URL. Polls every 2.5s for up to 60s,
  // which comfortably covers the Stripe → webhook round-trip even on a cold
  // serverless invocation.
  useEffect(() => {
    if (loading) return;
    if (welcomeHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    if (!hasWelcomeFlag(params)) return;
    welcomeHandledRef.current = true;

    const showFor = (list: ChannelItem[]) => {
      const newest = newestByCreated(list);
      if (!newest) return;
      setWelcomeChannel(newest);
      setWelcomeOpen(true);
    };

    if (channels.length > 0) {
      showFor(channels);
      return;
    }

    setSettingUp(true);
    let cancelled = false;
    const startedAt = Date.now();
    const MAX_MS = 60_000;
    const POLL_MS = 2_500;

    const interval = window.setInterval(async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > MAX_MS) {
        window.clearInterval(interval);
        if (!cancelled) setSettingUp(false);
        return;
      }
      try {
        const res = await fetch("/api/channels", { credentials: "include" });
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data?.channels) && data.channels.length > 0) {
          window.clearInterval(interval);
          setChannels(data.channels);
          setSettingUp(false);
          showFor(data.channels);
        }
      } catch {
        // transient — keep polling until timeout
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [loading, channels]);

  // Joiner (second-parent) post-OTP landing. Triggered by /join?t=…
  // forwarding to /dashboard?joined=1&channelId=… on successful verify.
  // Different dialog from the inviter's WelcomeChannelDialog: framed around
  // receiving messages, plus a reminder that defaults (06:00-23:00,
  // emergency on, Calm & Clear) were seeded server-side.
  useEffect(() => {
    if (loading) return;
    if (joinerHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("joined") !== "1") return;
    const joinedChannelId = params.get("channelId");
    if (!joinedChannelId) return;
    joinerHandledRef.current = true;

    // Look up the joined channel from the freshly-loaded list. The joiner is
    // already a participant on the channel (added at sign-up time by the
    // inviter), so a normal GET /api/channels will include it.
    const target = channels.find((c) => c.id === joinedChannelId);
    if (!target) return;
    setJoinerChannel(target);

    // Pull the inviter's name from the channel detail (the "other user" on a
    // two-participant channel, from the joiner's perspective).
    fetch(`/api/channels/${joinedChannelId}`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        const name =
          (typeof data?.otherUserName === "string" && data.otherUserName.trim()) ||
          null;
        setJoinerInviterName(name);
      })
      .catch(() => setJoinerInviterName(null))
      .finally(() => setJoinerOpen(true));
  }, [loading, channels, currentUser?.id]);

  const handleJoinerClose = (open: boolean) => {
    setJoinerOpen(open);
    if (open) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("joined");
      url.searchParams.delete("channelId");
      const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "");
      router.replace(next);
    } catch {
      // no-op
    }
  };

  // Clear welcome params from the URL once the user dismisses the dialog so a
  // browser refresh doesn't re-enter the polling/welcome flow.
  const handleWelcomeClose = (open: boolean) => {
    setWelcomeOpen(open);
    if (open) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("welcome");
      url.searchParams.delete("session_id");
      const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "");
      router.replace(next);
    } catch {
      // no-op
    }
  };

  const handleCreateClick = () => {
    if (!currentUser) {
      toast({
        title: "Loading Profile",
        description: "Please wait a moment while we sync your subscription.",
      });
      return;
    }

    // Pre-2026-05-26 this gated on `currentUser.isSubscribed` which was never
    // reliably set and silently routed subscribed users to /subscription (old
    // plan-picker) — that bypassed the channel-setup form and created a
    // brand new Stripe subscription per channel instead of bumping the
    // existing one (Craig M4 2026-05-26 #2 + #3). The modal POSTs to
    // /api/channels which itself handles the no-stripe-customer redirect to
    // Stripe Checkout, so for both subscribed and unsubscribed users the
    // right thing is to open the form.
    setCreateOpen(true);
  };

  return (
    <ScrollArea className="h-full">
      <div className={`mx-auto px-4 pt-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 sm:py-8 space-y-5 ${currentUser?.role === "admin" || currentUser?.role === "super_admin" || currentUser?.role === "moderator" ? "max-w-6xl" : "max-w-2xl"}`}>
        <div className="rounded-[2rem] border border-white/70 bg-white/80 p-5 shadow-[0_18px_50px_rgba(47,74,68,0.10)] backdrop-blur-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-0">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary/60">
                Dashboard
              </p>
              <h2 className="text-3xl sm:text-2xl font-bold text-[#2f4a44] sm:text-primary tracking-tight">
                {currentUser?.role === "admin" || currentUser?.role === "super_admin"
                  ? "All Channels"
                  : currentUser?.role === "viewer"
                    ? "Channels you can view"
                    : "Your channels"}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {currentUser?.role === "admin" || currentUser?.role === "super_admin"
                  ? "Manage all communication channels across the platform."
                  : currentUser?.role === "viewer"
                    ? "Read-only access to the channels you've been added to."
                    : "Manage your communication channels."}
              </p>
            </div>
            {currentUser?.role !== "admin"
              && currentUser?.role !== "super_admin"
              && currentUser?.role !== "moderator"
              && currentUser?.role !== "viewer" && (
              <Button
                className="h-12 w-full sm:w-auto bg-primary hover:bg-primary/90 flex items-center justify-center gap-2 rounded-2xl sm:rounded-full px-6 shadow-lg shadow-primary/20 active:scale-[0.98]"
                onClick={handleCreateClick}
              >
                <Plus className="w-4 h-4" /> Create channel
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="rounded-[1.5rem] border border-white/70 bg-white/70 p-5 text-sm text-muted-foreground shadow-sm">
            Loading channels...
          </div>
        ) : settingUp && channels.length === 0 ? (
          <div className="rounded-[1.5rem] border border-primary/15 bg-white/80 p-6 shadow-sm flex flex-col items-center text-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="font-bold text-foreground">Setting up your channel…</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Payment received. We&apos;re assigning your Clancha number — this
                usually takes a few seconds. You&apos;ll see your channel here
                shortly.
              </p>
            </div>
          </div>
        ) : (
          currentUser?.role === "admin" || currentUser?.role === "super_admin" || currentUser?.role === "moderator" ? (
             <AdminChannelTable />
          ) : (
            <ChannelList
              channels={channels}
              onCreateClick={handleCreateClick}
              onChannelLeft={(channelId) =>
                setChannels((prev) => prev.filter((c) => c.id !== channelId))
              }
            />
          )
        )}
      </div>

      <CreateChannelModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={onChannelCreated}
      />

      {welcomeChannel && (
        <WelcomeChannelDialog
          open={welcomeOpen}
          onOpenChange={handleWelcomeClose}
          recipientName={welcomeChannel.otherPartyName ?? welcomeChannel.name ?? null}
          clanchaNumber={welcomeChannel.clanchaNumber}
        />
      )}

      {joinerChannel && (
        <JoinerWelcomeDialog
          open={joinerOpen}
          onOpenChange={handleJoinerClose}
          inviterName={joinerInviterName}
          clanchaNumber={joinerChannel.clanchaNumber}
        />
      )}
    </ScrollArea>
  );
}
