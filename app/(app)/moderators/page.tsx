"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppSelector } from "@/hooks/redux";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Pencil, Trash2, Shield, Loader2 } from "lucide-react";
import { AdminModeratorTable, type AdminModerator } from "@/components/admin/AdminModeratorTable";

export default function ModeratorsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAppSelector((state) => state.user);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<AdminModerator | null>(null);
  const [addPhone, setAddPhone] = useState("");
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const fetchModerators = () => {
    setRefreshKey(prev => prev + 1);
  };

  useEffect(() => {
    if (!currentUser) return;
    if (!isAdmin) {
      return;
    }
    fetchModerators();
  }, [currentUser, isAdmin]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim() || !addPhone.trim() || !addEmail.trim() || !addPassword.trim()) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    if (addPassword.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    setAddSubmitting(true);
    try {
      const res = await fetch("/api/admin/moderators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: addName.trim(),
          phone: addPhone.trim(),
          email: addEmail.trim(),
          password: addPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error ?? "Failed to add moderator", variant: "destructive" });
        return;
      }
      toast({
        title: "Moderator created",
        description: `${addName} can log in at /admin/login with their email and the password you set. Share the password with them securely.`,
      });
      setAddOpen(false);
      setAddName("");
      setAddPhone("");
      setAddEmail("");
      setAddPassword("");
      fetchModerators();
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setEditSubmitting(true);
    try {
      const res = await fetch(`/api/admin/moderators/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: editName.trim() || undefined,
          email: editEmail.trim() || undefined,
          password: editPassword.trim() ? editPassword : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error ?? "Failed to update", variant: "destructive" });
        return;
      }
      toast({
        title: "Updated",
        description: editPassword.trim()
          ? "Moderator details updated. Share the new password with them securely."
          : "Moderator details updated.",
      });
      setEditOpen(false);
      setSelected(null);
      setEditPassword("");
      fetchModerators();
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleteSubmitting(true);
    try {
      const res = await fetch(`/api/admin/moderators/${selected.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error ?? "Failed to remove", variant: "destructive" });
        return;
      }
      toast({ title: "Removed", description: "User is no longer a moderator." });
      setDeleteOpen(false);
      setSelected(null);
      fetchModerators();
    } finally {
      setDeleteSubmitting(false);
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

  if (!isAdmin) {
    return (
      <ScrollArea className="h-full px-4 sm:px-8 py-6 sm:py-8">
        <Card className="border-primary/10 max-w-md">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold text-primary mb-2">Access restricted</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Only administrators can manage moderators.
            </p>
            <Button variant="outline" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-6xl mx-auto px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-primary tracking-tight">Moderators</h2>
            <p className="text-sm text-muted-foreground">
              Add, edit, or remove users who can review held messages.
            </p>
          </div>
          <Button
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 flex items-center justify-center gap-2 rounded-full px-6"
            onClick={() => {
              setAddOpen(true);
              setAddName("");
              setAddPhone("");
              setAddEmail("");
              setAddPassword("");
            }}
          >
            <UserPlus className="w-4 h-4" /> Add moderator
          </Button>
        </div>

        <AdminModeratorTable 
          key={refreshKey} 
          onEdit={(m: AdminModerator) => {
            setSelected(m);
            setEditName(m.name ?? "");
            setEditEmail(m.email ?? "");
            setEditPassword("");
            setEditOpen(true);
          }}
          onRemove={(m: AdminModerator) => {
            setSelected(m);
            setDeleteOpen(true);
          }} 
        />
      </div>

      {/* ── Add moderator dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md p-0 overflow-y-auto">
          <div className="bg-gradient-to-br from-primary/8 via-background to-background px-6 pt-6 pb-5 border-b border-primary/8">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2.5 bg-primary/10 rounded-xl">
                  <UserPlus className="w-5 h-5 text-primary" />
                </div>
              </div>
              <DialogTitle className="text-xl font-bold text-left text-foreground">Add moderator</DialogTitle>
              <DialogDescription className="text-left text-sm leading-relaxed mt-1">
                Set an initial email and password. The new moderator signs in at <span className="font-semibold">/admin/login</span>. Share the password with them securely — it isn&apos;t sent over SMS.
              </DialogDescription>
            </DialogHeader>
          </div>
          <form onSubmit={handleAdd} className="px-6 pt-5 pb-6 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">Full name *</label>
              <Input
                placeholder="Jane Smith"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">Phone number *</label>
              <Input
                placeholder="+44 7911 123456"
                value={addPhone}
                onChange={(e) => setAddPhone(e.target.value)}
                required
                className="h-11 font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">Email *</label>
              <Input
                type="email"
                placeholder="moderator@example.com"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">Initial password *</label>
              <Input
                type="password"
                placeholder="At least 8 characters"
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="h-11"
              />
              <p className="text-[11px] text-muted-foreground">
                The moderator can change this themselves after their first sign-in.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Button type="submit" disabled={addSubmitting} className="w-full h-11 rounded-xl font-semibold">
                {addSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add moderator"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} className="w-full h-11 rounded-xl">
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit moderator dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md p-0 overflow-y-auto">
          <div className="bg-gradient-to-br from-primary/8 via-background to-background px-6 pt-6 pb-5 border-b border-primary/8">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2.5 bg-primary/10 rounded-xl">
                  <Pencil className="w-5 h-5 text-primary" />
                </div>
              </div>
              <DialogTitle className="text-xl font-bold text-left text-foreground">Edit moderator</DialogTitle>
              <DialogDescription className="text-left text-sm leading-relaxed mt-1">
                Updating details for <span className="font-semibold text-foreground">{selected?.phone}</span>.
              </DialogDescription>
            </DialogHeader>
          </div>
          <form onSubmit={handleEdit} className="px-6 pt-5 pb-6 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">Full name</label>
              <Input
                placeholder="Full name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">Email</label>
              <Input
                type="email"
                placeholder="email@example.com"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">New password (optional)</label>
              <Input
                type="password"
                placeholder="Leave blank to keep existing"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                className="h-11"
              />
              <p className="text-[11px] text-muted-foreground">
                Setting a new password resets it for this moderator. Share securely.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Button type="submit" disabled={editSubmitting} className="w-full h-11 rounded-xl font-semibold">
                {editSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} className="w-full h-11 rounded-xl">
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete moderator dialog ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm p-0 overflow-y-auto">
          <div className="bg-gradient-to-br from-red-50 via-background to-background px-6 pt-6 pb-5 border-b border-red-100">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2.5 bg-red-100 rounded-xl">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
              </div>
              <DialogTitle className="text-xl font-bold text-left text-foreground">Remove moderator</DialogTitle>
              <DialogDescription className="text-left text-sm leading-relaxed mt-1">
                <span className="font-semibold text-foreground">{selected?.name || selected?.phone}</span> will lose moderator access and become a regular user. This action can be undone by re-adding them.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="px-6 pt-5 pb-6 flex flex-col gap-2">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteSubmitting}
              className="w-full h-11 rounded-xl font-semibold"
            >
              {deleteSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remove moderator"}
            </Button>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} className="w-full h-11 rounded-xl">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}
