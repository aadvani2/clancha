"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils/formatDate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAppSelector } from "@/hooks/redux";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FileText, History, RotateCcw, Save } from "lucide-react";

interface PromptSummary {
  key: string;
  version: number;
  body: string;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name?: string; email?: string; phone?: string } | null;
  changeNote: string | null;
}

interface PromptVersionEntry {
  id: string;
  version: number;
  body: string;
  changeNote: string | null;
  rolledBackFromVersion: number | null;
  createdAt: string;
  createdBy: { id: string; name?: string; email?: string; phone?: string } | null;
}

// Prompt keys whose prompt is not active in the live message pipeline. These
// get a clear "Disabled" badge on the card so an admin doesn't assume an edit
// here takes effect (Craig M4 tracker #94e). The classifier prompt is kept for
// future use but is currently disabled in the pipeline.
const DISABLED_KEYS = new Set<string>(["classify_system"]);

const KEY_LABELS: Record<string, { title: string; description: string }> = {
  rewrite_system: {
    title: "Rewrite system prompt",
    description:
      "Master prompt that frames every message rewrite. Must contain the {{TONE_INSTRUCTION}} token where the per-channel tone is injected.",
  },
  tone_calm_clear: {
    title: "Tone — Calm & Clear",
    description: "Tone instruction injected into the rewrite prompt for users on Calm & Clear.",
  },
  tone_firm_fair: {
    title: "Tone — Firm & Fair",
    description: "Tone instruction injected into the rewrite prompt for users on Firm & Fair.",
  },
  classify_system: {
    title: "Message classifier prompt",
    description:
      "Classifier that flags messages as safe / unsafe / uncertain. Currently disabled in the pipeline — kept here for future use.",
  },
  image_moderate_system: {
    title: "Image moderation prompt",
    description: "Vision model prompt that screens uploaded images before human review.",
  },
  qa_system: {
    title: "Q&A search prompt",
    description:
      "Factual-lookup prompt used by the in-portal Q&A search. Strict scope: dates / times / commitments from the user's permitted message history. Must refuse summaries, behavioural analysis, advice, and any request for the other user's original wording.",
  },
};

function formatDate(iso: string | null) {
  return formatDateTime(iso, "Never edited");
}

function actorLabel(u: PromptSummary["updatedBy"] | PromptVersionEntry["createdBy"]) {
  if (!u) return "—";
  return u.name || u.email || u.phone || "Unknown";
}

