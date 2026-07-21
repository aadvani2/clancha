"use client";

import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Clock, ShieldAlert, MoonStar } from "lucide-react";

export interface MessageItem {
  id: string;
  senderId: string | null;
  // Best-effort display name for the sender. Filled in by the messages API
  // primarily for viewer alignment, but harmless to render for members too.
  senderName?: string;
  originalText?: string;
  rewrittenText: string;
  imageUrl?: string;
  imageState?: "pending" | "approved" | "denied";
  state: string;
  isEmergency: boolean;
  isSystem?: boolean;
  isNewDay?: boolean;
  deliveredAt: string | null;
  createdAt: string;
}

interface MessageBubbleProps {
  message: MessageItem;
  isSender: boolean;
  // When true, show the sender's name above the bubble. Used by the viewer
  // panel since the viewer is neither parent and needs a label to tell who
  // said what.
  showSenderName?: boolean;
}

// Sender-side status pill. The lifecycle is updated by the channel page's
// 500ms poll, so a "Pending review" pill flips to "Sent" or "Blocked" without
// the sender having to refresh. Returns null for states where no pill is
// needed (delivered messages handle their own Original / Revision blocks).
function SenderStatePill({ state, hasRewriting }: { state: string; hasRewriting: boolean }) {
  // Delivered with a real rewrite → the Original/Revision blocks above this
  // already communicate "your message was softened". Don't add a pill.
  if (state === "delivered" && hasRewriting) return null;

  if (state === "delivered") {
    return (
      <p className="text-[10px] opacity-40 italic mt-1.5 flex items-center gap-1">
        <span className="w-1 h-1 bg-white/30 rounded-full" />
        No changes applied
      </p>
    );
  }

  if (state === "held" || state === "rewriting" || state === "processing" || state === "received") {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-200/15 border border-amber-200/30 px-2 py-0.5">
        <Clock className="w-3 h-3 text-amber-200" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-100">
          Pending review
        </span>
      </div>
    );
  }

  if (state === "blocked") {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-red-300/20 border border-red-300/40 px-2 py-0.5">
        <ShieldAlert className="w-3 h-3 text-red-200" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-red-100">
          Blocked
        </span>
      </div>
    );
  }

  if (state === "queued") {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-sky-200/15 border border-sky-200/30 px-2 py-0.5">
        <MoonStar className="w-3 h-3 text-sky-200" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-100">
          Queued — sends in receiving hours
        </span>
      </div>
    );
  }

  return null;
}

