"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Search, Settings, Image as ImageIcon, MessageSquare, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageTimeline } from "@/components/channel/MessageTimeline";
import { UnifiedChatFooter } from "@/components/channel/UnifiedChatFooter";
import type { MessageItem } from "@/components/channel/MessageBubble";
import { useAppSelector } from "@/hooks/redux";
import { toast } from "@/hooks/use-toast";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type TabKey = "messages" | "pictures";

export default function ChannelPage() {
  const params = useParams();
  const router = useRouter();
  const channelId = params.id as string;
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelState, setChannelState] = useState<string | null>(null);
  const [channelName, setChannelName] = useState<string | null>(null);
  const [clanchaNumber, setClanchaNumber] = useState<string | null>(null);
  // The other party's name, from this user's POV — header label per #84.
  const [otherUserName, setOtherUserName] = useState<string | null>(null);
  const [pictureShareEnabled, setPictureShareEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("messages");
  // Viewer panel — viewers aren't channel members, so neither party shows as
  // the "sender" from their POV. We pick the first channel participant from
  // the messages API response and treat their messages as right-aligned;
  // the other parent's land on the left. Members keep their normal POV.
  const [viewerSenderId, setViewerSenderId] = useState<string | undefined>(undefined);
  const currentUser = useAppSelector((state) => state.user.currentUser);
  const userId = currentUser?.id ?? "";
  const isViewer = currentUser?.role === "viewer";

  const deduplicateMessages = (prev: MessageItem[], next: MessageItem[]) => {
    const existingIds = new Set(prev.map((m) => m.id));
    const filteredNext = next.filter((m) => !existingIds.has(m.id));
    return [...prev, ...filteredNext].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  };

  const latestMessageIdRef = useRef<string | null>(null);
  latestMessageIdRef.current =
    messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null;

  const pollCountRef = useRef(0);
  const POLL_INTERVAL_MS = 500;

  const fetchNewMessages = useCallback(async () => {
    const latestId = latestMessageIdRef.current;
    const url = latestId
      ? `/api/channels/${channelId}/messages?after=${latestId}&limit=50`
      : `/api/channels/${channelId}/messages?limit=50`;
    const res = await fetch(url, { credentials: "include" });
    const data = await res.json();
    if (res.ok && data.messages?.length > 0) {
      if (latestId) {
        setMessages((prev) => deduplicateMessages(prev, data.messages));
      } else {
        setMessages(data.messages);
      }
    }
  }, [channelId]);

  const fetchMessageUpdates = useCallback(async () => {
    const res = await fetch(`/api/channels/${channelId}/messages?limit=20`, {
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok || !data.messages?.length) return;
    setMessages((prev) => {
      const freshIds = new Set(data.messages.map((m: MessageItem) => m.id));
      const notInFresh = prev.filter((m) => !freshIds.has(m.id));
      return [...notInFresh, ...data.messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
  }, [channelId]);

  const poll = useCallback(async () => {
    pollCountRef.current += 1;
    await fetchNewMessages();
    if (pollCountRef.current % 6 === 0) {
      await fetchMessageUpdates();
    }
  }, [fetchNewMessages, fetchMessageUpdates]);

  const [isMember, setIsMember] = useState<boolean>(true);

  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    (async () => {
      try {
        const [chRes, msgRes] = await Promise.all([
          fetch("/api/channels/" + channelId, { credentials: "include" }),
          fetch("/api/channels/" + channelId + "/messages?limit=50", {
            credentials: "include",
          }),
        ]);
        const chData = await chRes.json();
        const msgData = await msgRes.json();
        if (chRes.ok) {
          setChannelState(chData.state);
          setChannelName(chData.name ?? null);
          setClanchaNumber(chData.clanchaNumber ?? null);
          setOtherUserName(chData.otherUserName ?? null);
          setPictureShareEnabled(!!chData.pictureShareEnabled);
          if (chData.isMember !== undefined) setIsMember(chData.isMember);

          if (
            !chData.isMember &&
            (currentUser?.role === "admin" || currentUser?.role === "super_admin")
          ) {
            router.push("/dashboard");
            return;
          }
        }
        if (msgRes.ok && msgData.messages) {
          setMessages(msgData.messages);
          if (Array.isArray(msgData.participants) && msgData.participants.length > 0) {
            setViewerSenderId(msgData.participants[0].id);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [channelId, currentUser?.role, router]);

  useEffect(() => {
    if (!channelId || loading) return;
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [channelId, loading, poll]);

  const canSend = channelState !== "view_only" && channelState !== "closed" && isMember;

  const [leaving, setLeaving] = useState(false);
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog();
  const handleLeaveChannel = useCallback(async () => {
    setLeaving(true);
    try {
      await confirmDialog({
        title: "Leave this channel?",
        description: "Both parents will be notified and you'll lose access immediately.",
        confirmLabel: "Leave channel",
        busyLabel: "Leaving…",
        variant: "destructive",
        onConfirm: async () => {
          const res = await fetch(`/api/channels/${channelId}/viewers`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ scope: "self" }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            toast({ title: "You've left the channel", description: "Both parents have been notified." });
            router.push("/dashboard");
          } else {
            toast({
              title: "Couldn't leave channel",
              description: data.error || "Please try again.",
              variant: "destructive",
            });
            throw new Error(data.error || "leave failed");
          }
        },
      });
    } finally {
      setLeaving(false);
    }
  }, [channelId, router, confirmDialog]);

  // Pictures tab: messages that have an imageUrl and are approved
  const pictureMessages = messages.filter(
    (m) => !!m.imageUrl && m.imageState === "approved"
  );

  return (
    <div className="flex flex-col h-full">
      {confirmDialogNode}
      {/* Header */}
      <header className="flex items-center gap-2 px-3 py-3 md:px-4 border-b bg-background shrink-0">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold truncate text-sm md:text-base">
            {otherUserName?.trim() || channelName?.trim() || `Channel ${channelId.slice(-6)}`}
          </h1>
          {/* Always show the channel's Clancha number — a tester who never
              saved it couldn't message at all (Craig, M4 feedback §2.3). */}
          {clanchaNumber && (
            <p className="text-[11px] text-muted-foreground truncate">
              Unique Clancha number:{" "}
              <span className="font-mono">{formatPhoneForDisplay(clanchaNumber)}</span>
            </p>
          )}
        </div>
        {isMember && (
          <>
            <Button variant="ghost" size="icon" asChild title="Search this channel">
              <Link href={`/channel/${channelId}/qa`}>
                <Search className="w-5 h-5" />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" asChild title="Channel settings">
              <Link href={`/channel/${channelId}/settings`}>
                <Settings className="w-5 h-5" />
              </Link>
            </Button>
          </>
        )}
        {isViewer && !isMember && (
          <Button
            variant="ghost"
            size="icon"
            title="Leave channel"
            onClick={handleLeaveChannel}
            disabled={leaving}
          >
            <LogOut className="w-5 h-5" />
          </Button>
        )}
      </header>

      {/* View-only / closed banner */}
      {(channelState === "view_only" || channelState === "closed") && isMember && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200 text-amber-900 text-sm shrink-0">
          <div>
            <p className="font-semibold">
              {channelState === "closed"
                ? "This channel is closed."
                : "This channel is view-only."}
            </p>
            <p className="text-xs">
              {channelState === "closed"
                ? "Restart it by reactivating your subscription."
                : "Reactivate your subscription to resume messaging."}
            </p>
          </div>
          <Button size="sm" asChild className="shrink-0">
            <Link href="/subscription">Restart channel</Link>
          </Button>
        </div>
      )}

      {/* Tabs — only show Pictures tab when picture sharing is enabled */}
      {pictureShareEnabled && (
        <div className="flex border-b border-primary/10 bg-background shrink-0">
          <button
            onClick={() => setActiveTab("messages")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "messages"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-primary"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Messages
          </button>
          <button
            onClick={() => setActiveTab("pictures")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "pictures"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-primary"
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            Pictures
            {pictureMessages.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 min-w-[18px]">
                {pictureMessages.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Content area */}
      {activeTab === "messages" ? (
        <>
          <MessageTimeline
            messages={messages}
            currentUserId={userId}
            viewerSenderId={isViewer ? viewerSenderId : undefined}
            loading={loading}
          />
          <footer className="flex flex-col bg-[#f2e8d9] border-t border-[#4f7a61]/10 shrink-0">
            <UnifiedChatFooter
              channelId={channelId}
              disabled={!canSend}
              pictureShareEnabled={pictureShareEnabled}
              onMessageSent={fetchNewMessages}
            />
          </footer>
        </>
      ) : (
        <PicturesTab messages={pictureMessages} />
      )}
    </div>
  );
}

function PicturesTab({ messages }: { messages: MessageItem[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-8">
        <ImageIcon className="w-12 h-12 opacity-20" />
        <p className="text-sm font-medium">No approved pictures yet.</p>
        <p className="text-xs opacity-70 text-center max-w-xs">
          Pictures appear here once they have been approved by a moderator.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {messages.map((m) => (
          <a
            key={m.id}
            href={m.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative aspect-square rounded-xl overflow-hidden bg-muted border border-primary/10 hover:border-primary/40 transition-all shadow-sm hover:shadow-md"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.imageUrl}
              alt="Shared picture"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
              <span className="text-white text-[10px] font-medium">
                {new Date(m.createdAt).toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
