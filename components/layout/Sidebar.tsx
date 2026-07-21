"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { logout } from "@/store/authSlice";
import {
  Home,
  Users,
  MessageSquare,
  BarChart3,
  Settings,
  LogOut,
  ClipboardList,
  FileText,
  ImageOff,
  X,
  SlidersHorizontal,
  ShieldAlert,
  HelpCircle,
} from "lucide-react";
import { clearUser } from "@/store/userSlice";
import { deleteCookie } from "@/lib/utils/cookies";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { currentUser } = useAppSelector((state) => state.user);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "super_admin";
  const isModerator = currentUser?.role === "moderator";
  const isUser = !isPrivileged && !isModerator;
  const canPendingReview = isPrivileged || isModerator;

  const sidebarItems = [
    ...(isUser ? [{ icon: <Home className="w-5 h-5" />, label: "Overview", href: "/dashboard" }] : []),
    // Full plain-English service guide (Craig, M4 feedback 05/07/26 §2.3) —
    // users and viewers only; staff roles know the product.
    ...(isUser
      ? [{ icon: <HelpCircle className="w-5 h-5" />, label: "How Clancha works", href: "/how-it-works" }]
      : []),
    ...(isPrivileged ? [{ icon: <Users className="w-5 h-5" />, label: "Users", href: "/admin/users" }] : []),
    ...(isPrivileged ? [{ icon: <Users className="w-5 h-5" />, label: "Moderators", href: "/admin/moderators" }] : []),
    ...(isPrivileged
      ? [{ icon: <ClipboardList className="w-5 h-5" />, label: "Pending Review", href: "/admin/pending-review" }]
      : isModerator
      ? [{ icon: <ClipboardList className="w-5 h-5" />, label: "Pending Review", href: "/pending-review" }]
      : []),
    ...(isPrivileged
      ? [{ icon: <MessageSquare className="w-5 h-5" />, label: "Channels", href: "/admin/channels" }]
      : isModerator
      ? [{ icon: <MessageSquare className="w-5 h-5" />, label: "Channels", href: "/dashboard" }]
      : []),
    ...(isPrivileged ? [{ icon: <FileText className="w-5 h-5" />, label: "AI Prompts", href: "/admin/prompts" }] : []),
    ...(isPrivileged ? [{ icon: <ImageOff className="w-5 h-5" />, label: "Denied Images", href: "/admin/denied-images" }] : []),
    ...(isPrivileged ? [{ icon: <ShieldAlert className="w-5 h-5" />, label: "Failures", href: "/admin/failures" }] : []),
    ...(isPrivileged ? [{ icon: <SlidersHorizontal className="w-5 h-5" />, label: "Admin Settings", href: "/admin/settings" }] : []),
    { icon: <BarChart3 className="w-5 h-5" />, label: "Activity", href: isPrivileged ? "/admin/activity" : "/activity" },
    { icon: <Settings className="w-5 h-5" />, label: "Settings", href: isPrivileged ? "/admin/profile-settings" : "/settings" },
  ];

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout API failed", error);
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    deleteCookie("token");
    deleteCookie("user_data");
    dispatch(logout());
    dispatch(clearUser());
    window.location.href = "/login";
  };

  const handleNav = (href: string) => {
    router.push(href);
    onClose();
  };

  const navContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between p-6 pb-4 pt-[max(1.5rem,env(safe-area-inset-top))] lg:pt-6">
        <div>
          <h1 className="text-2xl font-black text-primary italic tracking-tight">Clancha</h1>
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground mt-0.5 opacity-60">
            Clarity, Not Chaos
          </p>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={onClose}
          className="lg:hidden flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground hover:bg-primary/5 hover:text-primary transition-colors"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto">
        {sidebarItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <button
              key={item.label}
              onClick={() => handleNav(item.href)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all font-medium text-sm ${
                isActive
                  ? "bg-primary text-white shadow-lg shadow-primary/20"
                  : "text-muted-foreground hover:bg-primary/5 hover:text-primary"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-primary/5">
        <button
          onClick={async () => {
            const ok = await confirm({
              title: "Log out?",
              description: "You will be returned to the login screen.",
              confirmLabel: "Log out",
              variant: "destructive",
            });
            if (ok) handleLogout();
          }}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-muted-foreground hover:text-destructive transition-colors font-medium text-sm rounded-2xl hover:bg-destructive/5"
        >
          <LogOut className="w-5 h-5" />
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {confirmDialog}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 flex-col bg-white border-r border-primary/10 shadow-sm z-30 h-screen sticky top-0 shrink-0">
        {navContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Drawer */}
          <aside className="relative w-72 max-w-[85vw] bg-white h-full shadow-2xl flex flex-col rounded-r-[2rem] animate-in slide-in-from-left duration-300">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
