"use client";

import { useState, useCallback, useEffect } from "react";
import Cropper, { Area } from "react-easy-crop";
import { ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Square-crop dialog for profile photos (M4 tracker #12).
 *
 * Receives a File from the upstream <input type="file"> change handler,
 * shows a draggable + zoomable crop overlay constrained to 1:1 aspect,
 * and on Save returns a 512x512 JPEG Blob via onConfirm. The settings
 * page then POSTs that blob to /api/users/upload-avatar.
 *
 * Output is fixed at 512x512 JPEG / quality 0.9 — small enough that the
 * 5 MB server cap is never hit by a cropped result, and matches the
 * largest size we render an avatar at on either user or admin surfaces.
 */

const OUTPUT_SIZE = 512;
const OUTPUT_MIME = "image/jpeg";
const OUTPUT_QUALITY = 0.9;

async function cropImageToBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null"))),
      OUTPUT_MIME,
      OUTPUT_QUALITY
    );
  });
}

interface AvatarCropDialogProps {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
}

export function AvatarCropDialog({ file, open, onOpenChange, onConfirm }: AvatarCropDialogProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixelCrop, setPixelCrop] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setImageSrc(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(typeof reader.result === "string" ? reader.result : null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPixelCrop(null);
      setError(null);
    };
    reader.onerror = () => setError("Could not read the selected file. Try another image.");
    reader.readAsDataURL(file);
  }, [file]);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setPixelCrop(areaPixels);
  }, []);

  const handleSave = async () => {
    if (!imageSrc || !pixelCrop) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await cropImageToBlob(imageSrc, pixelCrop);
      await onConfirm(blob);
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Crop failed.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-xl font-bold">Crop your photo</DialogTitle>
          <DialogDescription>
            Drag to reposition, pinch or use the slider to zoom. The square area is what will be saved.
          </DialogDescription>
        </DialogHeader>

        <div className="relative w-full aspect-square bg-muted">
          {imageSrc ? (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
        </div>

        <div className="px-6 space-y-3">
          <div className="flex items-center gap-3">
            <ZoomOut className="w-4 h-4 text-muted-foreground" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              disabled={!imageSrc || saving}
              className="flex-1 accent-primary"
              aria-label="Zoom"
            />
            <ZoomIn className="w-4 h-4 text-muted-foreground" />
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="px-6 pb-6 gap-2 sm:gap-2 flex-row justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!pixelCrop || saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            {saving ? "Saving…" : "Save photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
