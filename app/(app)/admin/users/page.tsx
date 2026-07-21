"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppSelector } from "@/hooks/redux";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";
import { formatDate } from "@/lib/utils/formatDate";

const STAFF_ROLES = ["admin", "super_admin", "moderator"];

interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  channelCount: number;
  createdAt: string;
}

const roleLabel: Record<string, string> = {
  user: "User",
  viewer: "Viewer",
  moderator: "Moderator",
  admin: "Admin",
  super_admin: "Super Admin",
};

const roleTone: Record<string, string> = {
  user: "bg-emerald-50 text-emerald-700 border-emerald-200",
  viewer: "bg-sky-50 text-sky-700 border-sky-200",
  moderator: "bg-amber-50 text-amber-700 border-amber-200",
  admin: "bg-violet-50 text-violet-700 border-violet-200",
  super_admin: "bg-violet-100 text-violet-800 border-violet-300",
};

export default function AdminUsersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAppSelector((state) => state.user);
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [role, setRole] = useState("all");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog();

  const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "super_admin";
  const isSuperAdmin = currentUser?.role === "super_admin";
  const canDelete = (u: AdminUser) => isSuperAdmin && !STAFF_ROLES.includes(u.role);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/users", window.location.origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", "20");
      url.searchParams.set("role", role);
      if (search.trim()) url.searchParams.set("search", search.trim());
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      setItems(data.items || []);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [page, role, search, toast]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isPrivileged) {
      router.replace("/dashboard");
      return;
    }
    fetchUsers();
  }, [currentUser, isPrivileged, router, fetchUsers]);

  const handleDeleteUser = async (u: AdminUser) => {
    const label = u.name?.trim() || formatPhoneForDisplay(u.phone) || "this user";
    const ok = await confirmDialog({
      title: "Delete this test user?",
      description: `Permanently delete ${label} and all their channels, messages and billing, and remove their Stripe test customer. This frees their number for a fresh sign-up and cannot be undone.`,
      confirmLabel: "Delete user",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error as string) || `Delete failed (${res.status})`);
      toast({
        title: "User deleted",
        description: `${label} removed — number freed for re-use.`,
      });
      setItems((prev) => prev.filter((x) => x.id !== u.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      toast({
        title: "Failed to delete",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (!currentUser) {
    return (
      <ScrollArea className="h-full px-4 sm:px-8 py-6 sm:py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ScrollArea>
    );
  }
  if (!isPrivileged) return null;

  return (
    <ScrollArea className="h-full">
      {confirmDialogNode}
      <div className="max-w-6xl mx-auto px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <h2 className="text-2xl font-bold text-primary tracking-tight">Users</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              All accounts across the platform — users, viewers, moderators, and admins.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => fetchUsers()}
            disabled={loading}
            className="h-10 rounded-2xl"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search name, email, or phone…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9 h-10 bg-background"
            />
          </div>
          <Select
            value={role}
            onValueChange={(v) => {
              setRole(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-10 bg-background w-full sm:w-[180px] shrink-0">
              <SelectValue placeholder="Filter role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="moderator">Moderator</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="super_admin">Super Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading users…</p>
          </div>
        ) : items.length === 0 ? (
          <Card className="border-primary/10">
            <CardContent className="py-12 flex items-center justify-center text-sm text-muted-foreground">
              No users match the current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Showing {items.length} of {total} user{total === 1 ? "" : "s"}.
            </p>

            {/* Mobile cards */}
            <div className="flex flex-col gap-3 sm:hidden">
              {items.map((u) => (
                <div key={u.id} className="rounded-xl border border-primary/10 bg-white shadow-sm p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#2f4a44] truncate">{u.name?.trim() || "Unnamed"}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`whitespace-nowrap inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${roleTone[u.role] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}
                      >
                        {roleLabel[u.role] ?? u.role}
                      </span>
                      {canDelete(u) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u)}
                          disabled={deletingId === u.id}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                          aria-label={`Delete ${u.name?.trim() || u.phone}`}
                          title="Delete test user"
                        >
                          {deletingId === u.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-start gap-2">
                      <Mail className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="break-all">{u.email ?? "—"}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Phone className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="font-mono">{formatPhoneForDisplay(u.phone)}</span>
                    </div>
                    <p>
                      Channels: <span className="font-semibold">{u.channelCount}</span>
                      <span className="mx-2">·</span>
                      Joined {formatDate(u.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block bg-white rounded-xl border border-primary/10 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground uppercase bg-primary/5 border-b border-primary/10">
                    <tr>
                      <th className="px-6 py-4 font-semibold">Name</th>
                      <th className="px-6 py-4 font-semibold">Email</th>
                      <th className="px-6 py-4 font-semibold">Phone</th>
                      <th className="px-6 py-4 font-semibold">Role</th>
                      <th className="px-6 py-4 font-semibold text-right">Channels</th>
                      <th className="px-6 py-4 font-semibold">Joined</th>
                      {isSuperAdmin && <th className="px-6 py-4 font-semibold text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((u) => (
                      <tr key={u.id} className="border-b border-primary/5 hover:bg-primary/5 transition-colors">
                        <td className="px-6 py-4 font-medium text-[#2f4a44]">
                          {u.name?.trim() || <span className="text-muted-foreground italic">Unnamed</span>}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">
                          {u.email ?? <span className="italic">—</span>}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                          {formatPhoneForDisplay(u.phone)}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`whitespace-nowrap inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full border ${roleTone[u.role] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}
                          >
                            {roleLabel[u.role] ?? u.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-semibold text-[#2f4a44]">{u.channelCount}</td>
                        <td className="px-6 py-4 text-muted-foreground">{formatDate(u.createdAt)}</td>
                        {isSuperAdmin && (
                          <td className="px-6 py-4 text-right">
                            {canDelete(u) ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u)}
                                disabled={deletingId === u.id}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                                aria-label={`Delete ${u.name?.trim() || u.phone}`}
                                title="Delete test user"
                              >
                                {deletingId === u.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex flex-col gap-3 px-4 sm:px-6 py-4 border-t border-primary/10 bg-gray-50/50 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between rounded-xl bg-white border">
                <span className="text-sm text-muted-foreground">
                  Page <span className="font-medium text-[#2f4a44]">{page}</span> of{" "}
                  <span className="font-medium text-[#2f4a44]">{totalPages}</span>
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                  </Button>
                  <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    Next <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}