export default function AdminPromptsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAppSelector((state) => state.user);
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editChangeNote, setEditChangeNote] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [historyVersions, setHistoryVersions] = useState<PromptVersionEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<PromptVersionEntry | null>(null);
  const [rollbackNote, setRollbackNote] = useState("");
  const [rollbackSubmitting, setRollbackSubmitting] = useState(false);

  const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/prompts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load prompts");
      const data = await res.json();
      setPrompts(data.prompts || []);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to load", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isPrivileged) { router.replace("/dashboard"); return; }
    fetchPrompts();
  }, [currentUser, isPrivileged, router, fetchPrompts]);

  const openEdit = (p: PromptSummary) => { setEditKey(p.key); setEditBody(p.body); setEditChangeNote(""); };
  const closeEdit = () => { setEditKey(null); setEditBody(""); setEditChangeNote(""); };

  const handleSave = async () => {
    if (!editKey) return;
    if (!editChangeNote.trim()) {
      toast({ title: "Change note required", description: "Briefly describe what changed and why.", variant: "destructive" });
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/prompts/${editKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body: editBody, changeNote: editChangeNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast({ title: "Prompt updated", description: `New version v${data.version} is now active.` });
      closeEdit();
      fetchPrompts();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const openHistory = async (key: string) => {
    setHistoryKey(key);
    setHistoryLoading(true);
    setHistoryVersions([]);
    try {
      const res = await fetch(`/api/admin/prompts/${key}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load history");
      const data = await res.json();
      setHistoryVersions(data.versions || []);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to load", variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeHistory = () => { setHistoryKey(null); setHistoryVersions([]); };

  const handleRollback = async () => {
    if (!rollbackTarget || !historyKey) return;
    if (!rollbackNote.trim()) {
      toast({ title: "Reason required", description: "Briefly note why you're rolling back.", variant: "destructive" });
      return;
    }
    setRollbackSubmitting(true);
    try {
      const res = await fetch(`/api/admin/prompts/${historyKey}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetVersion: rollbackTarget.version, changeNote: rollbackNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rollback failed");
      toast({ title: "Rolled back", description: `Restored v${rollbackTarget.version} as new v${data.version}.` });
      setRollbackTarget(null);
      setRollbackNote("");
      closeHistory();
      fetchPrompts();
    } catch (err) {
      toast({ title: "Rollback failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setRollbackSubmitting(false);
    }
  };

  if (!currentUser || !isPrivileged) return null;

  return (
    <ScrollArea className="h-full">
      <div className="max-w-4xl mx-auto px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-10 space-y-5">
        {/* Page header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center bg-primary/10 shrink-0 mt-0.5">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: "#2F4A44" }}>
              AI Prompt Management
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Edit the system prompts used by the rewrite, classifier, and image moderator. Every
              change creates a new version with a note and actor; rollbacks are logged the same way.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            {prompts.map((p) => {
              const meta = KEY_LABELS[p.key] ?? { title: p.key, description: "" };
              const isDisabled = DISABLED_KEYS.has(p.key);
              return (
                <div
                  key={p.key}
                  className={`rounded-2xl border shadow-sm overflow-hidden ${isDisabled ? "border-amber-200 bg-amber-50/40 opacity-70" : "border-primary/10 bg-card"}`}
                >
                  {/* Card header — stacks on mobile, row on sm+ */}
                  <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      {/* Left: title + badges + description */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="text-sm font-bold text-foreground">{meta.title}</h3>
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">v{p.version}</Badge>
                          {p.isDefault && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0">default</Badge>
                          )}
                          {DISABLED_KEYS.has(p.key) && (
                            <Badge
                              variant="outline"
                              className="text-xs px-1.5 py-0 text-amber-700 border-amber-300 bg-amber-50"
                            >
                              Disabled in pipeline
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{meta.description}</p>
                      </div>
                      {/* Right: action buttons — full-width on mobile */}
                      <div className="flex gap-2 sm:shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-10 flex-1 text-xs sm:h-8 sm:flex-none"
                          onClick={() => openHistory(p.key)}
                        >
                          <History className="w-3.5 h-3.5 mr-1" /> History
                        </Button>
                        <Button
                          size="sm"
                          className="h-10 flex-1 text-xs sm:h-8 sm:flex-none"
                          onClick={() => openEdit(p)}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      Last edited: {formatDate(p.updatedAt)} · {actorLabel(p.updatedBy)}
                      {p.changeNote && (
                        <span className="italic"> — &ldquo;{p.changeNote}&rdquo;</span>
                      )}
                    </p>
                    <pre className={`text-xs whitespace-pre-wrap font-mono p-3 rounded-xl bg-muted/50 border border-primary/8 max-h-28 overflow-hidden text-muted-foreground leading-relaxed${isDisabled ? " opacity-40 select-none pointer-events-none" : ""}`}>
                      {p.body.length > 280 ? `${p.body.slice(0, 280)}…` : p.body}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editKey} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-0">
          <div className="p-5 sm:p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg font-bold text-left">
                {editKey && KEY_LABELS[editKey]?.title}
              </DialogTitle>
              <DialogDescription className="text-left text-sm">
                Saving creates a new version. Provide a short change note describing what and why.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="min-h-[200px] resize-none font-mono text-base sm:min-h-[280px] md:text-xs"
            />
            <Input
              placeholder="Change note (required) — e.g. 'softened tone'"
              value={editChangeNote}
              onChange={(e) => setEditChangeNote(e.target.value)}
            />
            {/* Footer */}
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={handleSave} disabled={editSaving} className="w-full h-11">
                {editSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <><Save className="w-4 h-4 mr-1.5" /> Save new version</>
                )}
              </Button>
              <Button variant="outline" onClick={closeEdit} disabled={editSaving} className="w-full h-11">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── History dialog ── */}
      <Dialog open={!!historyKey} onOpenChange={(open) => !open && closeHistory()}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-0">
          <div className="p-5 sm:p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg font-bold text-left">
                {historyKey && KEY_LABELS[historyKey]?.title} — version history
              </DialogTitle>
              <DialogDescription className="text-left text-sm">
                Every edit creates a new version. You can roll back to any previous version; the
                rollback itself becomes a new version with a note.
              </DialogDescription>
            </DialogHeader>

            {historyLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : historyVersions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No saved versions yet. The active prompt is the hard-coded default.
              </p>
            ) : (
              <div className="space-y-3">
                {historyVersions.map((v, idx) => {
                  const isLatest = idx === 0;
                  return (
                    <div key={v.id} className="rounded-xl border border-primary/10 p-3 sm:p-4 space-y-2 bg-card">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={isLatest ? "default" : "secondary"}>v{v.version}</Badge>
                          {isLatest && <span className="text-xs text-primary font-semibold">active</span>}
                          {v.rolledBackFromVersion && (
                            <Badge variant="outline" className="text-xs">rollback of v{v.rolledBackFromVersion}</Badge>
                          )}
                        </div>
                        {!isLatest && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 text-xs sm:h-7"
                            onClick={() => { setRollbackTarget(v); setRollbackNote(""); }}
                          >
                            <RotateCcw className="w-3 h-3 mr-1" /> Rollback
                          </Button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDate(v.createdAt)} · {actorLabel(v.createdBy)}
                      </p>
                      {v.changeNote && (
                        <p className="text-xs italic text-muted-foreground">&ldquo;{v.changeNote}&rdquo;</p>
                      )}
                      <pre className="text-[11px] whitespace-pre-wrap font-mono p-2 rounded-lg bg-muted/50 max-h-28 overflow-auto border border-primary/8">
                        {v.body.length > 400 ? `${v.body.slice(0, 400)}…` : v.body}
                      </pre>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Rollback confirm dialog ── */}
      <Dialog
        open={!!rollbackTarget}
        onOpenChange={(open) => { if (!open) { setRollbackTarget(null); setRollbackNote(""); } }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl p-0">
          <div className="p-5 sm:p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-left">
                Roll back to v{rollbackTarget?.version}?
              </DialogTitle>
              <DialogDescription className="text-left text-sm">
                This creates a new version with the body from v{rollbackTarget?.version}. Both the
                old and new versions remain in history.
              </DialogDescription>
            </DialogHeader>
            <Input
              placeholder="Reason for rollback (required)"
              value={rollbackNote}
              onChange={(e) => setRollbackNote(e.target.value)}
            />
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={handleRollback} disabled={rollbackSubmitting} className="w-full h-11">
                {rollbackSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm rollback"}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setRollbackTarget(null); setRollbackNote(""); }}
                disabled={rollbackSubmitting}
                className="w-full h-11"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}
