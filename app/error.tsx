"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, Home, MessageSquare } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#f8f5f0] flex flex-col items-center justify-center p-6 text-center">
      {/* Brand */}
      <div className="flex items-center gap-2.5 mb-16">
        <div className="w-10 h-10 rounded-xl bg-[#2f4a44] flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
        <div className="text-left">
          <p className="text-xl font-black text-[#2f4a44] italic tracking-tight leading-none">Clancha</p>
          <p className="text-[9px] uppercase tracking-[0.22em] font-bold text-[#2f4a44]/40 mt-0.5">
            Clarity, Not Chaos
          </p>
        </div>
      </div>

      {/* Illustration */}
      <div className="relative mb-6 select-none">
        <p className="text-[110px] sm:text-[140px] font-black text-[#2f4a44]/8 leading-none">
          500
        </p>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-2xl bg-red-500/8 flex items-center justify-center">
            <RefreshCw className="w-9 h-9 text-red-400/50" />
          </div>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-[#2f4a44] mb-2">Something went wrong</h1>
      <p className="text-sm text-[#2f4a44]/55 max-w-xs mx-auto leading-relaxed mb-2">
        An unexpected error occurred on our end. You can try again or head back to the dashboard.
      </p>
      {error.digest && (
        <p className="text-[11px] font-mono text-[#2f4a44]/25 mb-8">ref: {error.digest}</p>
      )}
      {!error.digest && <div className="mb-8" />}

      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#2f4a44] text-white text-sm font-semibold hover:bg-[#2f4a44]/90 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-[#2f4a44]/20 text-[#2f4a44] text-sm font-semibold hover:bg-[#2f4a44]/5 transition-colors"
        >
          <Home className="w-4 h-4" />
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
