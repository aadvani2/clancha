import { useRef, useState, useLayoutEffect } from "react";
import { ChevronDown } from "lucide-react";
import { MessageBubble, type MessageItem } from "./MessageBubble";
import { Button } from "@/components/ui/button";

interface MessageTimelineProps {
  messages: MessageItem[];
  currentUserId: string;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  // Viewer panel: a viewer is neither sender nor recipient on any message, so
  // we lay the bubbles out as if from the first channel member's POV (their
  // messages on the right, the other parent's on the left). The viewer's
  // currentUserId is never going to match a senderId, which is why we need
  // this hint. We also show a sender-name label above each bubble in viewer
  // mode so they can tell who's who.
  viewerSenderId?: string;
}

export function MessageTimeline({
  messages,
  currentUserId,
  loading,
  hasMore,
  onLoadMore,
  viewerSenderId,
}: MessageTimelineProps) {
  const isViewerMode = !!viewerSenderId;
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef({ scrollTop: 0, scrollHeight: 0 });
  const lastMessageIdRef = useRef<string | null>(null);
  
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const getDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    // Older days in the timeline use DD/MM/YYYY for consistency with the
    // rest of the app (Craig M4 tracker #54).
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    
    // Save current positions for logic
    scrollPosRef.current = { scrollTop, scrollHeight };
    
    const isBottom = scrollHeight - scrollTop - clientHeight < 150;
    setIsAtBottom(isBottom);
    setShowScrollButton(!isBottom);
    
    if (isBottom) {
      setUnreadCount(0);
    }
  };

  // Scroll stabilization: When messages are prepended, keep the scroll position relative to the content
  useLayoutEffect(() => {
    if (!containerRef.current || messages.length === 0) return;

    const container = containerRef.current;
    const newLastMessageId = messages[messages.length - 1]?.id;
    const isNewMessageAtBottom = newLastMessageId !== lastMessageIdRef.current;

    // SCROLL ANCHORING: If we prepended messages (last message didn't change)
    if (!isNewMessageAtBottom && lastMessageIdRef.current !== null) {
      const scrollDiff = container.scrollHeight - scrollPosRef.current.scrollHeight;
      if (scrollDiff > 0) {
        container.scrollTop = scrollPosRef.current.scrollTop + scrollDiff;
      }
    } 
    // AUTO SCROLL: Only if it's a truly NEW message at the bottom
    else if (isNewMessageAtBottom) {
      const lastMsg = messages[messages.length - 1];
      const wasFromMe = lastMsg.senderId === currentUserId;

      if (isAtBottom || wasFromMe || lastMessageIdRef.current === null) {
        container.scrollTo({ top: container.scrollHeight, behavior: lastMessageIdRef.current === null ? "auto" : "smooth" });
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUnreadCount(0);
      } else {
        setUnreadCount((prev) => prev + 1);
      }
    }

    lastMessageIdRef.current = newLastMessageId;
  }, [messages, currentUserId, isAtBottom]);

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
      setUnreadCount(0);
    }
  };

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading messages…
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      // Nothing is sent from the portal — the old "Send one below." copy
      // made testers think this was a messaging app (Craig, M4 §2.1).
      <div className="flex-1 flex items-center justify-center text-center px-6 text-muted-foreground text-sm italic opacity-60">
        No messages yet. Text your Clancha number from your phone&apos;s messaging
        app and the conversation will appear here.
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col bg-slate-50/30">
      <div 
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        <div className="max-w-4xl mx-auto flex flex-col space-y-1">
          {hasMore && onLoadMore && (
            <div className="flex justify-center pb-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={onLoadMore}
                className="h-10 text-xs text-primary font-bold hover:bg-primary/5 sm:h-8"
              >
                Load older messages
              </Button>
            </div>
          )}

          {messages.map((m, index) => {
            // Calculate isNewDay on the fly based on current and previous message
            const currentDay = new Date(m.createdAt).toDateString();
            const previousDay = index > 0 
              ? new Date(messages[index - 1].createdAt).toDateString() 
              : null;
            const isNewDay = currentDay !== previousDay;

            return (
              <div key={m.id} className="flex flex-col space-y-1">
                {/* DATE DIVIDER - Calculated here to avoid duplicates across batches */}
                {isNewDay && (
                  <div className="flex justify-center my-6 sticky top-2 z-10 pointer-events-none">
                    <span className="bg-white/80 backdrop-blur-md text-[#4f7a61] text-[10px] font-extrabold px-4 py-1.5 rounded-full uppercase tracking-widest shadow-sm border border-[#4f7a61]/10">
                      {getDateLabel(m.createdAt)}
                    </span>
                  </div>
                )}

                <MessageBubble
                  message={m}
                  isSender={
                    isViewerMode
                      ? m.senderId === viewerSenderId
                      : m.senderId === currentUserId
                  }
                  showSenderName={isViewerMode}
                />
              </div>
            );
          })}
          <div className="h-4" />
        </div>
      </div>

      {/* FLOAT SCROLL BUTTON */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 w-12 h-12 bg-white shadow-xl border border-gray-100 rounded-full flex items-center justify-center group hover:bg-slate-50 transition-all scale-100 ring-4 ring-transparent hover:ring-primary/5 active:scale-95 animate-in fade-in zoom-in slide-in-from-bottom-2 duration-300 z-50"
        >
          <ChevronDown className="w-5 h-5 text-gray-500 group-hover:text-primary transition-colors animate-bounce-subtle" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] font-bold h-5 min-w-[20px] px-1 rounded-full flex items-center justify-center border-2 border-white shadow-sm ring-2 ring-primary/10">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
