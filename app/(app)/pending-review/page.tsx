"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Image as ImageIcon,
  Inbox,
  Loader2,
  MessageSquare,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAppSelector } from "@/hooks/redux";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

interface QueueItem {
  type: "message" | "image";
  id: string;
  senderPhone: string;
  senderName: string;
  channelName?: string;
  channelId?: string;
  originalText?: string;
  rewrittenText?: string;
  storageUrl?: string;
  classification?: string | null;
  aiReason?: string | null;
  violationTags?: string[];
  createdAt: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
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
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Returns true when the classifier ran and confirmed no safe rewrite exists.
// Only disables Approve when we have definitive evidence — null classification
// (OpenAI error / unknown) keeps Approve enabled so the moderator can decide.
function isNoSafeRewrite(item: QueueItem): boolean {
  if (item.type !== "message") return false;
  if (!item.classification) return false;
  if (item.classification === "safe") return false;
  return !item.rewrittenText || item.rewrittenText === item.originalText;
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
  return CF ? `https://${CF}/${path}` : storageUrl;
}

export default function PendingReviewPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { currentUser } = useAppSelector((state) => state.user);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const canModerate =
    currentUser?.role === "moderator" ||
    currentUser?.role === "admin" ||
    currentUser?.role === "super_admin";

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/moderator/queue", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch queue");
      const data = await res.json();
      const combined: QueueItem[] = [
        ...(data.messages || []).map((m: Record<string, unknown>) => ({
          type: "message" as const,
          id: m.id as string,
          channelId: m.channelId as string | undefined,
          senderPhone: (m.senderPhone as string) || "",
          senderName: (m.senderName as string) || "Unknown sender",
          channelName: m.channelNumber as string | undefined,
          originalText: m.originalText as string | undefined,
          rewrittenText: m.rewrittenText as string | undefined,
          classification: (m.classification as string) ?? null,
          violationTags: (m.violationTags as string[]) ?? [],
          createdAt: m.createdAt as string,
        })),
        ...(data.images || []).map((i: Record<string, unknown>) => ({
          type: "image" as const,
          id: i.id as string,
          channelId: i.channelId as string | undefined,
          senderPhone: (i.senderPhone as string) || "",
          senderName: (i.senderName as string) || "Unknown sender",
          channelName: i.channelNumber as string | undefined,
          storageUrl: toCloudFrontUrl(i.storageUrl as string | undefined),
          classification: (i.classification as string) ?? null,
          aiReason: (i.aiReason as string) ?? null,
          violationTags: (i.violationTags as string[]) ?? [],
          createdAt: i.createdAt as string,
        })),
      ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setItems(combined);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!currentUser) return;
    if (!canModerate) {
      router.replace("/dashboard");
      return;
    }
    fetchQueue();
  }, [currentUser, canModerate, router, fetchQueue]);

  const handleAction = async (
    item: QueueItem,
    action: "approve" | "deny" | "retry_rewrite"
  ) => {
    setProcessingId(item.id);
    try {
      const res = await fetch("/api/moderator/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: item.type, id: item.id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Action failed");
      }
      if (action === "retry_rewrite") {
        const newRewrite = typeof data.rewrittenText === "string" ? data.rewrittenText : item.rewrittenText;
        const noSafeRewrite = data.noSafeRewrite === true;
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id && i.type === item.type
              ? {
                  ...i,
                  rewrittenText: newRewrite,
                  classification: data.classification ?? i.classification,
                  violationTags: data.violationTags ?? i.violationTags,
                }
              : i
          )
        );
        toast(
          noSafeRewrite
            ? {
                title: "No acceptable rewrite",
                description: "The AI could not produce a safe rewrite. Deny or try again later.",
                variant: "destructive",
              }
            : {
                title: "Rewrite regenerated",
                description: "A fresh rewrite was produced. Review it before approving.",
              }
        );
        return;
      }
      toast({
        title: action === "approve" ? "Approved" : "Denied",
        description:
          action === "approve"
            ? item.type === "image"
              ? "Image approved; recipient notified."
              : "Message approved and sent to recipient."
            : "Item denied; sender notified where applicable.",
      });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  if (!currentUser || !canModerate) {
    return null;
  }

  return (
    <>
    {confirmDialog}
    <ScrollArea className="h-full">
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
        <div>
          <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-secondary">
                  <ShieldAlert className="w-5 h-5 text-secondary-foreground" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#2F4A44" }}>
                  Pending Review
                </h1>
              </div>
              <p className="text-sm ml-[56px] text-muted-foreground max-[420px]:ml-0 max-[420px]:mt-2">
                Longest-waiting items first. Messages and images that need moderator action.
              </p>
            </div>
            {!loading && items.length > 0 && (
              <div className="flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 bg-secondary/10 border border-secondary/30">
                <AlertTriangle className="w-4 h-4 text-secondary" />
                <span className="text-sm font-bold" style={{ color: "#2F4A44" }}>
                  {items.length} pending
                </span>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading queue…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center bg-primary/10">
              <Inbox className="w-10 h-10 text-primary/40" />
            </div>
            <div>
              <p className="text-base font-semibold" style={{ color: "#2F4A44" }}>
                Nothing pending
              </p>
              <p className="text-sm mt-1 text-muted-foreground">No messages or images need review right now.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {items.map((item) => {
              const isProcessing = processingId === item.id;
              const initials = getInitials(item.senderName);
              const noSafeRewrite = isNoSafeRewrite(item);
              const hasRewrite =
                item.type === "message" &&
                !!item.rewrittenText &&
                item.rewrittenText !== item.originalText;
              const noRewrite =
                item.type === "message" &&
                (!item.rewrittenText || item.rewrittenText === item.originalText);
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  className="rounded-2xl overflow-hidden bg-card border border-border shadow-sm"
                >
                  <div className="h-[3px] bg-gradient-to-r from-secondary via-primary to-primary" />
                  <div className="p-5 space-y-4">
                    <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold bg-primary">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold" style={{ color: "#2F4A44" }}>
                            {item.senderName}
                          </p>
                          {item.senderPhone &&
                            item.senderName !== formatPhoneForDisplay(item.senderPhone) && (
                            <p className="truncate text-xs text-muted-foreground">
                              {formatPhoneForDisplay(item.senderPhone)}
                            </p>
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
                          {item.type === "image" ? (
                            <ImageIcon className="w-3 h-3" />
                          ) : (
                            <MessageSquare className="w-3 h-3" />
                          )}
                          {item.type === "image" ? "Image" : "Message"}
                        </span>
                        {noSafeRewrite && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-destructive/10 text-destructive border-destructive/30">
                            <Ban className="w-3 h-3" />
                            Rewrite unavailable
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
                        {item.channelName && (
                          <span className="text-xs rounded-md px-2 py-0.5 bg-muted text-muted-foreground border border-border">
                            {item.channelName}
                          </span>
                        )}
                      </div>
                    </div>

                    {item.type === "message" ? (
                      <div className="space-y-3">
                        <div className="rounded-xl p-4 bg-secondary/10 border border-secondary/25">
                          <div className="flex items-center gap-1.5 mb-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-secondary" />
                            <span className="text-xs font-bold uppercase tracking-widest text-secondary">
                              Original
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed font-medium" style={{ color: "#2F4A44" }}>
                            &ldquo;{item.originalText ?? "Message text unavailable"}&rdquo;
                          </p>
                        </div>

                        {hasRewrite && (
                          <div className="rounded-xl p-4 bg-primary/10 border border-primary/20">
                            <div className="flex items-center gap-1.5 mb-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                              <span className="text-xs font-bold uppercase tracking-widest text-primary">
                                AI rewrite
                              </span>
                            </div>
                            <p className="text-sm leading-relaxed" style={{ color: "#2F4A44" }}>
                              {item.rewrittenText}
                            </p>
                          </div>
                        )}

                        {noRewrite && (
                          <div className="rounded-xl p-3 bg-muted/40 border border-border">
                            <p className="text-xs text-muted-foreground">
                              This message may contain unsafe content and no safe rewrite could be
                              produced. Use{" "}
                              <span className="font-semibold text-foreground">Retry rewrite</span> to
                              try again, or <span className="font-semibold text-foreground">Deny</span>{" "}
                              if the content is unsafe.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl p-4 bg-secondary/10 border border-secondary/30 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-secondary" />
                          <span className="text-xs font-bold uppercase tracking-widest text-secondary">
                            Image preview
                          </span>
                        </div>
                        {item.classification && (
                          <p className="text-xs text-muted-foreground">Classification: {item.classification}</p>
                        )}
                        {item.aiReason && (
                          <p className="text-xs text-muted-foreground italic">AI: {item.aiReason}</p>
                        )}
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
                        ) : null}
                      </div>
                    )}

                    <div className="pt-4 flex flex-col border-t border-border gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                      {isProcessing ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          {item.type === "message" && (
                            <button
                              type="button"
                              onClick={() => handleAction(item, "retry_rewrite")}
                              disabled={!!processingId}
                              className="flex w-full items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-muted-foreground border border-border hover:bg-muted sm:w-auto"
                              title="Generate a new rewrite for this message"
                            >
                              <RotateCcw className="w-4 h-4" /> Retry rewrite
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await confirm({
                                title: "Deny this message?",
                                description:
                                  "The message will be blocked and the sender will be notified it could not be delivered.",
                                confirmLabel: "Deny",
                                cancelLabel: "Cancel",
                                variant: "destructive",
                              });
                              if (ok) handleAction(item, "deny");
                            }}
                            disabled={!!processingId}
                            className="flex w-full items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-secondary/10 text-secondary border border-secondary/30 sm:w-auto"
                          >
                            <XCircle className="w-4 h-4" /> Deny
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await confirm({
                                title: "Approve this message?",
                                description: hasRewrite
                                  ? "The AI rewrite will be sent to the recipient."
                                  : "The original message will be sent to the recipient.",
                                confirmLabel: "Approve",
                                cancelLabel: "Cancel",
                                variant: "default",
                              });
                              if (ok) handleAction(item, "approve");
                            }}
                            disabled={!!processingId || noSafeRewrite}
                            title={
                              noSafeRewrite
                                ? "Approve is disabled — no safe rewrite was produced. Retry rewrite or Deny instead."
                                : undefined
                            }
                            className="flex w-full items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary/90 sm:w-auto disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                          >
                            <CheckCircle2 className="w-4 h-4" /> Approve
                          </button>
                        </>
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
    </>
  );
}
