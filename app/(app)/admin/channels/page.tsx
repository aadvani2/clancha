"use client";

import { AdminChannelTable } from "@/components/admin/AdminChannelTable";
import { MessageSquare } from "lucide-react";

export default function AdminChannelsPage() {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-6xl mx-auto px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 lg:px-8 space-y-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-primary tracking-tight flex items-center gap-2">
            <MessageSquare className="w-6 h-6" /> Channels
          </h2>
          <p className="text-sm text-muted-foreground">
            All channels across the platform.
          </p>
        </div>
        <AdminChannelTable />
      </div>
    </div>
  );
}