export function MessageBubble({ message, isSender, showSenderName }: MessageBubbleProps) {
  const [imgError, setImgError] = useState(false);

  // System message — centred neutral notification strip
  if (message.isSystem) {
    return (
      <div className="flex justify-center my-2 px-4">
        <div className="rounded-2xl bg-primary/8 border border-primary/15 px-3 py-2 max-w-[90%]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60 text-center mb-0.5">Clancha</p>
          <p className="text-xs text-muted-foreground text-center leading-snug break-words">
            {message.rewrittenText.replace(/^Clancha\s*[–-]\s*/i, "")}
          </p>
        </div>
      </div>
    );
  }

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isImageMessage = !!message.imageUrl && !imgError;
  // originalText is only present on the payload when the viewer/member is
  // actually entitled to see it (gated server-side in the messages API by
  // sender-is-self for members, or invitingParentUserId/otherParentApproved
  // for viewers) — so its presence alone is the visibility signal. Must NOT
  // be re-gated on isSender, which in viewer mode is just a left/right
  // layout flag (viewerSenderId = the channel creator) unrelated to consent.
  const showOriginal = !!message.originalText;
  const hasRewriting = showOriginal && message.originalText !== message.rewrittenText;

  // Decision logic for image visibility
  const isImageDenied = message.imageState === "denied";
  const isImagePending = message.imageState === "pending";

  return (
    // Outer row — pushes sender bubbles to the right, receiver to the left
    <div className={`flex w-full ${isSender ? "justify-end" : "justify-start"}`}>
      {/* Column that sizes to content (no fixed width) */}
      <div className={`flex min-w-0 flex-col items-${isSender ? "end" : "start"} max-w-[88%] sm:max-w-[75%]`}>

        {/* Sender name — viewer panel only. Members already know who's who. */}
        {showSenderName && message.senderName && (
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2 mb-1">
            {message.senderName}
          </span>
        )}

        {/* ── Bubble ── */}
        <div
          className={`
            relative rounded-2xl px-3 py-2 text-sm break-words shadow-sm overflow-hidden
            ${isSender
              ? "bg-[#2F4A44] text-white rounded-br-sm"
              : "bg-[#33383B] text-[#e9edef] rounded-bl-sm"
            }
          `}
        >
          {/* Image */}
          {message.imageUrl && !imgError && (
            <div className="relative group">
              <a href={message.imageUrl} target="_blank" rel="noopener noreferrer" className="block relative">
                <img
                  src={message.imageUrl}
                  alt="Shared image"
                  className={`rounded-lg object-contain max-h-80 w-auto max-w-full transition-all duration-300 ${isImageDenied ? 'opacity-30 grayscale blur-[2px]' : isImagePending ? 'opacity-60 blur-sm' : ''}`}
                  onError={() => setImgError(true)}
                />
                
                {/* ── UNSAFE STAMP ── */}
                {isImageDenied && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="border-[6px] border-[#e11d48] border-double rounded-full p-4 transform -rotate-12 opacity-90 scale-110">
                      <div className="border-[2px] border-[#e11d48] rounded-full p-2">
                        <span className="text-[#e11d48] font-black text-2xl tracking-tighter uppercase leading-none text-center block">
                          UNSAFE<br/>
                          <span className="text-xs">NOT APPROVED</span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── PENDING OVERLAY ── */}
                {isImagePending && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                    <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2">
                      <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                      <span className="text-white text-[10px] font-bold uppercase tracking-wider">Moderating...</span>
                    </div>
                  </div>
                )}
              </a>
            </div>
          )}

          {/* Image load error fallback */}
          {message.imageUrl && imgError && (
            <div className="flex items-center gap-2 py-1 opacity-70">
              <span className="text-xl">⚠️</span>
              <p className="text-xs italic">Image unavailable</p>
            </div>
          )}

          {/* Message Content (Text/Caption) */}
          <div className="flex flex-col gap-2 mt-1">
            {/* Original text — shown whenever the API granted it, non-image messages */}
            {!isImageMessage && showOriginal && (
              <div className="text-xs opacity-75 mb-0.5 border-l-2 border-white/20 pl-2 py-0.5">
                <p className="font-bold text-[10px] uppercase tracking-wider opacity-60">Original</p>
                <p className="italic text-white/90 leading-relaxed">{message.originalText}</p>
              </div>
            )}

            {/* Delivered / rewritten text (or Image Caption/URL) */}
            <div className={showOriginal && hasRewriting && !isImageMessage ? "pt-1.5 border-t border-white/10" : ""}>
              {showOriginal && hasRewriting && !isImageMessage && (
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">
                  Revision
                </p>
              )}
              
              {/* For image messages, suppress the [Image] placeholder — the image
                  itself is visible above. Only show text if it's a real caption
                  (not the "[Image]" sentinel and not a raw URL). */}
              {isImageMessage
                ? (() => {
                    const t = message.rewrittenText.trim();
                    const isPlaceholder = t === "[Image]" || /^https?:\/\//.test(t);
                    return isPlaceholder ? null : (
                      <p className="text-[12px] opacity-90 mt-1 leading-relaxed">{t}</p>
                    );
                  })()
                : (
                  <p className="leading-relaxed">
                    {message.rewrittenText.split(/(\s+)/).map((part, i) => {
                      if (part.match(/^https?:\/\//)) {
                        return (
                          <a
                            key={i}
                            href={part}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white/90 hover:text-white underline underline-offset-2 break-all font-medium transition-colors"
                          >
                            {part}
                          </a>
                        );
                      }
                      return part;
                    })}
                  </p>
                )
              }

              {isSender && !isImageMessage && (
                <SenderStatePill state={message.state} hasRewriting={hasRewriting} />
              )}
            </div>
          </div>

          {/* Emergency badge */}
          {message.isEmergency && (
            <div className="mt-2 flex">
              <Badge className="bg-[#e8a675] text-[#33383B] hover:bg-[#e8a675]/90 border-none text-[9px] h-4 px-1.5 font-bold uppercase tracking-tight">
                Emergency
              </Badge>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-1 px-1 opacity-80 font-medium">
          <span>{time}</span>
          {isSender && (
             <svg viewBox="0 0 16 11" className="w-3.5 h-3.5 fill-current text-primary">
               <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.358-.325a.32.32 0 0 0-.484.032l-.378.48a.418.418 0 0 0 .036.54l1.32 1.267a.32.32 0 0 0 .484-.032l6.273-8.048a.366.366 0 0 0-.063-.512zm-3.92-1.958l-.475-.36a.365.365 0 0 0-.509.063l-5.352 6.842a.32.32 0 0 1-.484.033l-3.322-3.21a.418.418 0 0 0-.54-.036l-.482.378a.365.365 0 0 0-.063.51l4.417 4.26a.32.32 0 0 0 .484-.032l6.326-8.094a.366.366 0 0 0-.063-.513z" />
             </svg>
          )}
        </div>
      </div>
    </div>
  );
}
