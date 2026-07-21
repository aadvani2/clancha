"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  ListChecks,
  ShieldAlert,
  Phone,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/formatDate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppSelector } from "@/hooks/redux";

export interface AdminChannel {
  id: string;
  name: string;
  clanchaNumber: string;
  state: string;
  pictureShareEnabled?: boolean;
  subscriptionExpiry: string | null;
  unsafeMessageCount?: number;
  createdAt: string;
}

const stateLabel: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  view_only: "View-only",
  closed: "Closed",
};

const stateTone: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  trial: "bg-amber-50 text-amber-700 border-amber-200",
  view_only: "bg-orange-50 text-orange-700 border-orange-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};

function pillLabel(ch: AdminChannel): string {
  if (ch.state === "active" && ch.pictureShareEnabled) return "Active + Pics";
  return stateLabel[ch.state] ?? ch.state;
}

function pillTone(ch: AdminChannel): string {
  if (ch.state === "active" && ch.pictureShareEnabled) return "bg-teal-50 text-teal-700 border-teal-200";
  return stateTone[ch.state] ?? stateTone.closed;
}

export function AdminChannelTable() {
  const router = useRouter();
  const currentUser = useAppSelector((state) => state.user.currentUser);
  const isModerator = currentUser?.role === "moderator";
  const isSuperAdmin = currentUser?.role === "super_admin";
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const limit = 10;

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/channels", window.location.origin);
      url.searchParams.set("page", page.toString());
      url.searchParams.set("limit", limit.toString());
      url.searchParams.set("status", status);
      if (search) url.searchParams.set("search", search);

      const res = await fetch(url.toString(), { credentials: "include" });
      const data = await res.json();
      if (res.ok && data.channels) {
        setChannels(data.channels);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error("Failed to fetch admin channels", err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, status, search]);

  useEffect(() => {
    const t = setTimeout(() => fetchChannels(), 300);
    return () => clearTimeout(t);
  }, [fetchChannels]);

  const ActionButton = ({ ch }: { ch: AdminChannel }) => {
    const hasUnsafe = isModerator && (ch.unsafeMessageCount ?? 0) > 0;
    if (isModerator) {
      return (
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive opacity-80 hover:opacity-100 hover:text-destructive relative"
          onClick={() => router.push(`/channel/${ch.id}/queue`)}
          title="Review Queue"
        >
          <ListChecks className="w-4 h-4" />
          {hasUnsafe && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />}
        </Button>
      );
    }
    if (isSuperAdmin) {
      return (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-primary"
          onClick={() => router.push(`/admin/channels/${ch.id}`)}
          title="Channel admin detail"
        >
          <ShieldAlert className="w-4 h-4" />
        </Button>
      );
    }
    return (
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-primary"
        onClick={() => router.push(`/channel/${ch.id}/settings`)}
        title="Edit Settings"
      >
        <Settings className="w-4 h-4" />
      </Button>
    );
  };

  const paginationBar = !loading && totalPages > 1 && (
    <div className="flex flex-col gap-3 px-4 sm:px-6 py-4 border-t border-primary/10 bg-gray-50/50 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between">
      <span className="text-sm text-muted-foreground">
        Page <span className="font-medium text-[#2f4a44]">{page}</span> of{" "}
        <span className="font-medium text-[#2f4a44]">{totalPages}</span>
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="h-10 sm:h-8">
          <ChevronLeft className="w-4 h-4 mr-1" /> Prev
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="h-10 sm:h-8">
          Next <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <div className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-primary/10 shadow-sm min-[420px]:flex-row">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name or number…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 h-10 bg-background"
          />
        </div>
        <Select value={status} onValueChange={(val) => { setStatus(val); setPage(1); }}>
          <SelectTrigger className="h-10 bg-background w-full min-[420px]:w-[130px] shrink-0">
            <SelectValue placeholder="Filter Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active_sms">Active SMS only</SelectItem>
            <SelectItem value="active_picture">Active SMS + Picture</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="view_only">View-only</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading channels…</p>
        </div>
      ) : channels.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">No channels found matching the criteria.</p>
      ) : (
        <>
          {/* ── Mobile card list ── */}
          <div className="flex flex-col gap-3 sm:hidden">
            {channels.map((ch, index) => {
              const hasUnsafe = isModerator && (ch.unsafeMessageCount ?? 0) > 0;
              return (
                <div
                  key={ch.id}
                  className={`rounded-xl border bg-white shadow-sm p-4 space-y-3 ${
                    hasUnsafe ? "border-red-200 bg-red-50" : "border-primary/10"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                        {(page - 1) * limit + index + 1}
                      </span>
                      <p className="font-semibold text-[#2f4a44] truncate">
                        {ch.name !== "-" ? ch.name : "Unnamed"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`whitespace-nowrap inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${pillTone(ch)}`}>
                        {pillLabel(ch)}
                      </span>
                      <ActionButton ch={ch} />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 font-mono">
                      <Phone className="w-3 h-3" /> {ch.clanchaNumber}
                    </span>
                    {ch.subscriptionExpiry && (
                      <span>
                        Renews{" "}
                        {formatDate(ch.subscriptionExpiry)}
                      </span>
                    )}
                    {hasUnsafe && (
                      <span className="flex items-center gap-1 text-red-600 font-semibold">
                        <AlertTriangle className="w-3 h-3" /> {ch.unsafeMessageCount} unsafe
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {paginationBar}
          </div>

          {/* ── Desktop table ── */}
          <div className="hidden sm:block bg-white rounded-xl border border-primary/10 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-primary/5 border-b border-primary/10">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Sr. No</th>
                    <th className="px-6 py-4 font-semibold">Name</th>
                    <th className="px-6 py-4 font-semibold">Channel Number</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 font-semibold">Subscription Expiry</th>
                    {isModerator && <th className="px-6 py-4 font-semibold">Unsafe Messages</th>}
                    <th className="px-6 py-4 font-semibold text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((ch, index) => {
                    const hasUnsafe = isModerator && (ch.unsafeMessageCount ?? 0) > 0;
                    return (
                      <tr key={ch.id} className={`border-b border-primary/5 transition-colors group ${hasUnsafe ? "bg-red-50 hover:bg-red-100" : "hover:bg-primary/5"}`}>
                        <td className="px-6 py-4 text-muted-foreground font-medium">{(page - 1) * limit + index + 1}</td>
                        <td className="px-6 py-4 font-medium text-[#2f4a44]">{ch.name !== "-" ? ch.name : "Unnamed"}</td>
                        <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{ch.clanchaNumber}</td>
                        <td className="px-6 py-4">
                          <span className={`whitespace-nowrap inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full border ${pillTone(ch)}`}>
                            {pillLabel(ch)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">
                          {ch.subscriptionExpiry
                            ? formatDate(ch.subscriptionExpiry)
                            : "N/A"}
                        </td>
                        {isModerator && (
                          <td className="px-6 py-4 font-medium">
                            {hasUnsafe ? (
                              <span className="flex items-center gap-2 text-red-600">
                                <AlertTriangle className="h-4 w-4" /> {ch.unsafeMessageCount}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                        )}
                        <td className="px-6 py-4 text-center">
                          <ActionButton ch={ch} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {paginationBar}
          </div>
        </>
      )}
    </div>
  );
}
