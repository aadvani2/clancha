"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils/formatDate";

interface PendingImage {
  _id: string;
  viewUrl: string;
  aiScore: number;
  aiReason: string;
  classification: string; // Added
  violationTags: string[]; // Added
  senderId: { name: string; phone: string };
  channelId: { name: string; clanchaNumber: string };
  createdAt: string;
}

export function ModerationList() {
  const [images, setImages] = useState<PendingImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchImages = async () => {
    try {
      const res = await fetch("/api/moderator/images", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch pending images");
      const data = await res.json();
      setImages(data);
    } catch (error) {
      toast({ title: "Error", description: "Failed to load moderation list.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  const handleAction = async (imageId: string, action: "approved" | "denied") => {
    setProcessingId(imageId);
    try {
      const res = await fetch("/api/moderator/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: "image",
          id: imageId,
          action: action === "approved" ? "approve" : "deny",
          notes: action === "approved" ? "Safe content" : "Violates community standards",
        }),
      });

      if (!res.ok) throw new Error("Action failed");

      toast({
        title: action === "approved" ? "Approved" : "Denied",
        description: `Image has been ${action}.`,
      });

      setImages((prev) => prev.filter((img) => img._id !== imageId));
    } catch (error) {
      toast({ title: "Error", description: "Action failed.", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  if (images.length === 0) {
    return (
      <Card className="text-center p-8 bg-muted/20">
        <p className="text-muted-foreground">No images pending moderation.</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {images.map((image) => (
        <Card key={image._id} className="overflow-hidden flex flex-col">
          <CardHeader className="p-4 space-y-1">
            <CardTitle className="text-sm font-medium">From: {image.senderId.name}</CardTitle>
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>Channel: {image.channelId.name}</span>
              <span>{formatDate(image.createdAt)}</span>
            </div>
          </CardHeader>
          <div className="aspect-square relative bg-black">
            <img src={image.viewUrl} alt="Pending moderation" className="object-contain w-full h-full" />
          </div>
          <CardContent className="p-4 space-y-3 flex-1">
            <div className="flex flex-wrap gap-2">
              <Badge variant={image.aiScore > 0.7 ? "secondary" : "destructive"}>
                AI Score: {Math.round(image.aiScore * 100)}%
              </Badge>
              <Badge variant="outline" className="capitalize">{image.classification}</Badge>
              {image.violationTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
                  {tag}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground italic">
              <Info className="inline-block h-3 w-3 mr-1" />
              AI Reason: {image.aiReason}
            </p>
          </CardContent>
          <CardFooter className="p-4 pt-0 flex gap-2">
            <Button
              variant="default"
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={() => handleAction(image._id, "approved")}
              disabled={!!processingId}
            >
              {processingId === image._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              Approve
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => handleAction(image._id, "denied")}
              disabled={!!processingId}
            >
              {processingId === image._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
              Deny
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
