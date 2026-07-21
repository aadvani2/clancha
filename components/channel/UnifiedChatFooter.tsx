"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";
import { Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/ImageUpload";
import { useToast } from "@/hooks/use-toast";

interface UnifiedChatFooterProps {
  channelId: string;
  disabled?: boolean;
  pictureShareEnabled?: boolean;
  onMessageSent?: () => void;
}

export function UnifiedChatFooter({
  channelId,
  disabled = false,
  pictureShareEnabled = false,
  onMessageSent,
}: UnifiedChatFooterProps) {
  const [typedText, setTypedText] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // History search starts CLOSED — testers mistook a permanently-open text
  // field for a message composer (Craig, M4 feedback 05/07/26 §2.1). The
  // field only appears after an explicit "Ask about your history" tap.
  const [searchOpen, setSearchOpen] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── History search (Q&A) ──
  const handleHistorySearch = async () => {
    if (!typedText.trim() || isSearching || disabled) return;

    setIsSearching(true);
    setAnswer(null);

    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channelId, question: typedText.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to search your history");

      setAnswer(data.answer);
    } catch (error) {
      toast({
        title: "Search failed",
        description: error instanceof Error ? error.message : "Service unavailable",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleHistorySearch();
    }
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setAnswer(null);
    setTypedText("");
  };

  // Auto-grow the textarea so wrapped questions get real line-height instead
  // of overlapping inside a single-row box (Craig, M4 feedback §2.1).
  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  return (
    <div className="bg-[#f2e8d9] px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 border-t border-[#4f7a61]/10">
      <div className="max-w-5xl mx-auto flex flex-col gap-3">

        {/* ── History search area (opens on demand) ── */}
        {searchOpen && (
          <div className="bg-white/60 backdrop-blur-md rounded-2xl border border-white/40 shadow-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/40 bg-white/40">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#4f7a61] animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#4f7a61]">History search</span>
              </div>
              <button
                onClick={closeSearch}
                aria-label="Close history search"
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-4 max-h-[300px] overflow-y-auto custom-scrollbar">
              {isSearching ? (
                <div className="flex items-center gap-3 py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-[#4f7a61]" />
                  <p className="text-sm italic text-muted-foreground">Searching your message history...</p>
                </div>
              ) : answer ? (
                <p className="text-sm leading-relaxed text-[#33383B] whitespace-pre-wrap">{answer}</p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  Ask a question below — for example &quot;What time is pickup on Friday?&quot; — and
                  Clancha will look through this channel&apos;s message history for the answer.
                  Nothing you type here is sent to the other parent.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Picture Sharing pre-upload helper (Craig M4 tracker #27) —
            persistent line above the input row so users know moderation
            happens BEFORE the recipient sees the image. Only shows when
            the add-on is enabled. */}
        {pictureShareEnabled && (
          <p className="text-[11px] text-[#4f7a61]/70 leading-snug px-1">
            Images are checked by Clancha before they appear.
          </p>
        )}

        {/* ── Action row ── */}
        <div className="flex min-w-0 items-end gap-2">
          {/* Image Upload Area — hidden entirely when channel is view-only/closed */}
          {!disabled && (
            <div className="shrink-0 flex items-center justify-center">
              {pictureShareEnabled ? (
                <ImageUpload
                  channelId={channelId}
                  onUploadSuccess={onMessageSent}
                />
              ) : (
                // Picture Sharing inactive: clickable £4.99 upsell rather than
                // a dead grey icon (Craig M4 tracker #25). Tapping shows a
                // toast linking to channel settings where either user can
                // turn it on.
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  className="h-11 w-11 rounded-full border border-white/40 bg-white/50 text-[#33383B] hover:text-primary hover:bg-white"
                  title="Add Picture Sharing (£4.99/mo) to upload photos"
                  onClick={() => {
                    toast({
                      title: "Picture Sharing isn't active on this channel",
                      description: (
                        <span>
                          Add Picture Sharing for £4.99/month — either user on the channel can enable it.{" "}
                          <Link
                            href={`/channel/${channelId}/settings`}
                            className="underline font-semibold"
                          >
                            Open channel settings
                          </Link>
                          .
                        </span>
                      ),
                    });
                  }}
                >
                  <ImageIcon className="w-5 h-5" />
                </Button>
              )}
            </div>
          )}

          {!searchOpen ? (
            /* Obvious button, not an open text field (Craig, M4 feedback §2.1).
               Messages are never sent from the portal — this only opens the
               history search. */
            <Button
              variant="outline"
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex-1 min-w-0 h-12 rounded-full border-[#4f7a61]/20 bg-white text-[#4f7a61] font-semibold shadow-xl hover:bg-white hover:text-[#3e614d] hover:border-[#4f7a61]/40"
            >
              <Search className="w-4 h-4 mr-2 shrink-0" />
              <span className="truncate">Ask about your history</span>
            </Button>
          ) : (
            /* Open search pill */
            <div className="flex-1 min-w-0 min-h-[48px] bg-white rounded-3xl border border-[#4f7a61]/20 shadow-xl flex items-end py-1.5 pr-1.5 pl-4 transition-all focus-within:ring-2 focus-within:ring-[#4f7a61]/10 focus-within:border-[#4f7a61]/30">
              <textarea
                ref={textareaRef}
                value={typedText}
                autoFocus
                onChange={(e) => {
                  setTypedText(e.target.value);
                  autoGrow();
                }}
                onKeyDown={handleKeyDown}
                placeholder={disabled ? "Channel is view-only" : "Ask about your message history..."}
                disabled={disabled || isSearching}
                rows={1}
                className="flex-1 self-center min-w-0 w-full max-h-[140px] resize-none bg-transparent border-none outline-none py-1.5 leading-snug text-base md:text-sm text-[#33383B] placeholder:text-xs placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50"
              />

              {/* Actions Area */}
              <div className="flex items-center gap-1.5 shrink-0 px-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleHistorySearch}
                  disabled={disabled || isSearching || !typedText.trim()}
                  className="h-10 rounded-full px-2.5 text-[11px] font-bold uppercase tracking-tight text-[#4f7a61] hover:bg-[#4f7a61]/5 sm:h-8 sm:px-3"
                >
                  {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5 sm:mr-1" />}
                  <span className="hidden sm:inline">Search</span>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Subtext */}
        <p className="text-[10px] text-center text-[#33383B]/50 font-medium tracking-tight">
          To message the other parent, text your Clancha number from your phone&apos;s
          messaging app. Messages are rewritten only when needed to reduce escalation.
        </p>
      </div>
    </div>
  );
}
