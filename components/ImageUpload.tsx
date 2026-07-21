"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ImageIcon, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ImageUploadProps {
  channelId: string;
  onUploadSuccess?: () => void;
}

export function ImageUpload({ channelId, onUploadSuccess }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Basic validation
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum size is 5MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      // 1. Upload file to our server, which uploads to S3 (avoids CORS & signature issues)
      const formData = new FormData();
      formData.append("file", file);
      formData.append("channelId", channelId);

      const uploadRes = await fetch("/api/images/do-upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const errData = await uploadRes.json();
        throw new Error(errData.error || "Failed to upload image");
      }
      const { imageId } = await uploadRes.json();

      // 2. Confirm Upload & Trigger AI Moderation
      const confirmRes = await fetch("/api/images/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });

      if (!confirmRes.ok) throw new Error("Confirmation failed");
      await confirmRes.json();

      toast({
        title: "Image submitted",
        description: "Your image is awaiting moderator review. The recipient will be notified once it's approved.",
      });

      if (onUploadSuccess) onUploadSuccess();
      
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";

    } catch (error) {
      console.error("[ImageUpload] Error:", error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Something went wrong during the upload process.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center">
      <input
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        ref={fileInputRef}
        className="hidden"
        disabled={uploading}
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        title="Upload Image (Portal Only)"
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <ImageIcon className="h-5 w-5 text-muted-foreground hover:text-primary transition-colors" />
        )}
      </Button>
    </div>
  );
}
