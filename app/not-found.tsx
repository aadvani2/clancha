import Link from "next/link";
import { Home, MessageSquare } from "lucide-react";

export default function NotFound() {
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
          404
        </p>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-2xl bg-[#2f4a44]/8 flex items-center justify-center">
            <MessageSquare className="w-9 h-9 text-[#2f4a44]/30" />
          </div>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-[#2f4a44] mb-2">Page not found</h1>
      <p className="text-sm text-[#2f4a44]/55 max-w-xs mx-auto leading-relaxed mb-10">
        The page you&apos;re looking for doesn&apos;t exist or may have been moved.
      </p>

      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#2f4a44] text-white text-sm font-semibold hover:bg-[#2f4a44]/90 transition-colors"
      >
        <Home className="w-4 h-4" />
        Go to dashboard
      </Link>
    </div>
  );
}
