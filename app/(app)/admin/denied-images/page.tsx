"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppSelector } from "@/hooks/redux";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  ShieldAlert,
  Loader2,
  ImageOff,
  Clock,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";
import { formatDate as formatShortDate, formatDateTime } from "@/lib/utils/formatDate";

interface DeniedImage {
  id: string;
  channelId: string;
  channelName: string | null;
  clanchaNumber: string | null;
  senderId: string;
  senderName: string | null;
  senderEmail: string | null;
  senderPhone: string | null;
  deniedAt: string;
  purgesAt: string;
  daysRemaining: number;
  aiReason: string | null;
  moderatorNotes: string | null;
  violationTags: string[];
  classification: string | null;
  viewUrl: string;
}

export default function AdminDeniedImagesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAppSelector((state) => state.user);
  const [items, setItems] = useState<DeniedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/denied-images", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load denied images");
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isPrivileged) {
      router.replace("/dashboard");
      return;
    }
    fetchItems();
  }, [currentUser, isPrivileged, router, fetchItems]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchItems();
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

  if (!isPrivileged) return null;

  return (
    <ScrollArea className="h-full">
      <div className="max-w-6xl mx-auto px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              <h2 className="text-2xl font-bold text-primary tracking-tight">Denied images</h2>
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Images denied by the moderator (or by the AI pre-check) are retained for 30 days from
              their denial date so an admin can audit the decision. After 30 days they&apos;re
              permanently removed by the retention cron — both the file in storage and the database
              row.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="h-10 rounded-2xl"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading denied images…</p>
          </div>
        ) : items.length === 0 ? (
          <Card className="border-primary/10">
            <CardContent className="py-16 flex flex-col items-center justify-center text-center gap-3">
              <ImageOff className="w-10 h-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No denied images currently retained.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Showing {items.length} retained image{items.length === 1 ? "" : "s"}.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((img) => {
                const expiringSoon = img.daysRemaining <= 3;
                return (
                  <Card key={img.id} className="border-primary/10 overflow-hidden">
                    {/* Image preview */}
                    <Link
                      href={img.viewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block relative aspect-video bg-muted/40 border-b border-primary/10 hover:bg-muted/60 transition-colors"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.viewUrl}
                        alt="Denied content"
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                      <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-destructive/90 text-white">
                        <Shield className="w-3 h-3" />
                        Denied
                      </div>
                      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/60 text-white inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />
                        Open
                      </div>
                    </Link>

                    <CardContent className="p-4 space-y-3">
                      {/* Retention countdown */}
                      <div
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                          expiringSoon
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-slate-50 text-slate-600 border-slate-200"
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        {img.daysRemaining === 0
                          ? "Purging soon"
                          : `${img.daysRemaining} day${img.daysRemaining === 1 ? "" : "s"} until purge`}
                      </div>

                      <div className="space-y-1 text-xs">
                        <p className="font-medium text-foreground">
                          {img.channelName ?? "Unnamed channel"}
                        </p>
                        <p className="text-muted-foreground font-mono">
                          {img.clanchaNumber ?? "—"}
                        </p>
                      </div>

                      <div className="border-t border-primary/10 pt-2 space-y-1 text-xs">
                        <p>
                          <span className="text-muted-foreground">Sender:</span>{" "}
                          <span className="font-medium">{img.senderName ?? "Unknown"}</span>
                        </p>
                        {img.senderEmail && (
                          <p className="text-muted-foreground break-all">{img.senderEmail}</p>
                        )}
                        <p className="text-muted-foreground font-mono">
                          {formatPhoneForDisplay(img.senderPhone)}
                        </p>
                      </div>

                      <div className="border-t border-primary/10 pt-2 space-y-1 text-xs">
                        <p>
                          <span className="text-muted-foreground">Denied:</span>{" "}
                          <span className="font-medium">{formatDateTime(img.deniedAt)}</span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">Auto-purges:</span>{" "}
                          <span className="font-medium">{formatShortDate(img.purgesAt)}</span>
                        </p>
                      </div>

                      {img.aiReason && (
                        <div className="border-t border-primary/10 pt-2 text-xs space-y-1">
                          <p className="text-muted-foreground flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            AI reason
                          </p>
                          <p className="text-foreground italic break-words">&ldquo;{img.aiReason}&rdquo;</p>
                        </div>
                      )}

                      {img.violationTags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {img.violationTags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {img.moderatorNotes && (
                        <div className="border-t border-primary/10 pt-2 text-xs">
                          <p className="text-muted-foreground mb-1">Moderator notes</p>
                          <p className="text-foreground break-words">{img.moderatorNotes}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
