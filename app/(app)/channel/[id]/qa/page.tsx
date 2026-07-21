"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Send, Loader2, Search, Sparkles, AlertCircle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAppSelector } from "@/hooks/redux";

interface Turn {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  createdAt: number;
}

const SUGGESTED_QUESTIONS = [
  "What time did I pick him up on Tuesday?",
  "When is the next handover?",
  "Did I confirm the school appointment?",
];

export default function ChannelQAPage() {
  const params = useParams();
  const router = useRouter();
  const channelId = params.id as string;
  const { toast } = useToast();
  const currentUser = useAppSelector((state) => state.user.currentUser);
  const isViewer = currentUser?.role === "viewer";

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Viewers are read-only per Doc 2 §12 — Q&A search is a member-only
  // surface (the prompt is scoped to "the user's own messages and rewrites
  // they're permitted to see"; a viewer isn't a participant).
  useEffect(() => {
    if (currentUser && isViewer) {
      router.replace(`/channel/${channelId}`);
    }
  }, [currentUser, isViewer, router, channelId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  if (isViewer) {
    return (
      <ScrollArea className="h-full px-4 sm:px-8 py-6 sm:py-8">
        <Card className="border-primary/10 max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-primary">Access restricted</h2>
              <p className="text-sm text-muted-foreground">
                Q&amp;A search is only available to channel members.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href={`/channel/${channelId}`}>Back to channel</Link>
            </Button>
          </CardContent>
        </Card>
      </ScrollArea>
    );
  }

  const askQuestion = async (question: string) => {
    if (!question.trim() || submitting) return;
    const userTurn: Turn = {
      id: `u-${Date.now()}`,
      role: "user",
      content: question.trim(),
      createdAt: Date.now(),
    };
    setTurns((prev) => [...prev, userTurn]);
    setInput("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channelId, question: question.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data.error as string) || `Request failed (${res.status})`);
      }
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.answer || "No answer.",
          createdAt: Date.now(),
        },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get answer";
      setTurns((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "error",
          content: msg,
          createdAt: Date.now(),
        },
      ]);
      toast({ title: "Q&A failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    askQuestion(input);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-3 py-3 md:px-4 border-b bg-background sticky top-0 z-10">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/channel/${channelId}`}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Search className="w-4 h-4 text-primary" />
          <h1 className="truncate font-semibold text-sm md:text-base">Search this channel</h1>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-6 sm:p-6" ref={scrollRef}>
          {turns.length === 0 ? (
            <div className="space-y-4 py-8">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-2">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h2 className="text-lg font-semibold text-primary">Ask a factual question</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Search the dates, times, and commitments in your delivered messages. Answers are not
                  stored or shared with the other user.
                </p>
              </div>

              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="p-4 flex gap-2 text-xs text-amber-900">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>
                    Q&amp;A is factual lookup only. Questions asking for advice, summaries, behavioural
                    analysis, or the other user&apos;s original wording will be refused.
                  </p>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Try
                </p>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => askQuestion(q)}
                    className="w-full text-left rounded-xl border border-primary/10 hover:border-primary/30 hover:bg-primary/5 transition-colors p-3 text-sm"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-4">
              {turns.map((t) => {
                if (t.role === "user") {
                  return (
                    <div key={t.id} className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary text-white px-4 py-2.5 text-sm">
                        {t.content}
                      </div>
                    </div>
                  );
                }
                if (t.role === "error") {
                  return (
                    <div key={t.id} className="flex justify-start">
                      <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-red-50 border border-red-200 text-red-900 px-4 py-2.5 text-sm">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{t.content}</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={t.id} className="flex justify-start">
                    <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-muted text-foreground px-4 py-2.5 text-sm">
                      {t.content}
                    </div>
                  </div>
                );
              })}
              {submitting && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      <form
        onSubmit={handleSubmit}
        className="sticky bottom-0 border-t bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="max-w-2xl mx-auto flex min-w-0 gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a question about your message history"
            className="flex-1 rounded-full border border-primary/20 bg-white px-4 py-2.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:text-sm"
            disabled={submitting}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || submitting}
            className="rounded-full shrink-0"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}
