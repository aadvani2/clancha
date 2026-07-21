"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle, Eye } from "lucide-react";

type InviteState = "loading" | "valid" | "invalid" | "expired" | "submitting" | "accepted";

const MIN_PASSWORD_LENGTH = 8;

export default function AcceptInvitePage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const channelId = searchParams.get("channelId");
  const missingInviteParams = !token || !channelId;

  const [state, setState] = useState<InviteState>(
    missingInviteParams ? "invalid" : "loading"
  );
  const [inviteData, setInviteData] = useState<{
    email: string;
    accessLevel: string;
    expiresAt: string;
    existingAccount: boolean;
    passwordSet: boolean;
  } | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (missingInviteParams) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invites/accept?token=${token}&channelId=${channelId}`);
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 410) {
          setState("expired");
          return;
        }
        if (!res.ok || !data.valid) {
          setState("invalid");
          return;
        }
        setInviteData({
          email: data.email,
          accessLevel: data.accessLevel,
          expiresAt: data.expiresAt,
          existingAccount: !!data.existingAccount,
          passwordSet: !!data.passwordSet,
        });
        setState("valid");
      } catch {
        if (!cancelled) setState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, channelId, missingInviteParams]);

  const isNewAccount = inviteData ? !inviteData.passwordSet : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!password) {
      setError("Password is required.");
      return;
    }
    if (isNewAccount && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (isNewAccount && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (isNewAccount && !fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }

    setState("submitting");
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          token,
          channelId,
          password,
          fullName: isNewAccount ? fullName.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to accept invitation");
        setState("valid");
        return;
      }
      setState("accepted");
      toast({
        title: data.createdNewAccount ? "Account created" : "Welcome back",
        description: "You now have access to view this channel.",
      });
      // Hard navigation (not client-side router.push): the session cookie was
      // just set on this response, and a client-side transition could render
      // the channel before the new auth state was picked up — which showed as
      // the redirect hanging until a manual refresh (#41a). A full load
      // guarantees the cookie is applied and the channel data fetches cleanly.
      setTimeout(() => {
        window.location.assign(`/channel/${channelId}`);
      }, 1200);
    } catch {
      setError("Failed to accept invitation. Please try again.");
      setState("valid");
    }
  };

  if (state === "loading") {
    return (
      <div className="h-[100dvh] min-h-[100svh] overflow-y-auto px-4 py-6 flex items-start justify-center bg-background sm:items-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Validating invitation…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="h-[100dvh] min-h-[100svh] overflow-y-auto px-4 py-6 flex items-start justify-center bg-background sm:items-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Invitation</h2>
            <p className="text-muted-foreground text-center">
              This invitation link is invalid or has already been used.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="h-[100dvh] min-h-[100svh] overflow-y-auto px-4 py-6 flex items-start justify-center bg-background sm:items-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invitation Expired</h2>
            <p className="text-muted-foreground text-center">
              This invitation has expired. Please ask the channel member to send a new one.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "accepted") {
    return (
      <div className="h-[100dvh] min-h-[100svh] overflow-y-auto px-4 py-6 flex items-start justify-center bg-background sm:items-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <CheckCircle className="w-12 h-12 text-green-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Granted</h2>
            <p className="text-muted-foreground text-center">
              You now have viewer access. Redirecting to the channel…
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] min-h-[100svh] overflow-y-auto px-4 py-6 flex items-start justify-center bg-background sm:items-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <Eye className="w-5 h-5 text-muted-foreground" />
            <CardTitle>
              {isNewAccount ? "Create your viewer account" : "Sign in to add this channel"}
            </CardTitle>
          </div>
          <CardDescription>
            {isNewAccount
              ? "You've been invited to view a Clancha channel. Set a password to create your viewer account — you'll reuse it for any future channels you're invited to."
              : "Welcome back. Sign in with your viewer password to add this channel to your account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-4 bg-muted/50 rounded-lg">
            <p className="text-sm">
              <span className="text-muted-foreground">Email:</span>{" "}
              <span className="font-medium">{inviteData?.email}</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isNewAccount && (
              <div className="space-y-2">
                <Label htmlFor="fullName">Your full name</Label>
                <Input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  className="h-11"
                  disabled={state === "submitting"}
                />
                <p className="text-xs text-muted-foreground">
                  Shown to the parents on the channel so they know who you are.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">
                {isNewAccount ? "Choose a password" : "Password"}
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete={isNewAccount ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
                disabled={state === "submitting"}
              />
              {isNewAccount && (
                <p className="text-xs text-muted-foreground">
                  At least {MIN_PASSWORD_LENGTH} characters. You&apos;ll reuse this for future viewer invitations.
                </p>
              )}
            </div>

            {isNewAccount && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-11"
                  disabled={state === "submitting"}
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              className="w-full h-12 rounded-2xl"
              disabled={state === "submitting"}
            >
              {state === "submitting" ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isNewAccount ? "Creating account…" : "Signing in…"}
                </>
              ) : isNewAccount ? (
                "Create account & accept invitation"
              ) : (
                "Sign in & add this channel"
              )}
            </Button>
          </form>

          <p className="mt-4 text-xs text-muted-foreground text-center">
            As a viewer you have read-only access. You&apos;ll see the inviting parent&apos;s messages in full, plus both parents&apos; rewritten messages. The other parent&apos;s original messages stay private unless they choose to share them from their own portal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
