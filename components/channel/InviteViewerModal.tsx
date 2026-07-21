"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Copy, Check, Loader2, UserPlus, Link2, Mail, Trash2 } from "lucide-react";

interface InviteViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  onInviteCreated?: () => void;
  /** When provided, the modal opens directly in "Invitation Ready" state
   * with this link rather than the empty-form state. Used by the
   * "Show link" button on each pending invitation row. */
  preloadedLink?: string | null;
  /** Recipient email — when provided alongside preloadedLink, the title
   * flips to "Invitation sent" + names the recipient. */
  preloadedEmailSentTo?: string | null;
}

export function InviteViewerModal({
  open,
  onOpenChange,
  channelId,
  onInviteCreated,
  preloadedLink,
  preloadedEmailSentTo,
}: InviteViewerModalProps) {
  const [viewerName, setViewerName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteId, setInviteId] = useState<string | null>(null);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");

  // Hydrate state when the parent passes in a preloaded link (re-share flow).
  useEffect(() => {
    if (preloadedLink) {
      setInviteLink(preloadedLink);
      setEmailSentTo(preloadedEmailSentTo ?? null);
    }
  }, [preloadedLink, preloadedEmailSentTo]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!viewerName.trim()) {
      setError("Please enter the viewer's full name.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!email || !emailRegex.test(email.trim())) {
      setError("Please enter a valid email address (e.g. name@example.com).");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, viewerName: viewerName.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create invitation");
        return;
      }

      setInviteLink(data.inviteLink);
      setInviteId(data.inviteId ?? null);
      setEmailSentTo(data.emailSent ? email.trim() : null);
      onInviteCreated?.();
      toast({
        title: data.emailSent ? "Invitation sent" : "Invitation created",
        description: data.emailSent
          ? `Sent to ${email.trim()}.`
          : "Copy the link and share it with the viewer.",
      });
    } catch {
      setError("Failed to create invitation. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied", description: "Invitation link copied to clipboard." });
    } catch {
      toast({ title: "Error", description: "Failed to copy link.", variant: "destructive" });
    }
  };

  const handleClose = () => {
    setViewerName("");
    setEmail("");
    setInviteLink(null);
    setInviteId(null);
    setEmailSentTo(null);
    setError("");
    setCopied(false);
    onOpenChange(false);
  };

  const handleRevoke = async () => {
    if (!inviteId) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/invite`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ inviteId }),
      });
      if (res.ok) {
        toast({ title: "Invitation revoked", description: "The link can no longer be used." });
        onInviteCreated?.();
        handleClose();
      } else {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Error", description: data.error || "Failed to revoke invitation.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to revoke invitation.", variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md p-0 overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary/8 via-background to-background px-6 pt-6 pb-5 border-b border-primary/8">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2.5 rounded-xl ${inviteLink && emailSentTo ? "bg-emerald-50" : "bg-primary/10"}`}>
                {inviteLink ? (
                  emailSentTo ? (
                    <Mail className="w-5 h-5 text-emerald-700" />
                  ) : (
                    <Link2 className="w-5 h-5 text-primary" />
                  )
                ) : (
                  <UserPlus className="w-5 h-5 text-primary" />
                )}
              </div>
            </div>
            <DialogTitle className="text-xl font-bold text-left text-foreground">
              {inviteLink ? (emailSentTo ? "Invitation sent" : "Invitation ready") : "Invite Viewer"}
            </DialogTitle>
            <DialogDescription className="text-left text-sm leading-relaxed mt-1">
              {inviteLink
                ? emailSentTo
                  ? `We've emailed the invitation to ${emailSentTo}. The link below is a backup you can share manually if needed — it expires in 72 hours.`
                  : "Email couldn't be sent automatically. Copy the link below and share it securely. It expires in 72 hours."
                : "The viewer will automatically see your originals and both parents' rewrites. The other parent will be notified and can choose, from their own portal, whether to also share their originals."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body */}
        {!inviteLink ? (
          <form onSubmit={handleCreate} className="px-6 pt-5 pb-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="viewerName" className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">
                Viewer&apos;s full name
              </Label>
              <Input
                id="viewerName"
                type="text"
                value={viewerName}
                onChange={(e) => setViewerName(e.target.value)}
                placeholder="e.g. Alex Morgan (solicitor)"
                disabled={loading}
                className="h-11"
              />
              <p className="text-[11px] text-muted-foreground leading-snug">
                So the other parent can identify who you&apos;ve added — email addresses alone don&apos;t always make that clear.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="viewer@example.com"
                disabled={loading}
                className="h-11"
              />
              <p className="text-[11px] text-muted-foreground leading-snug">
                If they already have a Clancha viewer account, this channel will be added to it. Otherwise they&apos;ll set a password on first acceptance.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 text-xs p-3 rounded-xl border border-red-100 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <Button type="submit" disabled={loading} className="w-full h-11 rounded-xl font-semibold">
                {loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</>
                ) : (
                  "Create invitation"
                )}
              </Button>
              <Button type="button" variant="outline" onClick={handleClose} disabled={loading} className="w-full h-11 rounded-xl">
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="px-6 pt-5 pb-6 space-y-5">
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-primary/70">Invitation link</p>
              <div className="flex gap-2">
                <Input
                  value={inviteLink}
                  readOnly
                  className="h-11 bg-background font-mono text-base md:text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  className="shrink-0 rounded-xl"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This link expires in <span className="font-semibold">72 hours</span>.
              </p>
            </div>

            <Button onClick={handleClose} className="w-full h-11 rounded-xl font-semibold">
              Done
            </Button>
            {inviteId && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleRevoke}
                disabled={revoking}
                className="w-full h-10 rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10 text-sm"
              >
                {revoking ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                Revoke this invitation
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
