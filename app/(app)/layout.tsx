"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAppSelector, useAppDispatch } from "@/hooks/redux";
import { setUser, clearUser } from "@/store/userSlice";
import { loginSuccess, logout } from "@/store/authSlice";
import { Loader2, Sparkles } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAppSelector((state) => state.auth);
  const { currentUser } = useAppSelector((state) => state.user);
  const dispatch = useAppDispatch();
  const [initialLoading, setInitialLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

    if (!currentUser) {
      if (!isAuthenticated) {
        if (token) {
          dispatch(loginSuccess({ token }));
        }
      }

      fetch("/api/users/me", { credentials: "include" })
        .then((res) => res.json())
        .then((data) => {
          if (data.id) {
            const userToStore = {
              id: data.id,
              email: data.email,
              role: data.role,
              phone: data.phone,
              name: data.name,
              profileImageUrl: data.profileImageUrl,
              maxChannels: 5,
              isSubscribed: data.isSubscribed,
              isPictureAddonEnabled: data.isPictureAddonEnabled,
              subscriptionQuantity: data.subscriptionQuantity,
            };
            dispatch(setUser(userToStore));
            localStorage.setItem("user", JSON.stringify(userToStore));
          } else {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            dispatch(logout());
            dispatch(clearUser());
            router.push("/login");
          }
        })
        .catch(() => {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          dispatch(logout());
          dispatch(clearUser());
          router.push("/login");
        })
        .finally(() => {
          setInitialLoading(false);
        });
    } else {
      setInitialLoading(false);
    }
  }, [currentUser, isAuthenticated, dispatch, router, pathname]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (initialLoading) {
    return (
      <div className="flex h-[100dvh] min-h-[100svh] w-full items-center justify-center bg-[#f8f5f0] flex-col gap-4">
        <div className="relative">
          <Loader2 className="h-12 w-12 animate-spin text-primary opacity-20" />
          <Sparkles className="h-6 w-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
        </div>
        <div className="flex flex-col items-center">
          <h2 className="text-xl font-black text-primary italic tracking-tight">Clancha</h2>
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground mt-1 opacity-60">
            Synchronising your world
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-[100svh] bg-background text-foreground overflow-hidden">
      <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex h-full min-h-0 flex-1 min-w-0 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="min-h-0 flex-1 overflow-hidden bg-[#f7f1e8] lg:bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
