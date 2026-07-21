"use client";

import { useState } from "react";
import { MessageCircle, Phone, Sparkles } from "lucide-react";
import { formatPhoneNumberIntl } from "react-phone-number-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WelcomeChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientName: string | null;
  clanchaNumber: string;
}

export function WelcomeChannelDialog({
  open,
  onOpenChange,
  recipientName,
  clanchaNumber,
}: WelcomeChannelDialogProps) {
  const displayName = (recipientName && recipientName.trim()) || "the other parent";
  const prettyNumber = formatPhoneNumberIntl(clanchaNumber) || clanchaNumber;

  // Two-step reveal (Craig, M4 feedback 05/07/26 §2.2): a plain-words
  // "Clancha works by text" welcome BEFORE the unique-number screen, because
  // testers assumed messaging happens inside the app. Wording is Craig's.
  const [step, setStep] = useState<"welcome" | "number">("welcome");
  // Reset on close (dialog stays mounted), so a reopen starts at the welcome.
  const handleOpenChange = (next: boolean) => {
    if (!next) setStep("welcome");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === "welcome" ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 text-primary mb-1">
                <MessageCircle className="w-4 h-4" />
                <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
                  Before you start
                </span>
              </div>
              <DialogTitle className="text-2xl font-black text-foreground tracking-tight">
                Welcome to Clancha
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                Clancha works through normal text messages. You message the other
                parent from your usual texting app, using the Clancha number we give
                you on the next page. Nothing is sent through an app or portal.
                Photos can be shared through the portal with the Picture Sharing
                add-on, never by text.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                className="w-full sm:w-auto h-11 bg-primary hover:bg-primary/90 rounded-xl font-bold"
                onClick={() => setStep("number")}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 text-primary mb-1">
                <Sparkles className="w-4 h-4" />
                <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
                  You&apos;re all set
                </span>
              </div>
              <DialogTitle className="text-2xl font-black text-foreground tracking-tight">
                Your channel is ready
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Here&apos;s the Clancha number for messaging{" "}
                <span className="font-semibold text-foreground">{displayName}</span>.
                Save it in your phone and use it for every message you send.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-5 my-2">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-bold text-primary/70 mb-2">
                <Phone className="w-3.5 h-3.5" />
                Unique Clancha number for {displayName}
              </div>
              <p className="text-2xl font-black text-primary tracking-tight font-mono break-all">
                {prettyNumber}
              </p>
              <p className="text-xs text-muted-foreground mt-3">
                Save it as{" "}
                <span className="font-semibold text-foreground">
                  {displayName} (Clancha)
                </span>{" "}
                in your contacts. {displayName} will reply as normal, and you&apos;ll
                see the conversation here. You can always find this number on your
                channel, on the dashboard and at the top of the message history.
              </p>
            </div>

            <DialogFooter>
              <Button
                className="w-full sm:w-auto h-11 bg-primary hover:bg-primary/90 rounded-xl font-bold"
                onClick={() => handleOpenChange(false)}
              >
                Got it
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
