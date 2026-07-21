"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChannelSetupFields,
  emptyChannelSetup,
  validateChannelSetup,
  type ChannelSetupValue,
  type ChannelSetupErrors,
} from "@/components/channel/ChannelSetupFields";
import type { Country } from "react-phone-number-input";
import { useAppSelector } from "@/hooks/redux";

export default function SetupPage() {
  const router = useRouter();
  const { currentUser } = useAppSelector((state) => state.user);
  const [defaultCountry, setDefaultCountry] = useState<Country>("GB");
  const [setup, setSetup] = useState<ChannelSetupValue>(() =>
    emptyChannelSetup({
      receivingHoursStart: currentUser?.receivingHoursStart || "06:00",
      receivingHoursEnd: currentUser?.receivingHoursEnd || "23:00",
      timezone:
        currentUser?.timezone ||
        (typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : "Europe/London"),
    })
  );
  const [errors, setErrors] = useState<ChannelSetupErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof ChannelSetupErrors, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.includes("Calcutta") || tz.includes("Kolkata") || tz.includes("Delhi")) {
      setDefaultCountry("IN");
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = validateChannelSetup(setup);
    setErrors(newErrors);
    setTouched({
      otherUserPhone: true,
      recipientName: true,
      recipientEmail: true,
      receivingHours: true,
      children: true,
    });
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      // 1. Persist the channel-setup payload so the webhook can materialise
      //    a fully-configured channel on invoice.paid.
      const draftRes = await fetch("/api/setup/first-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          otherUserPhone: setup.otherUserPhone,
          pictureShareEnabled: setup.pictureShareEnabled,
          recipientName: setup.recipientName,
          recipientEmail: setup.recipientEmail || undefined,
          children: setup.children.filter((c) => c.name.trim()),
          receivingHoursStart: setup.receivingHoursStart,
          receivingHoursEnd: setup.receivingHoursEnd,
          timezone: setup.timezone,
          emergencyBypassEnabled: setup.emergencyBypassEnabled,
          rewriteTone: setup.rewriteTone,
        }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) {
        setSubmitError(draftData.error || "Failed to save channel setup.");
        return;
      }
      // 2. Create the Stripe Checkout session (subscription mode) and redirect.
      const sessionRes = await fetch("/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          scenario: "signup",
          pictureAddon: setup.pictureShareEnabled,
        }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok || !sessionData.url) {
        setSubmitError(sessionData.error || "Failed to start secure checkout.");
        return;
      }
      window.location.href = sessionData.url;
    } catch {
      setSubmitError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const total = 14.99 + (setup.pictureShareEnabled ? 4.99 : 0);

  return (
    <div className="h-[100dvh] min-h-[100svh] overflow-y-auto bg-background px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:py-10">
      <div className="max-w-xl mx-auto space-y-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="space-y-2">
          <h1 className="text-3xl font-black text-foreground tracking-tight">
            Set up your <span className="text-primary italic">first channel</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Fill in the details once and you&apos;ll land in your portal ready to go after payment. Everything can be changed later.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl border border-primary/15 bg-card p-5 sm:p-6">
            <ChannelSetupFields
              value={setup}
              onChange={setSetup}
              errors={errors}
              touched={touched}
              onBlur={(field) => setTouched((t) => ({ ...t, [field]: true }))}
              defaultCountry={defaultCountry}
            />
          </div>

          {submitError && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-3">
              {submitError}
            </div>
          )}

          <div className="rounded-2xl border border-primary/15 bg-card p-5 space-y-3">
            <h3 className="font-bold text-sm text-foreground">Order summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Core SMS service</span>
                <span className="font-semibold">£14.99 / mo</span>
              </div>
              {setup.pictureShareEnabled && (
                <div className="flex justify-between text-primary">
                  <span>Picture Sharing add-on</span>
                  <span className="font-semibold">+£4.99 / mo</span>
                </div>
              )}
              <div className="flex justify-between font-black text-base border-t border-primary/10 pt-2 mt-1">
                <span>Total / channel / mo</span>
                <span className="text-primary">£{total.toFixed(2)}</span>
              </div>
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-12 text-base font-black bg-primary hover:bg-primary/90 rounded-xl"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving and redirecting…
                </span>
              ) : (
                "Continue to secure payment"
              )}
            </Button>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <ShieldCheck className="w-3 h-3 text-primary" />
              You&apos;ll be taken to Stripe Checkout. Cancel any time from settings.
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
