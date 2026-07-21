"use client";

import { useEffect, useState, useRef } from "react";
import { useAppSelector } from "@/hooks/redux";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/ImageUpload";

interface Message {
    _id: string;
    senderId: string;
    createdAt: string;
    originalContent: string | null;
    rewrittenContent: string;
    status: string;
}

export function ChatInterface() {
    const { selectedChannelId, channels } = useAppSelector((state) => state.channel);
    const { currentUser } = useAppSelector((state) => state.user);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [sending, setSending] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const activeChannel = channels.find(c => c.id === selectedChannelId);

    useEffect(() => {
        // Scroll to bottom
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    const handleSend = async () => {
        if (!newMessage.trim() || !selectedChannelId) return;
        setSending(true);
        // UI-only: append a fake message locally without any API
        const fakeMessage: Message = {
            _id: Math.random().toString(36).slice(2),
            senderId: currentUser?.id || "me",
            createdAt: new Date().toISOString(),
            originalContent: newMessage,
            rewrittenContent: newMessage,
            status: "sent"
        };
        setMessages((prev) => [...prev, fakeMessage]);
        setNewMessage("");
        setSending(false);
    };

    if (!selectedChannelId) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground">
                Select a channel to start messaging
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col h-full min-h-[400px] border rounded-lg bg-card shadow-sm overflow-hidden">
            <div className="p-3 sm:p-4 border-b flex justify-between items-center bg-muted/20 rounded-t-lg">
                <div className="min-w-0">
                   <h3 className="font-semibold truncate">{activeChannel?.name}</h3>
                   <p className="text-xs text-muted-foreground truncate">via Clancha {activeChannel?.assignedPhoneNumber}</p>
                </div>
            </div>

            <ScrollArea className="flex-1 min-h-0 p-3 sm:p-4">
                <div className="space-y-4">
                    {messages.map((msg) => {
                        const isMe = msg.senderId === currentUser?.id;
                        return (
                            <div key={msg._id} className={cn("flex w-full mb-4", isMe ? "justify-end" : "justify-start")}>
                                <div className={cn(
                                    "max-w-[70%] rounded-2xl p-3 shadow-sm",
                                    isMe ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted text-foreground rounded-tl-none"
                                )}>
                                    {isMe && msg.originalContent && (
                                        <div className="text-xs opacity-70 mb-1 border-b border-white/20 pb-1 italic">
                                            Original: &quot;{msg.originalContent}&quot;
                                        </div>
                                    )}
                                    <p className="text-sm">
                                        {msg.rewrittenContent}
                                    </p>
                                    <div className="flex justify-end mt-1">
                                        <span className="text-[10px] opacity-70">
                                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={scrollRef} />
                </div>
            </ScrollArea>

            <div className="p-3 sm:p-4 border-t bg-background rounded-b-lg pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="flex gap-2 items-end">
                    <Textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Type your message..."
                        className="resize-none min-h-[44px] max-h-[120px] text-base sm:text-sm"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <div className="flex flex-col gap-2 shrink-0">
                        <Button onClick={handleSend} disabled={sending || !newMessage.trim()} className="h-11">
                            Send
                        </Button>
                        {selectedChannelId && (
                            <ImageUpload
                                channelId={selectedChannelId}
                                onUploadSuccess={() => { /* Potential: refresh messages */ }}
                            />
                        )}
                    </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                    Messages are processed to ensure calm and clear communication.
                </p>
            </div>
        </div>
    );
}
