"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAppSelector } from "@/hooks/redux";
import { Menu } from "lucide-react";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { currentUser } = useAppSelector((state) => state.user);

  const rawName = currentUser?.name?.trim() || currentUser?.email?.split("@")[0] || "User";

  const roleLabel =
    currentUser?.role === "super_admin"
      ? "Super Admin"
      : currentUser?.role === "admin"
        ? "Admin"
        : currentUser?.role === "moderator"
          ? "Moderator"
          : currentUser?.role === "viewer"
            ? "Viewer"
            : "User";

  // Avoid the "Super Admin / Super Admin" placeholder render when the seeded
  // user's name happens to match its role label. If the admin hasn't set a real
  // name, show only the role line and let the avatar carry the identity.
  const nameDuplicatesRole =
    rawName.trim().toLowerCase() === roleLabel.trim().toLowerCase();
  const displayName = nameDuplicatesRole ? "" : rawName;

  const initials = (rawName || roleLabel)
    .split(/[ ._]/)
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const settingsHref =
    currentUser?.role === "admin" || currentUser?.role === "super_admin"
      ? "/admin/profile-settings"
      : "/settings";

  return (
    <header className="relative h-[calc(4rem+env(safe-area-inset-top))] lg:h-16 bg-[#f2e8d9]/90 lg:bg-white/80 backdrop-blur-md border-b border-primary/10 flex items-center justify-between px-4 pt-[env(safe-area-inset-top)] lg:pt-0 md:px-6 z-20 sticky top-0 shrink-0 shadow-sm shadow-[#2f4a44]/5">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuClick}
        className="lg:hidden flex h-11 w-11 items-center justify-center rounded-2xl bg-white/70 text-primary shadow-sm ring-1 ring-primary/10 transition-colors hover:bg-white"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile logo — drop `truncate` so the 7-character "Clancha" never
          ellipsis-clips to "Clan…" at narrow widths (Craig M4 tracker #1).
          Reserve 4.5rem on each side so the centred wordmark can never sit
          under the hamburger (left) or the avatar badge (right) at 390px
          (Craig M4 tracker #94 — Header overlap). */}
      <div className="lg:hidden pointer-events-none absolute left-[4.5rem] right-[4.5rem] top-[calc(env(safe-area-inset-top)+2rem)] -translate-y-1/2 text-center">
        <span className="block whitespace-nowrap text-xl font-bold text-[#2f4a44] tracking-tight leading-none">
          Clancha
        </span>
        <span className="block whitespace-nowrap text-[8px] uppercase tracking-[0.16em] font-bold text-muted-foreground mt-1 opacity-70 max-[360px]:hidden">
          Clarity, Not Chaos
        </span>
      </div>

      {/* Right side: user info — links to the user's own Settings/profile
          (Craig M4 tracker #94b). z-10 keeps it above the centred wordmark. */}
      <Link
        href={settingsHref}
        aria-label="Your settings"
        className="relative z-10 flex items-center gap-3 ml-auto rounded-2xl transition-colors hover:opacity-90"
      >
        <div className="text-right hidden sm:block">
          {displayName && (
            <p className="text-sm font-bold leading-tight">{displayName}</p>
          )}
          <p className="text-[10px] text-muted-foreground font-medium">{roleLabel}</p>
        </div>
        <Avatar className="h-11 w-11 lg:h-9 lg:w-9 border-2 border-white lg:border-primary/20 shadow-sm">
          <AvatarImage src={currentUser?.profileImageUrl || undefined} />
          <AvatarFallback className="text-sm font-semibold bg-primary/10 text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
      </Link>
    </header>
  );
}
