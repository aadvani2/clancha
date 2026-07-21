"use client";

import { useState, useEffect, useRef } from "react";
import { Info, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useAppSelector } from "@/hooks/redux";
import type { ChannelItem } from "@/components/channel/ChannelList";
import type { Country } from "react-phone-number-input";
import {
  ChannelSetupFields,
  emptyChannelSetup,
  validateChannelSetup,
  type ChannelSetupValue,
  type ChannelSetupErrors,
} from "@/components/channel/ChannelSetupFields";

interface CreateChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (channel: ChannelItem) => void;
  children?: React.ReactNode;
}

export function CreateChannelModal({
  open,
  onOpenChange,
  onSuccess,
  children,
}: CreateChannelModalProps) {
  const { currentUser } = useAppSelector((state) => state.user);
  const [defaultCountry, setDefaultCountry] = useState<Country>("GB");

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.includes("Calcutta") || tz.includes("Kolkata") || tz.includes("Delhi")) {
      setDefaultCountry("IN");
    }
  }, []);

  type PendingState =
    | { kind: "idle" }
    | { kind: "polling"; since: string; timeoutMs: number }
    | { kind: "failed"; message: string; hostedInvoiceUrl: string | null }
    | { kind: "timeout" };
  const [pendingState, setPendingState] = useState<PendingState>({ kind: "idle" });
  const pollAbortRef = useRef<{ cancelled: boolean } | null>(null);

  const stopPolling = () => {
    if (pollAbortRef.current) pollAbortRef.current.cancelled = true;
    pollAbortRef.current = null;
  };

  const [setup, setSetup] = useState<ChannelSetupValue>(() =>
    emptyChannelSetup({
      // Picture sharing is opt-in PER channel per spec — never seed from the
      // legacy global isPictureAddonEnabled flag, otherwise once a user has
      // it on one channel every subsequent channel also defaults to on AND
      // the toggle below was being hidden, so they couldn't even uncheck it.
      pictureShareEnabled: false,
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      const res = await fetch("/api/channels", {
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
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402 && data.hostedInvoiceUrl) {
          setPendingState({
            kind: "failed",
            message: data.error ?? "Your previous payment is still unpaid.",
            hostedInvoiceUrl: data.hostedInvoiceUrl,
          });
          return;
        }
        setSubmitError(data.error ?? "Failed to create channel");
        return;
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      if (data.pending) {
        const since = new Date().toISOString();
        setPendingState({ kind: "polling", since, timeoutMs: 30_000 });
        return;
      }
      onSuccess?.(data);
      setSetup(emptyChannelSetup());
      onOpenChange(false);
    } catch {
      setSubmitError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Refs so the polling effect doesn't restart on parent re-renders.
  const onSuccessRef = useRef(onSuccess);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onOpenChangeRef.current = onOpenChange;
  });

  useEffect(() => {
    if (pendingState.kind !== "polling") return;
    const since = pendingState.since;
    const TIMEOUT_MS = pendingState.timeoutMs;
    const token = { cancelled: false };
    pollAbortRef.current = token;
    const startedAt = Date.now();
    const INTERVAL_MS = 2500;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (token.cancelled) return;
      try {
        const res = await fetch(
          `/api/channels/pending-status?since=${encodeURIComponent(since)}`,
          { credentials: "include" }
        );
        const data = await res.json();
        if (token.cancelled) return;
        if (data.status === "completed" && data.channel) {
          onSuccessRef.current?.(data.channel);
          setSetup(emptyChannelSetup());
          setPendingState({ kind: "idle" });
          onOpenChangeRef.current(false);
          return;
        }
        if (data.status === "failed") {
          setPendingState({
            kind: "failed",
            message: data.error || "Payment failed.",
            hostedInvoiceUrl: data.hostedInvoiceUrl ?? null,
          });
          return;
        }
      } catch {
        // ignore transient errors
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        setPendingState({ kind: "timeout" });
        return;
      }
      timer = setTimeout(tick, INTERVAL_MS);
    };
    timer = setTimeout(tick, INTERVAL_MS);
    return () => {
      token.cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pendingState]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSetup(emptyChannelSetup());
      setErrors({});
      setTouched({});
      setSubmitError(null);
      stopPolling();
      setPendingState({ kind: "idle" });
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {children}
      <DialogContent className="sm:max-w-[560px] p-0 overflow-y-auto border-none shadow-2xl rounded-[2rem] max-h-[95vh]">
        {pendingState.kind === "polling" ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 px-8 text-center">
            <div className="p-4 bg-primary/10 rounded-full">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
            <h3 className="text-xl font-black text-foreground font-poppins">Payment Processing</h3>
            <p className="text-sm text-muted-foreground font-medium leading-relaxed">
              Your payment is being processed. Your new channel will appear in your dashboard once confirmed — this usually takes a few seconds.
            </p>
            <Button variant="outline" className="mt-2 rounded-full" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : pendingState.kind === "failed" ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 px-8 text-center">
            <div className="p-4 bg-red-50 rounded-full">
              <AlertCircle className="w-10 h-10 text-red-600" />
            </div>
            <h3 className="text-xl font-black text-foreground font-poppins">Payment Declined</h3>
            <p className="text-sm text-muted-foreground font-medium leading-relaxed">
              {pendingState.message}
            </p>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto mt-2">
              <Button variant="outline" className="rounded-full" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
              {pendingState.hostedInvoiceUrl && (
                <Button
                  className="rounded-full bg-primary hover:bg-primary/90 gap-2"
                  onClick={() => {
                    window.location.href = pendingState.hostedInvoiceUrl!;
                  }}
                >
                  <ExternalLink className="w-4 h-4" />
                  Update payment method
                </Button>
              )}
            </div>
          </div>
        ) : pendingState.kind === "timeout" ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 px-8 text-center">
            <div className="p-4 bg-amber-50 rounded-full">
              <Info className="w-10 h-10 text-amber-600" />
            </div>
            <h3 className="text-xl font-black text-foreground font-poppins">Taking longer than expected</h3>
            <p className="text-sm text-muted-foreground font-medium leading-relaxed">
              Payment is still being processed. Your new channel will appear on your dashboard once it&apos;s confirmed — you can close this window safely.
            </p>
            <Button variant="outline" className="mt-2 rounded-full" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <div className="bg-gradient-to-br from-primary/10 via-background to-secondary/5 px-5 pb-5 pt-6 sm:px-8 sm:pb-6 sm:pt-8">
              <DialogHeader className="space-y-3">
                <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary font-bold tracking-tight py-0.5 w-fit">
                  New Channel
                </Badge>
                <DialogTitle className="text-2xl font-black text-foreground font-poppins tracking-tight">
                  Create New <span className="text-primary italic">Bridge</span>
                </DialogTitle>
                <DialogDescription className="text-muted-foreground font-medium">
                  Tell us about the recipient and how you&apos;d like Clancha to handle their messages. You can change any of this later from channel settings.
                </DialogDescription>
              </DialogHeader>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 px-5 pb-6 pt-2 sm:px-8 sm:pb-8">
              <ChannelSetupFields
                value={setup}
                onChange={setSetup}
                errors={errors}
                touched={touched}
                onBlur={(field) => setTouched((t) => ({ ...t, [field]: true }))}
                defaultCountry={defaultCountry}
              />

              {submitError && (
                <div className="bg-red-50 text-red-600 text-xs p-3 rounded-xl border border-red-100 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                  {submitError}
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button
                  type="submit"
                  disabled={submitting}
                  className={`w-full h-14 rounded-2xl text-base font-black transition-all duration-300 active:scale-[0.97] shadow-xl ${
                    submitting ? "opacity-70" : "bg-primary hover:bg-primary/90 shadow-primary/20"
                  }`}
                >
                  {submitting ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating channel…
                    </div>
                  ) : (
                    "Create channel"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
