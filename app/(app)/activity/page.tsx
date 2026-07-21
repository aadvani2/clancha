"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppSelector } from "@/hooks/redux";
import {
  MessageSquare,
  Sparkles,
  Inbox,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  User,
  UserPlus,
  UserMinus,
  UserCog,
  Image as ImageIcon,
  RotateCcw,
  Filter,
  KeyRound,
  LogIn,
  FileEdit,
  Undo2,
  X,
} from "lucide-react";

interface ActivityItem {
  id: string;
  type: "message" | "action";
  channelId: string;
  channelName?: string | null;
  clanchaNumber?: string | null;
  originalText?: string;
  rewrittenText?: string;
  state?: string;
  isEmergency?: boolean;
  deliveredAt?: string | null;
  moderatorNotes?: string | null;
  action?: string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  targetName?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

const stateSteps: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  received:  { label: "Received",    icon: <Inbox className="w-3.5 h-3.5" />,       color: "bg-slate-100 text-slate-700 border-slate-200" },
  queued:    { label: "Queued",      icon: <Clock className="w-3.5 h-3.5" />,        color: "bg-amber-50 text-amber-700 border-amber-200" },
  rewriting: { label: "Message rewriting",icon: <Sparkles className="w-3.5 h-3.5" />,    color: "bg-blue-50 text-blue-700 border-blue-200" },
  held:      { label: "In queue",    icon: <Inbox className="w-3.5 h-3.5" />,        color: "bg-amber-50 text-amber-700 border-amber-200" },
  blocked:   { label: "Blocked",     icon: <XCircle className="w-3.5 h-3.5" />,      color: "bg-red-50 text-red-700 border-red-200" },
  delivered: { label: "Delivered",   icon: <CheckCircle className="w-3.5 h-3.5" />,  color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

const actionLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  message_moderator_approved:    { label: "Approved",          icon: <ShieldCheck className="w-3.5 h-3.5" />,  color: "text-green-700 bg-green-50 border-green-200" },
  message_moderator_denied:      { label: "Denied",            icon: <ShieldAlert className="w-3.5 h-3.5" />,  color: "text-red-700 bg-red-50 border-red-200" },
  message_moderator_retry_rewrite:{ label: "Rewrite retry",   icon: <RotateCcw className="w-3.5 h-3.5" />,    color: "text-slate-600 bg-slate-50 border-slate-200" },
  image_moderator_approved:      { label: "Image approved",    icon: <ShieldCheck className="w-3.5 h-3.5" />,  color: "text-green-700 bg-green-50 border-green-200" },
  image_moderator_denied:        { label: "Image denied",      icon: <ShieldAlert className="w-3.5 h-3.5" />,  color: "text-red-700 bg-red-50 border-red-200" },
  message_blocked:               { label: "Auto-blocked",      icon: <XCircle className="w-3.5 h-3.5" />,      color: "text-red-700 bg-red-50 border-red-200" },
  message_delivered:             { label: "Delivered",         icon: <CheckCircle className="w-3.5 h-3.5" />,  color: "text-green-700 bg-green-50 border-green-200" },
  message_held:                  { label: "Held (error)",      icon: <Inbox className="w-3.5 h-3.5" />,        color: "text-amber-700 bg-amber-50 border-amber-200" },
  message_emergency_approved:    { label: "Emergency sent",    icon: <CheckCircle className="w-3.5 h-3.5" />,  color: "text-green-700 bg-green-50 border-green-200" },
  message_emergency_denied:      { label: "Emergency denied",  icon: <XCircle className="w-3.5 h-3.5" />,      color: "text-amber-700 bg-amber-50 border-amber-200" },
  channel_admin_suspend:         { label: "Suspended",         icon: <ShieldAlert className="w-3.5 h-3.5" />,  color: "text-orange-700 bg-orange-50 border-orange-200" },
  channel_admin_cancel:          { label: "Cancelled",         icon: <XCircle className="w-3.5 h-3.5" />,      color: "text-orange-700 bg-orange-50 border-orange-200" },
  channel_admin_reactivate:      { label: "Reactivated",       icon: <CheckCircle className="w-3.5 h-3.5" />,  color: "text-green-700 bg-green-50 border-green-200" },
  channel_admin_close:           { label: "Closed",            icon: <XCircle className="w-3.5 h-3.5" />,      color: "text-slate-600 bg-slate-50 border-slate-200" },
  channel_state_change:          { label: "State changed",     icon: <ArrowRight className="w-3.5 h-3.5" />,   color: "text-slate-600 bg-slate-50 border-slate-200" },
  admin_password_login:          { label: "Admin sign-in",     icon: <LogIn className="w-3.5 h-3.5" />,        color: "text-slate-600 bg-slate-50 border-slate-200" },
  admin_password_login_failed:   { label: "Sign-in failed",    icon: <ShieldAlert className="w-3.5 h-3.5" />,  color: "text-amber-700 bg-amber-50 border-amber-200" },
  prompt_edited:                 { label: "AI prompt edited",  icon: <FileEdit className="w-3.5 h-3.5" />,     color: "text-indigo-700 bg-indigo-50 border-indigo-200" },
  prompt_rolled_back:            { label: "AI prompt rolled back", icon: <Undo2 className="w-3.5 h-3.5" />,    color: "text-indigo-700 bg-indigo-50 border-indigo-200" },
  moderator_created:             { label: "Moderator added",   icon: <UserPlus className="w-3.5 h-3.5" />,     color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  moderator_removed:             { label: "Moderator removed", icon: <UserMinus className="w-3.5 h-3.5" />,    color: "text-red-700 bg-red-50 border-red-200" },
  moderator_updated:             { label: "Moderator updated", icon: <UserCog className="w-3.5 h-3.5" />,      color: "text-slate-600 bg-slate-50 border-slate-200" },
  viewer_access_granted:         { label: "Viewer added",      icon: <KeyRound className="w-3.5 h-3.5" />,     color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  viewer_access_revoked:         { label: "Viewer revoked",    icon: <KeyRound className="w-3.5 h-3.5" />,     color: "text-red-700 bg-red-50 border-red-200" },
  service_failure_twilio:        { label: "Twilio failure",    icon: <ShieldAlert className="w-3.5 h-3.5" />,  color: "text-red-700 bg-red-50 border-red-200" },
  service_failure_openai:        { label: "OpenAI failure",    icon: <ShieldAlert className="w-3.5 h-3.5" />,  color: "text-red-700 bg-red-50 border-red-200" },
};

const ACTION_FILTER_VALUES = [
  { value: "any", label: "Any action" },
  { value: "message_moderator_approved", label: "Message approved" },
  { value: "message_moderator_denied", label: "Message denied" },
  { value: "message_moderator_retry_rewrite", label: "Rewrite retried" },
  { value: "image_moderator_approved", label: "Image approved" },
  { value: "image_moderator_denied", label: "Image denied" },
  { value: "message_blocked", label: "Auto-blocked (unsafe)" },
  { value: "message_held", label: "Held (error)" },
  { value: "message_delivered", label: "Delivered" },
  { value: "channel_admin_suspend", label: "Channel suspended" },
  { value: "channel_admin_cancel", label: "Channel cancelled" },
  { value: "channel_admin_reactivate", label: "Channel reactivated" },
  { value: "channel_admin_close", label: "Channel closed" },
  { value: "admin_password_login", label: "Admin sign-in" },
  { value: "admin_password_login_failed", label: "Sign-in failed" },
  { value: "prompt_edited", label: "AI prompt edited" },
  { value: "prompt_rolled_back", label: "AI prompt rolled back" },
  { value: "moderator_created", label: "Moderator added" },
  { value: "moderator_removed", label: "Moderator removed" },
  { value: "moderator_updated", label: "Moderator updated" },
  { value: "viewer_access_granted", label: "Viewer added" },
  { value: "viewer_access_revoked", label: "Viewer revoked" },
  { value: "service_failure_twilio", label: "Twilio failure" },
  { value: "service_failure_openai", label: "OpenAI failure" },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  // UK numeric date format per Craig: DD/MM/YYYY (e.g. 17/05/2026, not "17 May 2026").
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ActivityPage() {
  const router = useRouter();
  const { currentUser } = useAppSelector((state) => state.user);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [channelId, setChannelId] = useState("");
  const [actorId, setActorId] = useState("");
  // Name (or partial name / email / phone) of the actor. Resolved server-side
  // so admins no longer need a raw user ID to filter (M4 tracker #90).
  const [actorName, setActorName] = useState("");
  const [action, setAction] = useState("any");

  const isModerator = currentUser?.role === "moderator";
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";
  const showAdminFilters = isAdmin || isModerator;

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set("from", new Date(from).toISOString());
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      params.set("to", toDate.toISOString());
    }
    if (channelId.trim()) params.set("channelId", channelId.trim());
    if (actorId.trim() && isAdmin) params.set("actorId", actorId.trim());
    if (actorName.trim() && isAdmin) params.set("actorName", actorName.trim());
    if (action && action !== "any") params.set("action", action);
    try {
      const url = "/api/activity" + (params.toString() ? `?${params.toString()}` : "");
      const res = await fetch(url, { credentials: "include" });
      const data = await res.json();
      if (data.activity) setActivity(data.activity);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [from, to, channelId, actorId, actorName, action, isAdmin]);

  useEffect(() => {
    if (!currentUser) return;
    fetchActivity();
  }, [currentUser, fetchActivity]);

  const clearFilters = () => { setFrom(""); setTo(""); setChannelId(""); setActorId(""); setActorName(""); setAction("any"); };
  const hasActiveFilters = from || to || channelId.trim() || (isAdmin && (actorId.trim() || actorName.trim())) || action !== "any";

  if (!currentUser) {
    return (
      <ScrollArea className="h-full px-4 sm:px-8 py-6 sm:py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-2xl font-bold text-primary tracking-tight">Activity</h2>
            <p className="text-sm text-muted-foreground">
              {showAdminFilters
                ? "Audit log of moderator and admin actions across the platform."
                : "Timeline of your messages — rewrites, queue status, and delivery."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen((v) => !v)}
            className="h-10 shrink-0 sm:h-9"
          >
            <Filter className="w-4 h-4 mr-1.5" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold">
                !
              </span>
            )}
          </Button>
        </div>

        {/* Filters panel */}
        {filtersOpen && (
          <div className="rounded-2xl border border-primary/10 bg-card p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="from" className="text-xs font-medium">From</Label>
                <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 sm:h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to" className="text-xs font-medium">To</Label>
                <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 sm:h-9" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="channelId" className="text-xs font-medium">Channel ID</Label>
              <Input
                id="channelId"
                placeholder="Paste channel ID…"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="h-11 font-mono text-base sm:h-9 md:text-xs"
              />
            </div>
            {isAdmin && (
              <div className="space-y-1">
                <Label htmlFor="actorName" className="text-xs font-medium">Actor name</Label>
                <Input
                  id="actorName"
                  placeholder="Search by name, email or phone…"
                  value={actorName}
                  onChange={(e) => setActorName(e.target.value)}
                  className="h-11 text-base sm:h-9 md:text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Matches the actor&apos;s name, email or phone. Leave the ID field blank to use this.
                </p>
              </div>
            )}
            {isAdmin && (
              <div className="space-y-1">
                <Label htmlFor="actorId" className="text-xs font-medium">Actor ID (optional)</Label>
                <Input
                  id="actorId"
                  placeholder="Exact user ID — overrides the name search"
                  value={actorId}
                  onChange={(e) => setActorId(e.target.value)}
                  className="h-11 font-mono text-base sm:h-9 md:text-xs"
                />
              </div>
            )}
            {showAdminFilters && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Action type</Label>
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger className="h-11 sm:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_FILTER_VALUES.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex h-10 items-center gap-1 text-xs font-medium text-destructive"
              >
                <X className="w-3.5 h-3.5" /> Clear filters
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading activity…</p>
          </div>
        ) : activity.length === 0 ? (
          <div className="rounded-2xl border border-primary/10 bg-card p-8 text-center space-y-3">
            <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {hasActiveFilters ? "No activity matching these filters." : "No activity yet."}
            </p>
            {!showAdminFilters && !hasActiveFilters && (
              <button
                type="button"
                className="text-sm font-semibold text-primary hover:underline"
                onClick={() => router.push("/dashboard")}
              >
                Go to channels →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {activity.map((item) => {
              if (item.type === "action") {
                const ad = actionLabels[item.action!] ?? {
                  label: item.action || "Admin action",
                  icon: <ShieldCheck className="w-3.5 h-3.5" />,
                  color: "text-primary bg-primary/5 border-primary/20",
                };
                const isImage = item.action?.includes("image");
                const [, bgColor] = ad.color.split(" ");

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-primary/10 bg-card shadow-sm overflow-hidden"
                  >
                    <div className="flex items-stretch">
                      {/* Left accent strip */}
                      <div className={`w-1 shrink-0 ${bgColor} opacity-80`} />
                      <div className="flex-1 min-w-0 overflow-hidden p-4 space-y-2">
                        {/* Top row: badge + timestamp */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg border ${ad.color}`}>
                            {isImage ? <ImageIcon className="w-3.5 h-3.5" /> : ad.icon}
                            {ad.label}
                          </span>
                          <span className="text-[11px] text-muted-foreground font-medium shrink-0">
                            {formatDate(item.createdAt)}
                          </span>
                        </div>

                        {/* Actor → target */}
                        <div className="flex items-center gap-1.5 flex-wrap text-sm">
                          <User className="w-3.5 h-3.5 text-primary/60 shrink-0" />
                          <span className="font-semibold text-foreground">{item.actorName || "—"}</span>
                          {item.actorRole && (
                            <span className="text-[10px] uppercase text-muted-foreground font-bold bg-muted px-1.5 py-0.5 rounded">
                              {item.actorRole}
                            </span>
                          )}
                          {item.targetName && (
                            <>
                              <ArrowRight className="w-3 h-3 text-muted-foreground" />
                              <span className="font-medium text-foreground">{item.targetName}</span>
                            </>
                          )}
                        </div>

                        {/* Channel + meta */}
                        {(item.clanchaNumber || item.channelName) && (
                          <p className="text-xs text-muted-foreground truncate">
                            Channel: {item.channelName || item.clanchaNumber}
                          </p>
                        )}
                        {/* Auto-blocked context: show the blocked message
                           preview so the row isn't just "Auto-blocked · System"
                           with no detail (Craig M4 tracker #89). */}
                        {item.action === "message_blocked" && typeof item.metadata?.preview === "string" && item.metadata.preview.trim() !== "" && (
                          <p className="text-xs text-muted-foreground italic line-clamp-2 break-words">
                            &ldquo;{String(item.metadata.preview)}&rdquo;
                          </p>
                        )}
                        {item.metadata?.fromState !== undefined && item.metadata?.toState !== undefined && (
                          <p className="text-xs text-muted-foreground truncate">
                            {String(item.metadata.fromState)} → {String(item.metadata.toState)}
                          </p>
                        )}
                        {/* Moderator-update detail: distinguish password resets
                           from detail edits so "MODERATOR UPDATED" rows aren't
                           ambiguous (Craig M4 tracker #52). */}
                        {item.action === "moderator_updated" && (
                          <p className="text-xs text-muted-foreground truncate">
                            {item.metadata?.passwordReset
                              ? "Password reset"
                              : Array.isArray(item.metadata?.fieldsChanged) && item.metadata.fieldsChanged.length > 0
                                ? `Changed: ${(item.metadata.fieldsChanged as string[]).join(", ")}`
                                : "Details updated"}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              // ── Message item (user view) ──
              const step = stateSteps[item.state!] ?? {
                label: item.state,
                icon: <MessageSquare className="w-3.5 h-3.5" />,
                color: "bg-slate-100 text-slate-700 border-slate-200",
              };
              const isDelivered = item.state === "delivered";
              const isBlocked = item.state === "blocked";

              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border bg-card shadow-sm overflow-hidden cursor-pointer transition-all active:scale-[0.99] ${
                    isBlocked
                      ? "border-red-200"
                      : isDelivered
                        ? "border-emerald-200"
                        : "border-primary/10 hover:border-primary/25"
                  }`}
                  onClick={() => router.push(`/channel/${item.channelId}`)}
                >
                  <div className="flex items-stretch">
                    {/* Left state indicator */}
                    <div className={`w-1 shrink-0 ${
                      isBlocked ? "bg-red-400" : isDelivered ? "bg-emerald-400" : "bg-primary/30"
                    }`} />
                    <div className="flex-1 min-w-0 overflow-hidden p-4 space-y-2">
                      {/* Top row: state badge + time */}
                      <div className="flex items-center justify-between gap-2">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-lg border ${step.color}`}>
                          {step.icon} {step.label}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-medium shrink-0">
                          {formatDate(item.createdAt)}
                        </span>
                      </div>

                      {/* Message preview */}
                      {item.originalText && (
                        <p className="text-sm text-foreground font-medium leading-snug line-clamp-2 break-all">
                          &ldquo;{item.originalText}&rdquo;
                        </p>
                      )}

                      {/* Rewrite preview */}
                      {item.rewrittenText && item.rewrittenText !== item.originalText && (
                        <div className="rounded-lg bg-primary/5 border border-primary/10 px-2.5 py-1.5 min-w-0 overflow-hidden">
                          <p className="text-xs text-primary font-semibold uppercase tracking-wide mb-0.5">Rewritten</p>
                          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 break-all">
                            {item.rewrittenText}
                          </p>
                        </div>
                      )}

                      {/* Footer meta */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {item.channelName && <span>Channel: {item.channelName}</span>}
                        {item.deliveredAt && (
                          <span className="text-emerald-600 font-medium">
                            ✓ {formatDate(item.deliveredAt)}
                          </span>
                        )}
                        {item.moderatorNotes && (
                          <span className="italic">Moderator: {item.moderatorNotes}</span>
                        )}
                        {item.isEmergency && (
                          <span className="text-amber-600 font-semibold">⚡ Emergency</span>
                        )}
                      </div>
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
