"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Loader2, Trash2, Pencil, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";

export interface AdminModerator {
  id: string;
  phone: string;
  email?: string;
  name?: string;
  role: string;
  createdAt: string;
}

interface AdminModeratorTableProps {
  onEdit: (m: AdminModerator) => void;
  onRemove: (m: AdminModerator) => void;
}

export function AdminModeratorTable({ onEdit, onRemove }: AdminModeratorTableProps) {
  const [moderators, setModerators] = useState<AdminModerator[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const limit = 10;

  const fetchModerators = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/moderators", window.location.origin);
      url.searchParams.set("page", page.toString());
      url.searchParams.set("limit", limit.toString());
      const res = await fetch(url.toString(), { credentials: "include" });
      const data = await res.json();
      if (res.ok && data.data) {
        setModerators(data.data);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error("Failed to fetch admin moderators", err);
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    fetchModerators();
  }, [fetchModerators]);

  const displayName = (m: AdminModerator) =>
    m.name && m.name !== "-" ? m.name : "Unnamed";

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading moderators…</p>
      </div>
    );
  }

  if (moderators.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-10">No moderators found.</p>
    );
  }

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
    <div className="space-y-3">
      {/* ── Mobile card list (hidden on sm+) ── */}
      <div className="flex flex-col gap-3 sm:hidden">
        {moderators.map((m, index) => (
          <div key={m.id} className="rounded-xl border border-primary/10 bg-white shadow-sm p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                  {(page - 1) * limit + index + 1}
                </span>
                <p className="font-semibold text-[#2f4a44] truncate">{displayName(m)}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary" onClick={() => onEdit(m)} title="Edit">
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="text-destructive/70 hover:text-destructive" onClick={() => onRemove(m)} title="Remove">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-start gap-2 text-muted-foreground min-w-0">
                <Phone className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="font-mono text-xs break-all">{formatPhoneForDisplay(m.phone)}</span>
              </div>
              {m.email && m.email !== "-" && (
                <div className="flex items-start gap-2 text-muted-foreground min-w-0">
                  <Mail className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="text-xs break-all">{m.email}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        {paginationBar}
      </div>

      {/* ── Desktop table (hidden on mobile) ── */}
      <div className="hidden sm:block bg-white rounded-xl border border-primary/10 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-primary/5 border-b border-primary/10">
              <tr>
                <th className="px-6 py-4 font-semibold">Sr. No</th>
                <th className="px-6 py-4 font-semibold">Name</th>
                <th className="px-6 py-4 font-semibold">Phone</th>
                <th className="px-6 py-4 font-semibold">Email</th>
                <th className="px-6 py-4 font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {moderators.map((m, index) => (
                <tr key={m.id} className="border-b border-primary/5 hover:bg-primary/5 transition-colors group">
                  <td className="px-6 py-4 text-muted-foreground font-medium">{(page - 1) * limit + index + 1}</td>
                  <td className="px-6 py-4 font-medium text-[#2f4a44]">{displayName(m)}</td>
                  <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{formatPhoneForDisplay(m.phone)}</td>
                  <td className="px-6 py-4 text-muted-foreground">{m.email !== "-" ? m.email : "N/A"}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <Button variant="ghost" size="icon" className="text-muted-foreground opacity-70 group-hover:opacity-100 hover:text-primary transition-all" onClick={() => onEdit(m)} title="Edit Details">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive opacity-70 group-hover:opacity-100 hover:text-destructive transition-all" onClick={() => onRemove(m)} title="Remove Moderator">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {paginationBar}
      </div>
    </div>
  );
}
