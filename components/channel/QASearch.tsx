"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

interface QASearchProps {
  channelId: string;
  disabled?: boolean;
}

export function QASearch({ channelId, disabled = false }: QASearchProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading || disabled) return;

    setIsLoading(true);
    setAnswer(null);

    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channelId, question: trimmedQuestion }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Error",
          description: data.error || "Failed to get answer",
          variant: "destructive",
        });
        return;
      }

      setAnswer(data.answer);
    } catch {
      toast({
        title: "Error",
        description: "Failed to connect to Q&A service",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setQuestion("");
    setAnswer(null);
  };

  return (
    <div className="bg-[#f3eae0] px-4 pb-4">
      <div className="max-w-5xl mx-auto">
        <div 
          className="bg-white/50 backdrop-blur-sm rounded-xl border border-white/40 overflow-hidden transition-all shadow-sm"
        >
          <button
            type="button"
            className="flex min-h-11 w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-white/30"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-primary/80">
              <div className="bg-primary/10 p-1 rounded-md">
                <Search className="w-4 h-4 text-primary" />
              </div>
              Ask about this conversation
            </div>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          {isExpanded && (
            <div className="pt-2 pb-4 px-4 bg-white/40 border-t border-white/40">
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={
                    disabled
                      ? "Q&A is not available for view-only channels"
                      : "Ask a question about the message history..."
                  }
                  disabled={disabled || isLoading}
                  className="min-h-[80px] resize-none border-gray-200 bg-white/80 text-base transition-all focus-visible:ring-primary/20 md:text-sm"
                  rows={2}
                />

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                   <p className="text-[10px] text-muted-foreground leading-tight italic sm:max-w-[60%]">
                    Answers are based only on your permitted message history.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {(question || answer) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleClear}
                        disabled={isLoading}
                        className="h-10 w-full text-xs sm:h-8 sm:w-auto"
                      >
                        Clear
                      </Button>
                    )}
                    <Button
                      type="submit"
                      size="sm"
                      disabled={disabled || isLoading || !question.trim()}
                      className="h-10 w-full shadow-sm sm:h-8 sm:w-auto"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                          Searching...
                        </>
                      ) : (
                        <>
                          <Search className="w-3 h-3 mr-2" />
                          Search AI
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>

              {answer && (
                <div className="mt-4 p-4 bg-white border border-primary/10 rounded-lg shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-primary/70">AI Response</span>
                  </div>
                  <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">{answer}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
