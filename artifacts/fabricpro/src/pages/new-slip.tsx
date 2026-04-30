import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useCreateJobSlip, useGetConnections, useGetMe, useGetGallery } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Plus, Trash2, Search, ChevronRight, Package, Mic, MicOff, Images, X, ImageOff, Camera, Save
} from "lucide-react";

interface SlipItem {
  id: number;
  itemName: string;
  totalQty: string;
  ratePerPc: string;
  notes: string;
  photoUrls: string[];
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

let itemCounter = 0;

export default function NewSlip() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: user } = useGetMe();

  const [step, setStep] = useState<"select_karigar" | "add_items">("select_karigar");
  const [search, setSearch] = useState("");
  const [selectedKarigar, setSelectedKarigar] = useState<any>(null);

  const [items, setItems] = useState<SlipItem[]>(() => [
    { id: ++itemCounter, itemName: "", totalQty: "", ratePerPc: "", notes: "", photoUrls: [] }
  ]);
  const [slipNotes, setSlipNotes] = useState("");
  const [isRecording, setIsRecording] = useState<number | null>(null);
  const recognitionRef = useRef<any>(null);

  // Gallery / Camera state
  const [galleryPickerItemId, setGalleryPickerItemId] = useState<number | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [cameraTargetItemId, setCameraTargetItemId] = useState<number | null>(null);

  const { data: connections = [] } = useGetConnections();
  const { data: galleryData } = useGetGallery(
    { page: 1, limit: 50 },
    { query: { enabled: galleryPickerItemId !== null } }
  );
  const createSlip = useCreateJobSlip();
  const isLocked = (user?.plan ?? "trial") === "inactive" && user?.role !== "super_admin";

  const karigarConnections = (connections as any[]).filter(
    (c: any) => c.status === "accepted" && c.connectedUser?.id !== user?.id
  );

  const filtered = karigarConnections.filter((c: any) => {
    const name = c.connectedUser?.name || c.connectedUser?.code || "";
    return name.toLowerCase().includes(search.toLowerCase()) || (c.connectedUser?.mobile || "").includes(search);
  });

  function addItem() {
    setItems((prev) => [...prev, { id: ++itemCounter, itemName: "", totalQty: "", ratePerPc: "", notes: "", photoUrls: [] }]);
  }

  function removeItem(id: number) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateItem(id: number, field: keyof Omit<SlipItem, "photoUrls">, value: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }

  function addPhotoToItem(id: number, dataUrl: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, photoUrls: [...i.photoUrls, dataUrl] } : i))
    );
  }

  function removePhotoFromItem(itemId: number, photoIdx: number) {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, photoUrls: i.photoUrls.filter((_, idx) => idx !== photoIdx) } : i))
    );
  }

  function startVoice(itemId: number, field: "notes") {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast({ title: "Voice nahi chala", description: "Browser voice support nahi karta", variant: "destructive" });
      return;
    }
    if (isRecording === itemId) {
      recognitionRef.current?.stop();
      setIsRecording(null);
      return;
    }
    const r = new SR();
    r.lang = "hi-IN";
    r.interimResults = false;
    r.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      updateItem(itemId, field, text);
    };
    r.onend = () => setIsRecording(null);
    r.start();
    recognitionRef.current = r;
    setIsRecording(itemId);
  }

  function openCameraForItem(itemId: number) {
    setCameraTargetItemId(itemId);
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
      cameraInputRef.current.click();
    }
  }

  function handleCameraCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || cameraTargetItemId === null) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 800;
        const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const resized = canvas.toDataURL("image/jpeg", 0.75);
        addPhotoToItem(cameraTargetItemId!, resized);
        setCameraTargetItemId(null);
      };
      img.src = b64;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleSubmit() {
    const validItems = items.filter((i) => i.itemName.trim() && Number(i.totalQty) > 0);
    if (validItems.length === 0) {
      toast({ title: "Koi item nahi", description: "Kam se kam ek item add karo", variant: "destructive" });
      return;
    }

    try {
      const slip = await createSlip.mutateAsync({
        data: {
          karigarId: selectedKarigar.connectedUser.id,
          notes: slipNotes || undefined,
          items: validItems.map((i) => ({
            itemName: i.itemName.trim(),
            totalQty: parseInt(i.totalQty),
            ratePerPc: i.ratePerPc ? parseFloat(i.ratePerPc) : undefined,
            notes: i.notes || undefined,
            photoUrls: i.photoUrls.length > 0 ? i.photoUrls : undefined,
          })),
        } as any,
      });
      qc.invalidateQueries({ queryKey: ["getJobSlips"] });
      toast({
        title: "Slip save ho gayi! ✓",
        description: "Ab slip detail mein 'Karigar ko Bhejo' button se bhejo",
      });
      const slipId = (slip as any)?.id;
      if (slipId) {
        setLocation(`/slips/job/${slipId}`);
      } else {
        setLocation("/slips");
      }
    } catch {
      toast({ title: "Error", description: "Slip nahi ban saki. Dobara try karo.", variant: "destructive" });
    }
  }

  const galleryImages: any[] = (galleryData as any)?.images ?? [];

  if (step === "select_karigar") {
    return (
      <Layout>
        <div className="pb-24">
          <header className="bg-primary text-primary-foreground px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
            <div className="flex items-center gap-3">
              <button onClick={() => setLocation("/slips")} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold">Naya Maal Dena Slip</h1>
                <p className="text-primary-foreground/70 text-sm">Step 1: Karigar select karo</p>
              </div>
            </div>
          </header>

          <div className="px-4 pt-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Naam ya number se search karo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 rounded-xl"
              />
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <Package className="h-14 w-14 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">Koi karigar nahi mila</p>
                <p className="text-sm text-muted-foreground mt-1">Pehle connection add karo</p>
              </div>
            ) : (
              filtered.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedKarigar(c); setStep("add_items"); }}
                  className="w-full bg-card border border-border rounded-2xl p-4 mb-3 flex items-center gap-3 hover:shadow-md transition-all text-left"
                >
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0">
                    {(c.connectedUser?.name || c.connectedUser?.code || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{c.connectedUser?.name || c.connectedUser?.code}</p>
                    <p className="text-sm text-muted-foreground">{c.connectedUser?.mobile}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Hidden camera input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCameraCapture}
      />

      {/* Gallery Picker Modal */}
      {galleryPickerItemId !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex flex-col"
          onClick={(e) => { if (e.target === e.currentTarget) setGalleryPickerItemId(null); }}
        >
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 shrink-0">
            <p className="text-white font-semibold text-sm">Gallery se image chuno</p>
            <button onClick={() => setGalleryPickerItemId(null)} className="text-white/60 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {galleryImages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-white/40">
                <ImageOff className="w-10 h-10" />
                <p className="text-sm">Gallery khali hai</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {galleryImages.map((img: any) => (
                  <button
                    key={img.id}
                    onClick={() => {
                      addPhotoToItem(galleryPickerItemId!, img.thumbnail);
                      setGalleryPickerItemId(null);
                    }}
                    className="aspect-square rounded-xl overflow-hidden border-2 border-transparent hover:border-primary active:scale-95 transition-all"
                  >
                    <img
                      src={img.thumbnail}
                      alt={img.caption || ""}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="pb-32">
        <header className="bg-primary text-primary-foreground px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep("select_karigar")} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold">Maal ki Details</h1>
              <p className="text-primary-foreground/70 text-sm">
                Karigar: {selectedKarigar?.connectedUser?.name || selectedKarigar?.connectedUser?.code}
              </p>
            </div>
          </div>
        </header>

        <div className="px-4 pt-4 space-y-4">
          {items.map((item, index) => (
            <div key={item.id} className="bg-card border border-border rounded-2xl p-4 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-primary">Item #{index + 1}</h3>
                {items.length > 1 && (
                  <button onClick={() => removeItem(item.id)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Maal ka Naam *</label>
                  <Input
                    placeholder="Jaise: Rayon 145gram, Satin 160gram..."
                    value={item.itemName}
                    onChange={(e) => updateItem(item.id, "itemName", e.target.value)}
                    className="rounded-xl"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantity (pcs) *</label>
                    <Input
                      type="number"
                      placeholder="5000"
                      value={item.totalQty}
                      onChange={(e) => updateItem(item.id, "totalQty", e.target.value)}
                      className="rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Rate/pc (₹) <span className="text-muted-foreground/60">(optional)</span></label>
                    <Input
                      type="number"
                      placeholder="12.50"
                      value={item.ratePerPc}
                      onChange={(e) => updateItem(item.id, "ratePerPc", e.target.value)}
                      className="rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium text-muted-foreground">Notes <span className="text-muted-foreground/60">(optional)</span></label>
                    <button
                      onClick={() => startVoice(item.id, "notes")}
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                        isRecording === item.id ? "bg-red-100 text-red-600 animate-pulse" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isRecording === item.id ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                      {isRecording === item.id ? "Rok do" : "Voice"}
                    </button>
                  </div>
                  <Textarea
                    placeholder="Koi khaas baat..."
                    value={item.notes}
                    onChange={(e) => updateItem(item.id, "notes", e.target.value)}
                    className="rounded-xl resize-none"
                    rows={2}
                  />
                </div>

                {/* Item Photos — multiple */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block flex items-center gap-1">
                    <Images className="w-3.5 h-3.5" /> Photos{" "}
                    {item.photoUrls.length > 0 && (
                      <span className="ml-1 text-primary font-bold">({item.photoUrls.length})</span>
                    )}
                  </label>

                  {item.photoUrls.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
                      {item.photoUrls.map((url, idx) => (
                        <div key={idx} className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border">
                          <img src={url} alt={`photo ${idx + 1}`} className="w-full h-full object-cover" />
                          <button
                            onClick={() => removePhotoFromItem(item.id, idx)}
                            className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => openCameraForItem(item.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 border border-dashed border-muted-foreground/30 rounded-xl py-2.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Camera className="w-4 h-4" /> Camera se lo
                    </button>
                    <button
                      onClick={() => setGalleryPickerItemId(item.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 border border-dashed border-primary/40 rounded-xl py-2.5 text-xs text-primary hover:bg-primary/5 transition-colors"
                    >
                      <Images className="w-4 h-4" /> Gallery se lo
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={addItem}
            className="w-full border-2 border-dashed border-primary/30 rounded-2xl p-4 flex items-center justify-center gap-2 text-primary font-medium hover:bg-primary/5 transition-colors"
          >
            <Plus className="h-5 w-5" /> Aur Item Jodon
          </button>

          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Slip Notes <span className="text-muted-foreground/60">(optional)</span></label>
            <Textarea
              placeholder="Poori slip ke liye koi note..."
              value={slipNotes}
              onChange={(e) => setSlipNotes(e.target.value)}
              className="rounded-xl resize-none"
              rows={2}
            />
          </div>

          {/* Helper hint */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-800">
            <p className="font-semibold mb-0.5">ℹ️ Slip kaise bhejein?</p>
            <p>Pehle "Save Karo" se slip draft mein save hogi. Phir slip detail mein <strong>"Karigar ko Bhejo"</strong> button se karigar ko notification jaayegi.</p>
          </div>
        </div>
      </div>

      <div className="fixed bottom-16 left-0 right-0 p-4 bg-background border-t border-border shadow-lg z-40">
        <div className="max-w-md mx-auto">
          {isLocked ? (
            <div className="w-full h-12 rounded-xl bg-muted flex items-center justify-center gap-2 text-muted-foreground text-sm font-medium border border-border">
              <span>🔒</span> Trial khatam — plan upgrade karo
            </div>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={createSlip.isPending}
              className="w-full h-12 rounded-xl text-base font-semibold gap-2"
            >
              <Save className="h-5 w-5" />
              {createSlip.isPending ? "Save ho rahi hai..." : "Slip Save Karo (Draft)"}
            </Button>
          )}
        </div>
      </div>
    </Layout>
  );
}
