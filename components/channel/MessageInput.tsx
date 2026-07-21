import React, { useState } from "react";
import Link from "next/link";
import { Send, Image as ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageUpload } from "@/components/ImageUpload";
import { useToast } from "@/hooks/use-toast";

interface MessageInputProps {
  channelId: string;
  disabled?: boolean;
  pictureShareEnabled?: boolean;
  onMessageSent?: () => void;
}

export function MessageInput({
  channelId,
  disabled = false,
  pictureShareEnabled = false,
  onMessageSent,
}: MessageInputProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();

  const handleSend = async () => {
    if (!message.trim() || isSending || disabled) return;

    setIsSending(true);
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channelId, text: message }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send message");
      }

      setMessage("");
      onMessageSent?.();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-4 py-3 bg-[#f3eae0]">
      {pictureShareEnabled && (
        <p className="max-w-5xl mx-auto text-[11px] text-[#4f7a61]/70 leading-snug px-1 mb-2">
          Images are checked by Clancha before they appear.
        </p>
      )}
      <div className="flex items-center gap-3 max-w-5xl mx-auto">
        {/* £4.99 Gating Logic - Move to Left */}
        <div className="flex items-center">
          {pictureShareEnabled ? (
            <ImageUpload
              channelId={channelId}
              onUploadSuccess={onMessageSent}
            />
          ) : (
            // Picture Sharing inactive: clickable upsell rather than a dead
            // disabled control. Tapping the icon shows a toast with a link
            // to the channel settings page where either user can enable.
            <Button
              size="icon"
              variant="ghost"
              type="button"
              className="text-primary/70 hover:text-primary"
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

        <div className="flex-1 flex items-center bg-white rounded-full border border-gray-200 px-4 py-1.5 shadow-sm focus-within:ring-1 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? "Messaging is disabled" : "Type your message..."}
            disabled={disabled || isSending}
            className="flex-1 min-h-[44px] max-h-[120px] resize-none border-none bg-transparent py-3 text-base focus-visible:ring-0 focus-visible:ring-offset-0 md:text-sm"
            rows={1}
          />
          <Button
            size="icon"
            className="ml-1 shrink-0 rounded-full"
            onClick={handleSend}
            disabled={disabled || isSending || !message.trim()}
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground/70 mt-2 text-center font-medium">
        Messages are automatically rewritten to ensure calm communication.
      </p>
    </div>
  );
}
