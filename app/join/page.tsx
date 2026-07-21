"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppDispatch } from "@/hooks/redux";
import { loginSuccess } from "@/store/authSlice";
import { setUser } from "@/store/userSlice";

type LookupState =
  | { kind: "loading" }
  | { kind: "ok"; phoneMasked: string; inviterName: string; recipientName: string | null; channelId: string }
  | { kind: "consumed" }
  | { kind: "channel_closed" }
  | { kind: "invalid"; reason?: string };

type Step = "intro" | "code";

function JoinContent() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const searchParams = useSearchParams();
  const token = searchParams.get("t") || "";

  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [step, setStep] = useState<Step>("intro");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Resolve the token on mount. Also clear any existing session — if the
  // joiner clicks the A1 link while signed in as a different account on the
  // same device, we want them landing fresh in their own portal, not
  // overlaying onto someone else's session. Fire-and-forget; the cookie is
  // cleared by the time they hit "Verify".
  useEffect(() => {
    if (!token) {
      setLookup({ kind: "invalid", reason: "Missing invitation link" });
      return;
    }
    fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } catch {
      // localStorage unavailable — ignore
    }

    let cancelled = false;
    fetch(`/api/join/lookup?t=${encodeURIComponent(token)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || data.status === "invalid") {
          setLookup({ kind: "invalid", reason: data?.reason });
          return;
        }
        if (data.status === "consumed") setLookup({ kind: "consumed" });
        else if (data.status === "channel_closed") setLookup({ kind: "channel_closed" });
        else if (data.status === "ok") {
          setLookup({
            kind: "ok",
            phoneMasked: data.phoneMasked,
            inviterName: data.inviterName,
            recipientName: data.recipientName,
            channelId: data.channelId,
          });
        } else {
          setLookup({ kind: "invalid" });
        }
      })
      .catch(() => {
        if (!cancelled) setLookup({ kind: "invalid", reason: "Network error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSendCode = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/join/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't send the code");
        setBusy(false);
        return;
      }
      setStep("code");
    } catch {
      setError("Couldn't send the code");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length < 4) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/join/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: otp.trim() }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed");
        setBusy(false);
        return;
      }
      if (data.user) {
        const u = data.user;
        localStorage.setItem(
          "user",
          JSON.stringify({
            id: u.id,
            email: u.email ?? "",
            role: u.role ?? "user",
            name: u.name ?? "",
            phone: u.phone,
            maxChannels: 5,
            isSubscribed: false,
            isPictureAddonEnabled: false,
            subscriptionQuantity: 0,
          })
        );
        dispatch(loginSuccess({ token: "cookie" }));
        dispatch(
          setUser({
            id: u.id,
            email: u.email ?? "",
            role: u.role ?? "user",
            phone: u.phone,
            name: u.name ?? "",
            maxChannels: 5,
            isSubscribed: false,
            isPictureAddonEnabled: false,
            subscriptionQuantity: 0,
          })
        );
      }
      router.push(`/dashboard?joined=1&channelId=${data.channelId}`);
    } catch {
      setError("Verification failed");
      setBusy(false);
    }
  };

  if (lookup.kind === "loading") {
    return (
      <AuthLayout
        title="Joining your channel"
        description="Looking up your invitation…"
        linkLabel=""
        linkText=""
        linkHref="/"
      >
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-2xl" />
        </div>
      </AuthLayout>
    );
  }

  if (lookup.kind === "consumed") {
    return (
      <AuthLayout
        title="Already claimed"
        description="This invitation link has already been used. Please sign in instead."
        linkLabel="Have an account?"
        linkText="Sign in"
        linkHref="/login"
      >
        <Button
          className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90"
          onClick={() => router.push("/login")}
        >
          Go to sign in
        </Button>
      </AuthLayout>
    );
  }

  if (lookup.kind === "channel_closed") {
    return (
      <AuthLayout
        title="Channel closed"
        description="This Clancha channel is no longer active. If you think this is wrong, ask the other parent to start a new channel."
        linkLabel=""
        linkText=""
        linkHref="/"
      >
        <Button
          className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90"
          onClick={() => router.push("/")}
        >
          Back to Clancha
        </Button>
      </AuthLayout>
    );
  }

  if (lookup.kind === "invalid") {
    return (
      <AuthLayout
        title="Invitation not found"
        description={
          lookup.reason ||
          "We couldn't find this invitation. Ask the other parent to text you again so a fresh link can be issued."
        }
        linkLabel="Have an account?"
        linkText="Sign in"
        linkHref="/login"
      >
        <Button
          className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90"
          onClick={() => router.push("/")}
        >
          Back to Clancha
        </Button>
      </AuthLayout>
    );
  }

  if (step === "intro") {
    return (
      <AuthLayout
        title="Welcome to Clancha"
        description={
          `${lookup.inviterName} has added you to a Clancha channel. ` +
          `Verify your phone to claim your portal — no password, no payment.`
        }
        linkLabel="Have an account?"
        linkText="Sign in"
        linkHref="/login"
      >
        {error && (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 text-center mb-4">
            {error}
          </p>
        )}
        <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4 space-y-1 mb-5">
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-primary/70">
            We&apos;ll text a code to
          </p>
          <p className="text-lg font-mono text-foreground">
            {lookup.phoneMasked}
          </p>
        </div>
        <Button
          className="w-full h-12 rounded-2xl text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
          disabled={busy}
          onClick={handleSendCode}
        >
          {busy ? "Sending…" : "Send code"}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Enter your code"
      description={`We sent a 6-digit code to ${lookup.phoneMasked}.`}
      linkLabel="Wrong number?"
      linkText="Back"
      linkHref="/"
    >
      <form onSubmit={handleVerify} className="space-y-4 w-full">
        {error && (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 text-center">
            {error}
          </p>
        )}
        <div className="space-y-2">
          <div className="flex justify-center my-4">
            <Input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              placeholder="123456"
              value={otp}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              required
              maxLength={6}
              className="h-16 w-full max-w-[300px] rounded-2xl border-[#4f7a61]/20 bg-white/95 text-center text-2xl tracking-[0.35em] font-mono shadow-sm focus-visible:ring-2 sm:text-3xl sm:tracking-[0.55em]"
            />
          </div>
          <p className="text-xs text-center text-muted-foreground">
            Code expires in 10 minutes
          </p>
        </div>
        <Button
          type="submit"
          className="w-full h-12 rounded-2xl text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
          disabled={busy || otp.length < 4}
        >
          {busy ? "Verifying…" : "Verify and continue"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <AuthLayout
          title="Joining your channel"
          description="Looking up your invitation…"
          linkLabel=""
          linkText=""
          linkHref="/"
        >
          <Skeleton className="h-12 w-full rounded-2xl" />
        </AuthLayout>
      }
    >
      <JoinContent />
    </Suspense>
  );
}
