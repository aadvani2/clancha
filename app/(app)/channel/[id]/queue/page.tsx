"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Image as ImageIcon,
  Inbox,
  Loader2,
  MessageSquare,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface QueueItem {
  type: "message" | "image";
  id: string;
  senderPhone: string;
  senderName: string;
  channelName?: string;
  originalText?: string;
  rewrittenText?: string;
  storageUrl?: string;
  createdAt: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay)
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getInitials(name: string) {
  if (!name || name === "Unknown sender") return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function toCloudFrontUrl(storageUrl?: string): string {
  if (!storageUrl) return "";
  const CF = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN || "";
  let path = storageUrl;
  try {
    const parsed = new URL(storageUrl);
    path = parsed.pathname.replace(/^\//, "");
  } catch {
    path = storageUrl.replace(/^https?:\/\/[^/]+\//, "");
  }
  return `https://${CF}/${path}`;
}

export default function ModeratorQueuePage() {
  const params = useParams();
  const channelId = params.id as string;
  const { toast } = useToast();
  const router = useRouter();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/moderator/queue?channelId=${channelId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch queue");
      const data = await res.json();
      const combined: QueueItem[] = [
        ...(Array.isArray(data.messages) ? data.messages : []).map((m: Record<string, unknown>) => ({
          type: "message" as const,
          id: m.id as string,
          senderPhone: (m.senderPhone as string) || "",
          senderName: (m.senderName as string) || (m.senderPhone as string) || "Unknown sender",
          channelName: m.channelNumber as string | undefined,
          originalText: m.originalText as string | undefined,
          rewrittenText: m.rewrittenText as string | undefined,
          createdAt: m.createdAt as string,
        })),
        ...(Array.isArray(data.images) ? data.images : []).map((i: Record<string, unknown>) => ({
          type: "image" as const,
          id: i.id as string,
          senderPhone: (i.senderPhone as string) || "",
          senderName: (i.senderName as string) || (i.senderPhone as string) || "Unknown sender",
          channelName: i.channelNumber as string | undefined,
          storageUrl: toCloudFrontUrl(i.storageUrl as string | undefined),
          createdAt: i.createdAt as string,
        })),
      ].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setItems(combined);
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to fetch queue",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [channelId, toast]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const handleAction = async (item: QueueItem, action: "approve" | "deny") => {
    setProcessingId(item.id);
    try {
      const res = await fetch("/api/moderator/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: item.type, id: item.id, action }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Action failed");
      }
      toast({
        title: action === "approve" ? "✓ Approved" : "✗ Denied",
        description:
          action === "approve"
            ? "Message approved and delivered to recipient."
            : "Message denied. Sender has been notified.",
      });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Action failed",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <ScrollArea className="h-full">
      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2F4A44]/90 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-primary shadow-lg ring-1 ring-primary/10 transition-opacity hover:opacity-90"
              aria-label="Close preview"
            >
              <XCircle className="w-5 h-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="Flagged content"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl border border-border"
            />
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Header */}
        <div>
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-sm font-medium mb-6 text-primary hover:opacity-70 transition-opacity"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to channels
          </button>

          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-secondary shrink-0">
                <ShieldAlert className="w-5 h-5 text-secondary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: "#2F4A44" }}>
                  Review Queue
                </h1>
                <p className="text-sm text-muted-foreground">
                  Approve or deny unsafe content flagged by AI moderation.
                </p>
              </div>
            </div>

            {!loading && items.length > 0 && (
              <div className="flex items-center gap-2 rounded-2xl px-4 py-2.5 bg-secondary/10 border border-secondary/30">
                <AlertTriangle className="w-4 h-4 text-secondary" />
                <span className="text-sm font-bold" style={{ color: "#2F4A44" }}>
                  {items.length} pending
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading flagged content…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center bg-primary/10">
              <Inbox className="w-10 h-10 text-primary/40" />
            </div>
            <div>
              <p className="text-base font-semibold" style={{ color: "#2F4A44" }}>Queue is clear</p>
              <p className="text-sm mt-1 text-muted-foreground">No flagged content awaiting review for this channel.</p>
            </div>
            <button onClick={() => router.back()} className="mt-2 text-sm font-semibold text-primary hover:underline">
              ← Go back
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {items.map((item) => {
              const isProcessing = processingId === item.id;
              const initials = getInitials(item.senderName);
              return (
                <div
                  key={item.id}
                  className="rounded-2xl overflow-hidden bg-card border border-border shadow-sm hover:shadow-md transition-shadow duration-200"
                >
                  {/* Accent stripe using brand gradient */}
                  <div className="h-[3px] bg-gradient-to-r from-secondary via-primary to-primary" />

                  <div className="p-5 space-y-4">
                    {/* Sender row */}
                    <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold bg-primary"
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold" style={{ color: "#2F4A44" }}>
                            {item.senderName}
                          </p>
                          {item.senderPhone && (
                            <p className="truncate text-xs text-muted-foreground">{item.senderPhone}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap min-[420px]:justify-end">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                            item.type === "image"
                              ? "bg-secondary/10 text-secondary border-secondary/25"
                              : "bg-primary/10 text-primary border-primary/20"
                          }`}
                        >
                          {item.type === "image" ? <ImageIcon className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                          {item.type === "image" ? "Image" : "Message"}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
                        {item.channelName && (
                          <span className="text-xs rounded-md px-2 py-0.5 bg-muted text-muted-foreground border border-border">
                            {item.channelName}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Content */}
                    {item.type === "message" ? (
                      <div className="space-y-3">
                        <div className="rounded-xl p-4 bg-secondary/10 border border-secondary/25">
                          <div className="flex items-center gap-1.5 mb-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-secondary" />
                            <span className="text-xs font-bold uppercase tracking-widest text-secondary">
                              Original (Flagged)
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed font-medium" style={{ color: "#2F4A44" }}>
                            &ldquo;{item.originalText}&rdquo;
                          </p>
                        </div>

                        {item.rewrittenText && item.rewrittenText !== item.originalText && (
                          <div className="rounded-xl p-4 bg-primary/10 border border-primary/20">
                            <div className="flex items-center gap-1.5 mb-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                              <span className="text-xs font-bold uppercase tracking-widest text-primary">
                                AI Rewrite (Delivery Version)
                              </span>
                            </div>
                            <p className="text-sm leading-relaxed" style={{ color: "#2F4A44" }}>
                              {item.rewrittenText}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl p-4 bg-secondary/10 border border-secondary/30">
                        <div className="flex items-center gap-1.5 mb-3">
                          <AlertTriangle className="w-3.5 h-3.5 text-secondary" />
                          <span className="text-xs font-bold uppercase tracking-widest text-secondary">
                            Flagged image
                          </span>
                        </div>
                        {item.storageUrl ? (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(item.storageUrl!)}
                            className="group block w-full overflow-hidden rounded-xl border border-secondary/25 bg-white/70 text-left shadow-sm transition-all hover:border-secondary/50 hover:bg-white"
                            aria-label="Open image preview"
                          >
                            <div className="relative aspect-video bg-muted/40">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={item.storageUrl}
                                alt="Flagged image preview"
                                className="h-full w-full object-contain"
                                loading="lazy"
                              />
                              <span className="absolute bottom-2 right-2 rounded-full bg-[#2F4A44]/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                                Tap to preview
                              </span>
                            </div>
                          </button>
                        ) : (
                          <div className="h-24 rounded-lg flex items-center justify-center bg-primary/5">
                            <ImageIcon className="w-8 h-8 text-primary/25" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action bar */}
                    <div className="pt-4 flex flex-col gap-3 border-t border-border sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs italic text-muted-foreground">Sender will be notified if denied.</p>
                      {isProcessing ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" /> Processing…
                        </div>
                      ) : (
                        <div className="flex w-full flex-col items-stretch gap-2 min-[420px]:w-auto min-[420px]:flex-row min-[420px]:items-center">
                          <button
                            onClick={() => handleAction(item, "deny")}
                            disabled={!!processingId}
                            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-secondary/10 text-secondary border border-secondary/30 hover:bg-secondary/20"
                          >
                            <XCircle className="w-4 h-4" /> Deny
                          </button>
                          <button
                            onClick={() => handleAction(item, "approve")}
                            disabled={!!processingId}
                            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-primary hover:bg-primary/90"
                          >
                            <CheckCircle2 className="w-4 h-4" /> Approve
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
