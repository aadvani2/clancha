"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

function CheckoutRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pictureAddon = searchParams.get("pictureAddon") === "1";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/checkout/create-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ scenario: "signup", pictureAddon }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.url) {
          setError(data.error || "Failed to start secure checkout. Please try again.");
          return;
        }
        window.location.href = data.url;
      } catch {
        if (!cancelled) setError("Unable to reach our payment provider. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pictureAddon]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-4">
        {error ? (
          <>
            <div className="rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive px-5 py-3 text-sm font-semibold">
              {error}
            </div>
            <Button
              className="w-full h-11 rounded-xl"
              onClick={() => router.push("/subscription")}
            >
              Back to plans
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" />
            <h1 className="text-xl font-black text-foreground">
              Redirecting to secure checkout…
            </h1>
            <p className="text-sm text-muted-foreground">
              You&apos;re being taken to Stripe to enter your payment details.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-6">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Payments processed securely by Stripe
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[100dvh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <CheckoutRedirect />
    </Suspense>
  );
}
