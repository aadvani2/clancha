"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppSelector } from "@/hooks/redux";

/** Legacy URL: in-app moderation lives at `/pending-review`. */
export default function ModeratorPage() {
  const router = useRouter();
  const { currentUser } = useAppSelector((state) => state.user);

  useEffect(() => {
    if (!currentUser) return;
    if (["moderator", "admin", "super_admin"].includes(currentUser.role)) {
      router.replace("/pending-review");
    } else {
      router.replace("/dashboard");
    }
  }, [currentUser, router]);

  return (
    <div className="p-8 text-muted-foreground text-sm">Redirecting…</div>
  );
}
