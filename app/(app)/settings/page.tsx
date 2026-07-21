"use client";

import { useState, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAppSelector, useAppDispatch } from "@/hooks/redux";
import { setUser } from "@/store/userSlice";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Camera } from "lucide-react";
import { BillingCard } from "@/components/billing/BillingCard";
import { AvatarCropDialog } from "@/components/profile/AvatarCropDialog";

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { currentUser } = useAppSelector((state) => state.user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [receivingHoursStart, setReceivingHoursStart] = useState("");
  const [receivingHoursEnd, setReceivingHoursEnd] = useState("");
  // Timezone is fixed to United Kingdom for v1 per spec — no UI to change it.
  const timezone = "Europe/London";
  const [receivingHoursEnabled, setReceivingHoursEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const profileRes = await fetch("/api/users/profile");
        const data = await profileRes.json();
        if (profileRes.ok) {
          setName(data.name ?? "");
          setEmail(data.email ?? "");
          setProfileImageUrl(data.profileImageUrl ?? "");
          setReceivingHoursStart(data.receivingHoursStart ?? "");
          setReceivingHoursEnd(data.receivingHoursEnd ?? "");
          // Treat receiving hours as enabled if either bound is set on load.
          setReceivingHoursEnabled(
            !!(data.receivingHoursStart || data.receivingHoursEnd)
          );
          dispatch(setUser({ ...currentUser!, ...data }));
        }
      } catch (err) {
        console.error("Failed to fetch profile", err);
      } finally {
        setInitialLoading(false);
      }
    };
    fetchProfile();
  }, [dispatch]);

  // Profile photo upload from device — opens the crop dialog rather than
  // uploading immediately. The dialog hands back a 512x512 JPEG Blob via
  // handleCroppedUpload below.
  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum 5 MB.", variant: "destructive" });
      return;
    }
    setPendingCropFile(file);
    setCropOpen(true);
  };

  const handleCroppedUpload = async (blob: Blob) => {
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, "avatar.jpg");
      const res = await fetch("/api/users/upload-avatar", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setProfileImageUrl(data.profileImageUrl);
      dispatch(setUser({ ...currentUser!, profileImageUrl: data.profileImageUrl }));
      toast({ title: "Photo updated", description: "Your profile photo has been saved." });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
      throw err;
    } finally {
      setAvatarUploading(false);
      setPendingCropFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // When receiving hours are toggled off, send null bounds so the server
      // treats the user as always-receiving.
      const startToSend = receivingHoursEnabled && receivingHoursStart ? receivingHoursStart : null;
      const endToSend = receivingHoursEnabled && receivingHoursEnd ? receivingHoursEnd : null;
      const res = await fetch("/api/users/update-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          profileImageUrl: profileImageUrl.trim() || undefined,
          receivingHoursStart: startToSend,
          receivingHoursEnd: endToSend,
          timezone,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error ?? "Failed to update profile", variant: "destructive" });
        return;
      }
      const updated = {
        id: data.id,
        email: data.email ?? "",
        role: data.role,
        name: data.name ?? "",
        phone: data.phone,
        profileImageUrl: data.profileImageUrl ?? "",
        maxChannels: currentUser?.maxChannels ?? 5,
        isSubscribed: currentUser?.isSubscribed ?? false,
        isPictureAddonEnabled: currentUser?.isPictureAddonEnabled ?? false,
        subscriptionQuantity: currentUser?.subscriptionQuantity ?? 0,
        receivingHoursStart: data.receivingHoursStart,
        receivingHoursEnd: data.receivingHoursEnd,
        timezone: data.timezone,
      };
      dispatch(setUser(updated));
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("user");
        if (stored) {
          localStorage.setItem("user", JSON.stringify({ ...JSON.parse(stored), ...updated }));
        }
      }
      // Pick the most specific toast for what actually changed. If the user
      // adjusted receiving hours alongside profile fields, prefer the hours
      // toast — Craig flagged that the generic one was confusing.
      const hoursChanged =
        (currentUser?.receivingHoursStart ?? null) !== (startToSend ?? null) ||
        (currentUser?.receivingHoursEnd ?? null) !== (endToSend ?? null);
      toast(
        hoursChanged
          ? { title: "Receiving hours updated", description: "Your changes have been saved." }
          : { title: "Profile updated", description: "Your changes have been saved." }
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match.", variant: "destructive" });
      return;
    }
    setPasswordLoading(true);
    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error ?? "Failed to change password", variant: "destructive" });
        return;
      }
      toast({ title: "Success", description: "Your password has been changed." });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch {
      toast({ title: "Error", description: "Something went wrong.", variant: "destructive" });
    } finally {
      setPasswordLoading(false);
    }
  };

  const displayName = name.trim() || currentUser?.email?.split("@")[0] || "User";
  const initials = displayName.split(/[ ._]/).map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  if (!currentUser || initialLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-xl mx-auto px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 space-y-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-primary tracking-tight">Settings</h2>
          <p className="text-sm text-muted-foreground">Manage your profile and account details.</p>
        </div>

        {/* Profile card */}
        <Card className="border-primary/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" /> Profile
            </CardTitle>
            <CardDescription>Update your name, email, and profile photo.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Avatar upload */}
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                <div className="relative shrink-0">
                  {/* AvatarImage from Radix preserves aspect ratio by default
                     (object-fit:cover). We anchor at h-24 w-24 (square) so any
                     non-square upload is centre-cropped, never stretched. */}
                  <Avatar className="h-24 w-24 border-2 border-primary/20">
                    <AvatarImage
                      src={profileImageUrl.trim() || undefined}
                      className="object-cover"
                    />
                    <AvatarFallback className="text-2xl bg-primary/10 text-primary">{initials}</AvatarFallback>
                  </Avatar>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarUploading}
                    aria-label="Upload profile photo"
                    className="absolute -bottom-1 -right-1 p-2.5 rounded-full bg-primary text-white shadow-md hover:bg-primary/90 transition-colors disabled:opacity-60"
                    title="Upload photo from device"
                  >
                    {avatarUploading
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Camera className="w-4 h-4" />}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={handleAvatarFile}
                  />
                </div>
                <div className="flex-1 w-full space-y-1">
                  <p className="text-sm font-medium">Profile photo</p>
                  <p className="text-xs text-muted-foreground">
                    Tap the camera icon to choose a photo. You can drag and zoom to crop the square area that's saved.
                  </p>
                </div>
              </div>

              {/* Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              {/* Email */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                <p className="text-xs text-muted-foreground">Used for account recovery and notifications.</p>
              </div>

              {/* Phone (read-only) */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Phone (cannot be changed)</p>
                <Input value={currentUser.phone ?? ""} disabled className="bg-muted" />
              </div>

              {/* Receiving hours — only channel participants (regular users)
                  receive SMS, so admins / moderators / viewers shouldn't see
                  this toggle. Per Craig 2026-05-22 it bled in from the user
                  settings template. */}
              {currentUser?.role === "user" && (
                <div className="space-y-4 pt-4 border-t border-primary/10">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold">Message receiving hours</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Restrict the times of day you receive messages on this account.
                      </p>
                    </div>
                    {/* A button[role=switch] sits in normal flow and on-screen,
                        so focusing it on click never triggers the browser's
                        "scroll focused element into view" behaviour. The old
                        sr-only checkbox was focusable but positioned off-screen,
                        which — inside the Radix ScrollArea viewport — flung the
                        form ~678px above the viewport when toggled (M4 tracker #8). */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={receivingHoursEnabled}
                      aria-label="Message receiving hours"
                      onClick={() => setReceivingHoursEnabled((v) => !v)}
                      className="inline-flex items-center gap-2 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-full"
                    >
                      <span
                        className={`relative h-5 w-9 rounded-full transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:h-4 after:w-4 after:rounded-full after:transition-all ${
                          receivingHoursEnabled ? "bg-primary after:translate-x-4" : "bg-muted"
                        }`}
                      />
                      <span className="text-xs font-medium">{receivingHoursEnabled ? "On" : "Off"}</span>
                    </button>
                  </div>

                  {/* When the toggle is OFF we show only the toggle + helper line
                      above; the hour fields are revealed only when ON. Toggling
                      no longer moves focus to an off-screen element, so revealing
                      / hiding the fields reflows the card in place without any
                      scroll jump — M4 tracker #8. */}
                  {receivingHoursEnabled && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">
                        Messages sent outside this window will be queued and delivered when the next window opens.
                      </p>
                      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Start</label>
                          <Input
                            type="time"
                            value={receivingHoursStart}
                            onChange={(e) => setReceivingHoursStart(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">End</label>
                          <Input
                            type="time"
                            value={receivingHoursEnd}
                            onChange={(e) => setReceivingHoursEnd(e.target.value)}
                          />
                        </div>
                      </div>
                      {/* Only the UK timezone is supported in v1, so this is a
                          tidy read-only label rather than an editable field. */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Timezone</p>
                        <p className="text-sm text-muted-foreground rounded-md border border-input bg-muted px-3 py-2">
                          United Kingdom (Europe/London)
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Button type="submit" className="bg-primary hover:bg-primary/90 w-full sm:w-auto" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Billing — payment method, subscriptions with per-channel cancel, invoices. Regular users only. */}
        {currentUser?.role === "user" && <BillingCard />}

        {/* Change password — admins and moderators only */}
        {["admin", "super_admin", "moderator"].includes(currentUser?.role || "") && (
          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>Update your account password.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Current Password</label>
                  <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">New Password</label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                  <p className="text-xs text-muted-foreground">At least 8 characters, 1 uppercase, 1 lowercase, 1 special character.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Confirm New Password</label>
                  <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                </div>
                <Button type="submit" className="bg-primary hover:bg-primary/90 w-full sm:w-auto" disabled={passwordLoading}>
                  {passwordLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      <AvatarCropDialog
        file={pendingCropFile}
        open={cropOpen}
        onOpenChange={(next) => {
          setCropOpen(next);
          if (!next) {
            setPendingCropFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }
        }}
        onConfirm={handleCroppedUpload}
      />
    </ScrollArea>
  );
}
