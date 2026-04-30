import React, { useRef, useState, useCallback, useEffect } from "react";
import { Layout } from "@/components/layout";
import { useGetGallery, useGetGalleryLimit, useUploadGalleryImage, useDeleteGalleryImage } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, X, ChevronLeft, ChevronRight, Info, AlertCircle, Plus, ImageOff, Share2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { UserAvatar } from "@/components/user-avatar";

function compressImage(file: File, maxWidth: number, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("hi-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function daysLeft(expiresAtStr: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAtStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

async function shareImage(img: any, toast: any) {
  const src = img.thumbnail;
  try {
    // Convert base64 to Blob
    const [header, data] = src.split(",");
    const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const file = new File([blob], "fabric-image.jpg", { type: mime });

    if (navigator.share) {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: img.caption || "FabricPro Gallery" });
      } else {
        await navigator.share({ title: img.caption || "FabricPro Gallery Image", text: img.caption || "FabricPro se share" });
      }
    } else {
      // Fallback: download image
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "fabric-image.jpg";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Image download ho gayi" });
    }
  } catch (err: any) {
    if (err?.name !== "AbortError") {
      toast({ title: "Share nahi ho saka", variant: "destructive" });
    }
  }
}

export default function Gallery() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [captionInput, setCaptionInput] = useState("");
  const [captionPrompt, setCaptionPrompt] = useState<{
    thumbnail: string;
    fullImage: string;
    show: boolean;
  } | null>(null);

  const { data: limitInfo } = useGetGalleryLimit();
  const { data: galleryData, isLoading } = useGetGallery({});
  const uploadMutation = useUploadGalleryImage();
  const deleteMutation = useDeleteGalleryImage();
  const images = galleryData?.images ?? [];

  // Handle browser back button to close lightbox instead of navigating away
  const lightboxOpen = lightboxIdx !== null;
  useEffect(() => {
    if (!lightboxOpen) return;
    window.history.pushState({ lightboxOpen: true }, "");
    const handlePop = () => setLightboxIdx(null);
    window.addEventListener("popstate", handlePop);
    return () => {
      window.removeEventListener("popstate", handlePop);
    };
  }, [lightboxOpen]);

  const closeLightbox = useCallback(() => {
    setLightboxIdx(null);
    // If we pushed a history state for lightbox, go back to clear it
    if (window.history.state?.lightboxOpen) {
      window.history.back();
    }
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Sirf images upload ho sakti hain", variant: "destructive" });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast({ title: "Image 15MB se chhoti honi chahiye", variant: "destructive" });
      return;
    }
    try {
      const [thumbnail, fullImage] = await Promise.all([
        compressImage(file, 300, 0.7),
        compressImage(file, 1200, 0.85),
      ]);
      setCaptionInput("");
      setCaptionPrompt({ thumbnail, fullImage, show: true });
    } catch {
      toast({ title: "Image compress nahi ho saki", variant: "destructive" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [toast]);

  const handleUpload = useCallback(async () => {
    if (!captionPrompt) return;
    setUploading(true);
    try {
      await uploadMutation.mutateAsync({
        data: { thumbnail: captionPrompt.thumbnail, fullImage: captionPrompt.fullImage, caption: captionInput.trim() || undefined },
      });
      setCaptionPrompt(null);
      queryClient.invalidateQueries({ queryKey: ["/gallery"] });
      toast({ title: "Image upload ho gayi!" });
    } catch {
      toast({ title: "Upload fail hua", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [captionPrompt, captionInput, uploadMutation, queryClient, toast]);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm("Yeh image delete karein?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/gallery"] });
      closeLightbox();
      toast({ title: "Image delete ho gayi" });
    } catch {
      toast({ title: "Delete fail hua", variant: "destructive" });
    }
  }, [deleteMutation, queryClient, closeLightbox, toast]);

  // Touch swipe handlers for lightbox
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = e.changedTouches[0].clientY - touchRef.current.y;
    touchRef.current = null;

    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 60) {
      // Swipe up or down → close lightbox
      closeLightbox();
    } else if (Math.abs(dx) > 50) {
      // Swipe left → next image; swipe right → prev image
      setLightboxIdx((idx) => {
        if (idx === null) return null;
        if (dx < 0 && idx < images.length - 1) return idx + 1;
        if (dx > 0 && idx > 0) return idx - 1;
        return idx;
      });
    }
  }, [images.length, closeLightbox]);

  const plan = limitInfo?.plan ?? galleryData?.plan ?? "trial";
  const retentionDays = limitInfo?.retentionDays ?? galleryData?.retentionDays ?? 0;
  const isUnlimited = limitInfo?.isUnlimited ?? plan === "pro";

  const planBadgeVariant: "default" | "secondary" | "outline" = plan === "pro" ? "default" : plan === "basic" ? "secondary" : "outline";
  const planLabel = plan === "pro" ? "Pro" : plan === "basic" ? "Basic" : plan === "inactive" ? "Inactive" : "Trial";

  return (
    <Layout>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">Gallery</h1>
            <p className="text-xs text-muted-foreground">Fabric designs & samples</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={planBadgeVariant} className="text-xs">{planLabel}</Badge>
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={plan === "inactive"} className="gap-1">
              <Plus className="w-4 h-4" /> Upload
            </Button>
          </div>
        </div>

        {/* Retention info */}
        {limitInfo && (
          <div className={cn(
            "mx-4 mt-3 rounded-xl px-3 py-2 flex items-center gap-2 text-xs",
            plan === "pro" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : plan === "inactive" ? "bg-destructive/10 text-destructive"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          )}>
            {plan === "inactive" ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Info className="w-4 h-4 shrink-0" />}
            <span>{limitInfo.message}</span>
          </div>
        )}

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

        {/* Caption prompt — full-screen bottom sheet, z-[200] above everything */}
        {captionPrompt?.show && (
          <div className="fixed inset-0 z-[200] bg-black/70 flex flex-col justify-end" onClick={(e) => e.target === e.currentTarget && setCaptionPrompt(null)}>
            <div className="bg-card rounded-t-3xl w-full overflow-hidden shadow-2xl">
              <div className="relative">
                <img src={captionPrompt.thumbnail} alt="Preview" className="w-full max-h-56 object-cover" />
                <button
                  className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white"
                  onClick={() => setCaptionPrompt(null)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}>
                <p className="font-semibold text-foreground text-sm">Caption likhein (optional)</p>
                <input
                  type="text"
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Jaise: Blue floral print, summer collection..."
                  value={captionInput}
                  onChange={(e) => setCaptionInput(e.target.value)}
                  maxLength={200}
                  autoFocus
                />
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => setCaptionPrompt(null)}>Cancel</Button>
                  <Button className="flex-1 h-12 rounded-xl text-base font-bold" onClick={handleUpload} disabled={uploading}>
                    {uploading ? "Upload ho raha hai..." : "Save Karen ✓"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Lightbox */}
        {lightboxIdx !== null && images[lightboxIdx] && (() => {
          const img = images[lightboxIdx];
          const remaining = img.expiresAt && !isUnlimited ? daysLeft(img.expiresAt) : null;

          return (
            <div
              className="fixed inset-0 z-[100] bg-black flex flex-col select-none"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 py-3 bg-black/70 shrink-0">
                <button className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white" onClick={closeLightbox}>
                  <X className="w-5 h-5" />
                </button>
                <span className="text-white/50 text-xs">{(lightboxIdx ?? 0) + 1} / {images.length}</span>
                <div className="flex items-center gap-2">
                  <button
                    className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white"
                    onClick={() => shareImage(img, toast)}
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                  {img.isOwn && (
                    <button
                      className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-red-400"
                      onClick={() => handleDelete(img.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Image area — swipeable */}
              <div className="flex-1 flex items-center justify-center relative overflow-hidden">
                <img
                  src={img.fullImage || img.thumbnail}
                  alt={img.caption ?? "Gallery image"}
                  className="max-w-full max-h-full object-contain"
                  draggable={false}
                />
                {lightboxIdx > 0 && (
                  <button
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white"
                    onClick={() => setLightboxIdx((i) => Math.max(0, (i ?? 1) - 1))}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}
                {lightboxIdx < images.length - 1 && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white"
                    onClick={() => setLightboxIdx((i) => Math.min(images.length - 1, (i ?? 0) + 1))}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                )}

                {/* Swipe hint — shown briefly */}
                <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
                  <span className="text-[10px] text-white/30">Swipe karo navigate karne ke liye</span>
                </div>
              </div>

              {/* Bottom info */}
              <div className="px-4 py-3 bg-black/70 shrink-0" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
                {img.caption && <p className="text-white text-sm font-medium mb-1">{img.caption}</p>}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserAvatar userId={img.uploadedBy} name={(img.uploader as any)?.name ?? "?"} size="xs" />
                    <span className="text-white/60 text-xs">{(img.uploader as any)?.name ?? "Unknown"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <span>{formatDate(img.uploadedAt)}</span>
                    {remaining !== null && (
                      <span className={cn(remaining <= 2 ? "text-red-400" : "text-white/50")}>
                        • {remaining === 0 ? "aaj expire" : `${remaining}d baki`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Main grid */}
        <div className="p-3 mt-2">
          {isLoading ? (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                <ImageOff className="w-10 h-10 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Koi image nahi hai</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {plan === "inactive" ? "Account activate karo gallery use karne ke liye" : "Pehli image upload karo"}
                </p>
              </div>
              {plan !== "inactive" && (
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
                  <Camera className="w-4 h-4" /> Image Upload Karo
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1">
                {images.map((img, idx) => {
                  const remaining = img.expiresAt && !isUnlimited ? daysLeft(img.expiresAt) : null;
                  const expiringSoon = remaining !== null && remaining <= 2;
                  return (
                    <button key={img.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted" onClick={() => setLightboxIdx(idx)}>
                      <img src={img.thumbnail} alt={img.caption ?? ""} className="w-full h-full object-cover" loading="lazy" />
                      {expiringSoon && (
                        <div className="absolute top-1 right-1 bg-red-500 text-white text-[9px] font-bold rounded px-1 py-0.5 leading-none">
                          {remaining}d
                        </div>
                      )}
                      {img.isOwn && (
                        <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-primary/80 flex items-center justify-center">
                          <span className="text-[8px] text-white font-bold">You</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-center text-xs text-muted-foreground mt-4">
                {images.length} images{!isUnlimited && ` • ${retentionDays} din retention`}
              </p>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
