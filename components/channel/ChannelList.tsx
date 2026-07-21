"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Settings, LogOut, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppSelector } from "@/hooks/redux";
import { toast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";

export interface ChannelItem {
  id: string;
  clanchaNumber: string;
  name?: string | null;
  /**
   * For a member: the OTHER party's display name (#84). For a viewer (not a
   * channel member): both parents' names composed as "A ↔ B", same format as
   * the admin channel list (#41).
   */
  otherPartyName?: string | null;
  state: string;
  pictureShareEnabled: boolean;
  emergencyBypassEnabled: boolean;
  createdAt: string;
}

interface ChannelListProps {
  channels: ChannelItem[];
  onCreateClick?: () => void;
  onChannelLeft?: (channelId: string) => void;
}

const stateLabel: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  view_only: "View-only",
  closed: "Closed",
};

export function ChannelList({ channels, onCreateClick, onChannelLeft }: ChannelListProps) {
  const router = useRouter();
  const currentUser = useAppSelector((state) => state.user.currentUser);
  const isViewer = currentUser?.role === "viewer";
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  const handleLeave = async (channelId: string) => {
    setLeavingId(channelId);
    try {
      await confirm({
        title: "Leave this channel?",
        description:
          "Both parents will be notified and you'll lose access immediately.",
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
            toast({
              title: "You've left the channel",
              description: "Both parents have been notified.",
            });
            onChannelLeft?.(channelId);
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
      setLeavingId(null);
    }
  };

  if (channels.length === 0) {
    return (
      <>
        {dialog}
        <Card className="rounded-[2rem] border-white/70 bg-white/85 shadow-[0_18px_50px_rgba(47,74,68,0.10)]">
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <MessageSquare className="w-7 h-7 text-primary" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mb-5">
            {isViewer
              ? "You don't have access to any channels yet. The inviting parent will share a link when they want you to view a channel."
              : "No channels yet. Create a channel to start messaging."}
          </p>
          {onCreateClick && !isViewer && (
            <Button onClick={onCreateClick} className="h-12 w-full rounded-2xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
              Create channel
            </Button>
          )}
        </CardContent>
        </Card>
      </>
    );
  }

  return (
    <div className="space-y-3">
      {dialog}
      {channels.map((ch) => (
        <Card 
          key={ch.id} 
          onClick={() => router.push(`/channel/${ch.id}`)}
          className="rounded-[1.75rem] border-white/70 bg-white/85 shadow-sm transition-all cursor-pointer active:scale-[0.99] hover:border-primary/30 hover:shadow-md lg:border-primary/10"
        >
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex shrink-0 items-center justify-center">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-[#2f4a44]">
                  {ch.otherPartyName?.trim() || ch.name?.trim() || `Channel ${ch.clanchaNumber.slice(-4)}`}
                </p>
                {/* Labelled so users can always find the number they text
                    (Craig, M4 feedback 05/07/26 §2.3). */}
                <p className="truncate text-xs text-muted-foreground">
                  Unique Clancha number:{" "}
                  <span className="font-mono">{formatPhoneForDisplay(ch.clanchaNumber)}</span>
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge
                variant={ch.state === "active" ? "default" : "secondary"}
                className="rounded-full px-2 py-1 text-[11px] whitespace-nowrap"
              >
                <span>{stateLabel[ch.state] ?? ch.state}</span>
                {ch.pictureShareEnabled && (
                  <>
                    <span aria-hidden className="mx-1 opacity-50">·</span>
                    <span className="font-bold">Pics</span>
                  </>
                )}
              </Badge>
              {isViewer ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-2xl"
                  title="Leave channel"
                  disabled={leavingId === ch.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLeave(ch.id);
                  }}
                >
                  {leavingId === ch.id ? (
                    <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4 text-muted-foreground" />
                  )}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-2xl"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/channel/${ch.id}/settings`);
                  }}
                >
                  <Settings className="w-4 h-4 text-muted-foreground" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
