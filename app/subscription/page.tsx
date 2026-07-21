"use client";

import { useState, useEffect } from "react";
import { Check, Image as ImageIcon, MessageSquare, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function SubscriptionPage() {
  const [addPicture, setAddPicture] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phoneAvailable, setPhoneAvailable] = useState<boolean | null>(null);
  const router = useRouter();

  const corePrice = 14.99;
  const addonPrice = 4.99;
  const total = addPicture ? corePrice + addonPrice : corePrice;

  useEffect(() => {
    fetch("/api/phone-pool/check", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setPhoneAvailable(data.available))
      .catch(() => setPhoneAvailable(true));
  }, []);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const planName = addPicture ? "Core + Picture Sharing" : "Core SMS";
      const params = new URLSearchParams({
        plan: planName,
        price: total.toString(),
        period: "monthly",
        pictureAddon: addPicture ? "1" : "0",
      });
      router.push(`/checkout?${params.toString()}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] min-h-[100svh] overflow-y-auto bg-background px-4 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:py-12">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Heading */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-black text-foreground tracking-tight">
            Choose your <span className="text-primary italic">plan</span>
          </h1>
          <p className="text-muted-foreground text-base max-w-md mx-auto">
            Simple per-channel pricing. Add picture sharing as an optional extra — only pay for what you use.
          </p>
        </div>

        {phoneAvailable === false && (
          <div className="rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive px-5 py-3 text-sm font-semibold text-center">
            No phone numbers are currently available. Please contact support.
          </div>
        )}

        {/* Core plan card */}
        <div className="rounded-2xl border border-primary/15 bg-card shadow-sm overflow-hidden">
          <div className="h-1 bg-primary" />
          <div className="p-6 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary/10">
                  <MessageSquare className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-foreground">Core SMS service</h2>
                  <p className="text-sm text-muted-foreground">Everything you need for calm co-parenting</p>
                </div>
              </div>
              <div className="text-left sm:text-right shrink-0">
                <span className="text-3xl font-black text-primary">£{corePrice.toFixed(2)}</span>
                <p className="text-xs text-muted-foreground">per channel / month</p>
              </div>
            </div>

            <ul className="space-y-2.5">
              {[
                "Message rewriting — calm & clear or firm & fair tone",
                "Human moderation on every flagged message",
                "Full message history in the portal",
                "Receiving hours management",
                "Q&A search over your message history",
                "Third-party viewer access",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-foreground/80">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Picture sharing add-on — opt-in toggle card */}
        <div
          className={`rounded-2xl border-2 transition-all duration-300 overflow-hidden cursor-pointer shadow-sm ${
            addPicture
              ? "border-primary bg-primary/5 shadow-primary/10 shadow-md"
              : "border-primary/15 bg-card"
          }`}
          onClick={() => setAddPicture((v) => !v)}
        >
          <div className="p-5 md:p-6">
            <div className="flex flex-col gap-4 min-[380px]:flex-row min-[380px]:items-center">
              {/* Checkbox */}
              <div
                className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                  addPicture ? "bg-primary border-primary" : "border-primary/30 bg-background"
                }`}
              >
                {addPicture && <Check className="w-3.5 h-3.5 text-white" />}
              </div>

              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`p-2.5 rounded-xl transition-colors ${addPicture ? "bg-primary/15" : "bg-muted"}`}>
                  <ImageIcon className={`w-5 h-5 ${addPicture ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-foreground">
                    Add Picture Sharing{" "}
                    <span className="text-xs font-semibold text-muted-foreground ml-1">optional</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upload and receive photos via the portal. Every image is checked and approved before it&apos;s shared.
                  </p>
                </div>
              </div>

              <div className="shrink-0 text-left min-[380px]:text-right">
                <span className={`text-lg font-black ${addPicture ? "text-primary" : "text-muted-foreground"}`}>
                  +£{addonPrice.toFixed(2)}
                </span>
                <p className="text-[10px] text-muted-foreground">/ channel / mo</p>
              </div>
            </div>

            {addPicture && (
              <ul className="mt-4 ml-9 space-y-1.5">
                {[
                  "Portal-only upload — never via SMS",
                  "Every image checked, then reviewed by a moderator",
                  "Approved images in chat and a dedicated Pictures tab",
                  "30-day retention on denied images (admin only)",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-foreground/70">
                    <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Security note */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          Payments are processed securely by Stripe. You can cancel at any time from Settings.
        </div>

        {/* Order summary + CTA */}
        <div className="rounded-2xl border border-primary/15 bg-card p-5 md:p-6 space-y-4">
          <h3 className="font-bold text-sm text-foreground">Order summary</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Core SMS service</span>
              <span className="font-semibold">£{corePrice.toFixed(2)}/mo</span>
            </div>
            {addPicture && (
              <div className="flex justify-between text-primary">
                <span>Picture Sharing add-on</span>
                <span className="font-semibold">+£{addonPrice.toFixed(2)}/mo</span>
              </div>
            )}
            <div className="flex justify-between font-black text-base border-t border-primary/10 pt-2 mt-1">
              <span>Total per channel</span>
              <span className="text-primary">£{total.toFixed(2)}/mo</span>
            </div>
          </div>

          <Button
            className="w-full h-12 text-base font-black bg-primary hover:bg-primary/90 rounded-xl"
            disabled={loading || phoneAvailable === false}
            onClick={handleSubscribe}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Processing…
              </span>
            ) : (
              `Subscribe — £${total.toFixed(2)}/mo`
            )}
          </Button>
          <p className="text-[10px] text-center text-muted-foreground">
            Billed monthly. Cancel any time. Additional channels are billed at the same rate.
          </p>
        </div>
      </div>
    </div>
  );
}
