"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  Eye,
  UserX,
  Clock,
  Loader2,
  UserPlus,
  Mail,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Link2,
} from "lucide-react";
import { InviteViewerModal } from "./InviteViewerModal";
import { useAppSelector } from "@/hooks/redux";
import { formatDate as sharedFormatDate, formatDateTime as sharedFormatDateTime } from "@/lib/utils/formatDate";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

interface Viewer {
  id: string;
  userId: string;
  email: string;
  name?: string | null;
  accessLevel: string;
  invitingParentUserId: string;
  otherParentApproved: boolean;
  grantedAt: string;
  lastAccessedAt: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  viewerName?: string | null;
  accessLevel: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface ViewerManagementProps {
  channelId: string;
}

export function ViewerManagement({ channelId }: ViewerManagementProps) {
  const { currentUser } = useAppSelector((s) => s.user);
  const myUserId = currentUser?.id ?? "";
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(true);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog();
  const [showInviteModal, setShowInviteModal] = useState(false);
  // When the inviting parent clicks the Show-link icon on a pending row, we
  // rotate the token server-side and reopen the InviteViewerModal preloaded
  // with the new link.
  const [reshareState, setReshareState] = useState<{ link: string; emailSentTo: string | null } | null>(null);

  const fetchViewers = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channelId}/viewers`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setViewers(data.viewers || []);
    } catch {
      toast({ title: "Error", description: "Failed to load viewers.", variant: "destructive" });
    } finally {
      setLoadingViewers(false);
    }
  }, [channelId]);

  const fetchInvites = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channelId}/invite`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        setPendingInvites((data.invites || []).filter((inv: PendingInvite) => inv.status === "pending"));
      }
    } catch {
      toast({ title: "Error", description: "Failed to load invitations.", variant: "destructive" });
    } finally {
      setLoadingInvites(false);
    }
  }, [channelId]);

  useEffect(() => {
    fetchViewers();
    fetchInvites();
  }, [fetchViewers, fetchInvites]);

  const handleRemoveViewer = async (viewer: Viewer) => {
    const label = viewer.name || viewer.email;
    const ok = await confirmDialog({
      title: `Remove ${label}?`,
      description:
        "They'll lose access immediately and the other parent will be notified.",
      confirmLabel: "Remove viewer",
      variant: "destructive",
    });
    if (!ok) return;
    setBusyId(viewer.id);
    try {
      const res = await fetch(`/api/channels/${channelId}/viewers`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ viewerId: viewer.id }),
      });
      if (res.ok) {
        setViewers((prev) => prev.filter((v) => v.id !== viewer.id));
        toast({ title: "Viewer removed", description: "The other parent has been notified." });
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to remove viewer.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to remove viewer.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleConsent = async (viewer: Viewer, action: "approve" | "restrict") => {
    setBusyId(viewer.id);
    try {
      const res = await fetch(`/api/channels/${channelId}/viewers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ viewerId: viewer.id, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Failed to update consent.", variant: "destructive" });
        return;
      }
      setViewers((prev) =>
        prev.map((v) => (v.id === viewer.id ? { ...v, otherParentApproved: data.otherParentApproved } : v))
      );
      toast({
        title: action === "approve" ? "Viewer granted full history" : "Viewer restricted",
        description:
          action === "approve"
            ? "Your originals are now visible to this viewer."
            : "Your originals are no longer visible to this viewer.",
      });
    } catch {
      toast({ title: "Error", description: "Failed to update consent.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleShowLink = async (inviteId: string) => {
    setBusyId(inviteId);
    try {
      const res = await fetch(`/api/channels/${channelId}/invite`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ inviteId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Failed to refresh invitation.", variant: "destructive" });
        return;
      }
      setReshareState({ link: data.inviteLink, emailSentTo: data.emailSent ? data.email : null });
      setShowInviteModal(true);
      // Bump the expires-at on the visible row so the user sees it refreshed.
      setPendingInvites((prev) =>
        prev.map((i) => (i.id === inviteId ? { ...i, expiresAt: data.expiresAt } : i))
      );
    } catch {
      toast({ title: "Error", description: "Failed to refresh invitation.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    const invite = pendingInvites.find((i) => i.id === inviteId);
    const label = invite?.viewerName?.trim() || invite?.email || "this invitation";
    const ok = await confirmDialog({
      title: "Revoke this invitation?",
      description: `${label} won't be able to use the link any more. You can create a fresh invitation later if needed.`,
      confirmLabel: "Revoke invitation",
      variant: "destructive",
    });
    if (!ok) return;
    setBusyId(inviteId);
    try {
      const res = await fetch(`/api/channels/${channelId}/invite`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ inviteId }),
      });
      if (res.ok) {
        setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
        toast({ title: "Invitation revoked" });
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to revoke invitation.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to revoke invitation.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  // Shared DD/MM/YYYY formatters — Craig M4 tracker #54.
  // Use "Never" rather than the default "—" fallback for last-active.
  const formatDate = (s: string) => sharedFormatDate(s);
  const formatDateTime = (s: string | null) =>
    s ? sharedFormatDateTime(s) : "Never";

  const isLoading = loadingViewers || loadingInvites;

  return (
    <>
      {confirmDialogNode}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5" />
                Third-Party Viewers
              </CardTitle>
              <CardDescription>
                Solicitors, mediators, or social workers who can read this channel. Each parent controls whether their own originals are shared.
              </CardDescription>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0 rounded-2xl"
                onClick={() => {
                  setLoadingViewers(true);
                  setLoadingInvites(true);
                  fetchViewers();
                  fetchInvites();
                }}
                disabled={isLoading}
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
              <Button onClick={() => setShowInviteModal(true)} className="h-11 flex-1 rounded-2xl sm:flex-none">
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Viewer
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {pendingInvites.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Pending Invitations
              </h3>
              <div className="space-y-2">
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex flex-col gap-3 p-3 bg-muted/50 rounded-lg sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {invite.viewerName || "(no name)"}{" "}
                        <span className="text-muted-foreground font-normal">— {invite.email}</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Expires {formatDate(invite.expiresAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex w-full gap-1 sm:w-auto">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 flex-1 justify-center sm:h-8 sm:w-9 sm:flex-none"
                        onClick={() => handleShowLink(invite.id)}
                        disabled={busyId === invite.id}
                        title="Show invitation link"
                        aria-label="Show invitation link"
                      >
                        {busyId === invite.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Link2 className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 flex-1 justify-center sm:h-8 sm:w-9 sm:flex-none"
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={busyId === invite.id}
                        title="Revoke invitation"
                        aria-label="Revoke invitation"
                      >
                        <UserX className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Active Viewers ({viewers.length})
            </h3>
            {loadingViewers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : viewers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No active viewers. Invite someone to view this channel.
              </p>
            ) : (
              <div className="space-y-3">
                {viewers.map((viewer) => {
                  const iInvited = viewer.invitingParentUserId === myUserId;
                  return (
                    <div key={viewer.id} className="rounded-xl border border-primary/10 p-3 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {viewer.name || "(no name)"}{" "}
                            <span className="text-muted-foreground font-normal">— {viewer.email}</span>
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            {iInvited ? (
                              <Badge variant="secondary" className="text-xs">Invited by you</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">Invited by the other parent</Badge>
                            )}
                            {viewer.otherParentApproved ? (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">
                                Both parents approved
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
                                Inviting parent only
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              Added {formatDate(viewer.grantedAt)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Last active: {formatDateTime(viewer.lastAccessedAt)}
                            </span>
                          </div>
                        </div>
                        {iInvited ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-10 w-full justify-center text-destructive hover:text-destructive hover:bg-destructive/10 sm:h-8 sm:w-auto"
                            onClick={() => handleRemoveViewer(viewer)}
                            disabled={busyId === viewer.id}
                          >
                            {busyId === viewer.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <UserX className="w-4 h-4 mr-1" /> Remove
                              </>
                            )}
                          </Button>
                        ) : null}
                      </div>

                      {/* Non-inviting parent: approve / restrict their own originals */}
                      {!iInvited && (
                        <div className="rounded-lg bg-muted/40 p-3 space-y-2">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            By default the viewer sees the inviting parent&apos;s originals + both parents&apos; rewrites. You can choose to also share <em>your</em> originals with them, or keep them private.
                          </p>
                          {viewer.otherParentApproved ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 rounded-xl"
                              onClick={() => handleConsent(viewer, "restrict")}
                              disabled={busyId === viewer.id}
                            >
                              {busyId === viewer.id ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <ShieldOff className="w-4 h-4 mr-2" />
                              )}
                              Restrict to rewrites only
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="h-9 rounded-xl"
                              onClick={() => handleConsent(viewer, "approve")}
                              disabled={busyId === viewer.id}
                            >
                              {busyId === viewer.id ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <ShieldCheck className="w-4 h-4 mr-2" />
                              )}
                              Allow my originals
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <InviteViewerModal
        open={showInviteModal}
        onOpenChange={(next) => {
          setShowInviteModal(next);
          if (!next) setReshareState(null);
        }}
        channelId={channelId}
        onInviteCreated={fetchInvites}
        preloadedLink={reshareState?.link ?? null}
        preloadedEmailSentTo={reshareState?.emailSentTo ?? null}
      />
    </>
  );
}
