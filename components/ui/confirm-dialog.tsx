"use client";

import { useState, useCallback, useRef, type ReactNode } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * In-app confirmation dialog — replacement for window.confirm() so destructive
 * actions render in Clancha's own UI rather than the browser-native modal.
 *
 * Hook usage:
 *   const { confirm, dialog } = useConfirmDialog();
 *   // ... inside an onClick:
 *   const ok = await confirm({ title: "Leave channel?", description: "..." });
 *   if (!ok) return;
 *   // ... do destructive thing
 *   // render {dialog} once near the root of your component.
 *
 * The returned promise resolves to true on Confirm, false on Cancel/close.
 */

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  busyLabel?: string;
  /** When provided, the dialog waits for the async callback to complete and
   * shows busyLabel during the wait. Errors propagate out. */
  onConfirm?: () => void | Promise<void>;
}

interface PendingState {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingState | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open || busyRef.current) return;
      if (pending) {
        pending.resolve(false);
        setPending(null);
      }
    },
    [pending]
  );

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    const { options, resolve } = pending;
    if (options.onConfirm) {
      setBusy(true);
      busyRef.current = true;
      try {
        await options.onConfirm();
        resolve(true);
        setPending(null);
      } catch {
        // Caller is expected to surface their own error toast.
        resolve(false);
        setPending(null);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    } else {
      resolve(true);
      setPending(null);
    }
  }, [pending]);

  const handleCancel = useCallback(() => {
    if (busyRef.current) return;
    if (pending) {
      pending.resolve(false);
      setPending(null);
    }
  }, [pending]);

  const isDestructive = pending?.options.variant === "destructive";

  const dialog: ReactNode = (
    <Dialog open={pending !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isDestructive && <AlertTriangle className="w-4 h-4 text-destructive" />}
            {pending?.options.title}
          </DialogTitle>
          {pending?.options.description && (
            <DialogDescription className="text-sm leading-relaxed">
              {pending.options.description}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2 flex-row justify-end">
          <Button variant="outline" onClick={handleCancel} disabled={busy}>
            {pending?.options.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={isDestructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                {pending?.options.busyLabel ?? "Working…"}
              </>
            ) : (
              pending?.options.confirmLabel ?? "Confirm"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog };
}
