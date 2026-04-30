import { useRoute, useLocation } from "wouter";
import {
  useGetJobSlip,
  useMarkJobSlipViewed,
  useConfirmJobSlip,
  useSendJobSlip,
  useGetMe,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, CheckCheck, Eye, Package, AlertCircle, Send,
  ChevronLeft, ChevronRight, Pencil, Trash2, Save, X, Plus
} from "lucide-react";
import { generateJobSlipPdf } from "@/lib/print-utils";
import { PrintShareButton } from "@/components/print-share-button";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const STATUS_INFO: Record<string, { label: string; color: string; desc: string }> = {
  draft: { label: "Draft — Bheja Nahi Gaya", color: "text-gray-600 bg-gray-100", desc: "Neeche 'Karigar ko Bhejo' button dabaao toh karigar ko notification jaayegi" },
  sent: { label: "Bheja Gaya", color: "text-amber-600 bg-amber-50", desc: "Karigar ne abhi nahi dekha" },
  viewed: { label: "Dekh Liya ✓", color: "text-blue-600 bg-blue-50", desc: "Karigar ne slip dekh li hai" },
  confirmed: { label: "Maal Mil Gaya ✓", color: "text-green-600 bg-green-50", desc: "Karigar ne confirm kar diya — maal pahunch gaya" },
  completed: { label: "Mukammal", color: "text-purple-600 bg-purple-50", desc: "Poora maal wapas aa gaya" },
};

function parsePhotoUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [raw];
}

function PhotoCarousel({ urls }: { urls: string[] }) {
  const [idx, setIdx] = useState(0);
  if (urls.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="relative rounded-xl overflow-hidden border border-border bg-black/5">
        <img src={urls[idx]} alt={`Photo ${idx + 1}`} className="w-full max-h-52 object-cover" />
        {urls.length > 1 && (
          <>
            <button onClick={() => setIdx((i) => (i - 1 + urls.length) % urls.length)} className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setIdx((i) => (i + 1) % urls.length)} className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1">
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
              {urls.map((_, i) => (
                <button key={i} onClick={() => setIdx(i)} className={`w-1.5 h-1.5 rounded-full transition-all ${i === idx ? "bg-white" : "bg-white/40"}`} />
              ))}
            </div>
            <div className="absolute top-1.5 right-2 bg-black/60 text-white text-[10px] rounded-full px-1.5 py-0.5">{idx + 1}/{urls.length}</div>
          </>
        )}
      </div>
    </div>
  );
}

interface EditItem {
  itemName: string;
  totalQty: string;
  ratePerPc: string;
  notes: string;
}

export default function SlipDetail() {
  const [, params] = useRoute("/slips/job/:id");
  const [, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const { toast } = useToast();
  const qc = useQueryClient();

  const id = parseInt(params?.id ?? "0", 10);
  const { data: slip, isLoading } = useGetJobSlip(id);
  const markViewed = useMarkJobSlipViewed();
  const confirmSlip = useConfirmJobSlip();
  const sendSlip = useSendJobSlip();

  const [editMode, setEditMode] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isKarigar = user?.id === (slip as any)?.karigarId;
  const isSeth = user?.id === (slip as any)?.sethId;
  const status = (slip as any)?.status;
  const canEdit = (slip as any)?.canEdit ?? false;
  const canDelete = (slip as any)?.canDelete ?? false;

  function startEdit() {
    const s = slip as any;
    setEditNotes(s.notes ?? "");
    setEditItems((s.items ?? []).map((item: any) => ({
      itemName: item.itemName,
      totalQty: String(item.totalQty),
      ratePerPc: item.ratePerPc ? String(parseFloat(item.ratePerPc)) : "",
      notes: item.notes ?? "",
    })));
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
  }

  function addItem() {
    setEditItems((prev) => [...prev, { itemName: "", totalQty: "", ratePerPc: "", notes: "" }]);
  }

  function removeItem(idx: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, field: keyof EditItem, val: string) {
    setEditItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item));
  }

  async function handleSave() {
    if (editItems.length === 0) {
      toast({ title: "Kam se kam ek item chahiye", variant: "destructive" });
      return;
    }
    for (const item of editItems) {
      if (!item.itemName.trim() || !item.totalQty || parseInt(item.totalQty) <= 0) {
        toast({ title: "Har item mein naam aur qty bharo", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`/api/job-slips/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          notes: editNotes || null,
          items: editItems.map((item) => ({
            itemName: item.itemName.trim(),
            totalQty: parseInt(item.totalQty),
            ratePerPc: item.ratePerPc ? parseFloat(item.ratePerPc) : null,
            notes: item.notes || null,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Save nahi hua");
      }
      qc.invalidateQueries({ queryKey: ["getJobSlip", id] });
      qc.invalidateQueries({ queryKey: ["getJobSlips"] });
      setEditMode(false);
      toast({ title: "Slip save ho gayi ✓" });
    } catch (e: any) {
      toast({ title: e?.message ?? "Save nahi hua", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`/api/job-slips/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete nahi hua");
      }
      qc.invalidateQueries({ queryKey: ["getJobSlips"] });
      toast({ title: "Slip delete ho gayi" });
      setLocation("/slips");
    } catch (e: any) {
      toast({ title: e?.message ?? "Delete nahi hua", variant: "destructive" });
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleSend() {
    try {
      await sendSlip.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: ["getJobSlip", id] });
      qc.invalidateQueries({ queryKey: ["getJobSlips"] });
      toast({ title: "Karigar ko notification bhej di! 🎉", description: "Ab karigar slip dekh sakta hai" });
    } catch {
      toast({ title: "Error", description: "Bhej nahi saka. Dobara try karo.", variant: "destructive" });
    }
  }

  async function handleView() {
    try {
      await markViewed.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: ["getJobSlip", id] });
      qc.invalidateQueries({ queryKey: ["getJobSlips"] });
    } catch {
      toast({ title: "Error", description: "View nahi hua", variant: "destructive" });
    }
  }

  async function handleConfirm() {
    try {
      await confirmSlip.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: ["getJobSlip", id] });
      qc.invalidateQueries({ queryKey: ["getJobSlips"] });
      toast({ title: "Confirm ho gaya! ✓", description: "Seth ko notification bhej diya — maal milne ki confirmation" });
    } catch {
      toast({ title: "Error", description: "Confirm nahi hua", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="px-4 pt-20">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-40 w-full rounded-2xl mb-3" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  if (!slip) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-[80vh] px-4">
          <AlertCircle className="h-16 w-16 text-muted-foreground mb-4" />
          <p className="text-lg font-semibold">Slip nahi mili</p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/slips")}>Wapas Jao</Button>
        </div>
      </Layout>
    );
  }

  const s = slip as any;
  const statusInfo = STATUS_INFO[status] ?? { label: status, color: "text-muted-foreground bg-muted", desc: "" };
  const items: any[] = s.items ?? [];
  const totalQty = s.totalQty ?? 0;
  const jamaQty = (s.jamaQty ?? 0) + (s.damageQty ?? 0) + (s.shortageQty ?? 0) + (s.noWorkQty ?? 0);
  const balanceQty = s.balanceQty ?? 0;

  // Effective rate: finalRate (if payment done) else ratePerPc
  const hasAnyRate = items.some((i) => i.finalRate || i.ratePerPc);
  const hasAnyFinalRate = items.some((i) => i.finalRate && parseFloat(i.finalRate) > 0);
  const weightedEffectiveRate = totalQty > 0 && hasAnyRate
    ? items.reduce((sum, item) => {
        const r = item.finalRate ? parseFloat(item.finalRate) : (item.ratePerPc ? parseFloat(item.ratePerPc) : 0);
        return sum + item.totalQty * r;
      }, 0) / totalQty
    : 0;
  const goodJamaQty = s.jamaQty ?? 0;
  const jamaBillAmt = goodJamaQty * weightedEffectiveRate;

  return (
    <Layout>
      <div className="pb-36">
        <header className="bg-primary text-primary-foreground px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
          <div className="flex items-center gap-3">
            <button
              onClick={() => editMode ? cancelEdit() : setLocation("/slips")}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20"
            >
              {editMode ? <X className="h-5 w-5" /> : <ArrowLeft className="h-5 w-5" />}
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold">{editMode ? "Slip Edit Karo" : s.slipNumber}</h1>
              <p className="text-primary-foreground/70 text-sm mt-0.5">
                {format(new Date(s.createdAt), "dd MMM yyyy, hh:mm a")}
              </p>
            </div>
            {/* Edit/Delete/Print buttons — not in edit mode */}
            {!editMode && (
              <div className="flex items-center gap-2">
                <PrintShareButton
                  generatePdf={() => generateJobSlipPdf(s)}
                  filename={`${s.slipNumber ?? "slip"}.pdf`}
                />
                {isSeth && canEdit && (
                  <button
                    onClick={startEdit}
                    className="p-2 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
                    title="Edit karo"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                {isSeth && canDelete && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-2 rounded-full bg-red-500/30 hover:bg-red-500/50 transition-colors"
                    title="Delete karo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Delete Confirmation */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center">
            <div className="bg-background rounded-t-3xl p-6 w-full max-w-md shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
                  <Trash2 className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <p className="font-bold text-lg">Slip Delete Karo?</p>
                  <p className="text-sm text-muted-foreground">{s.slipNumber} permanently delete ho jayegi</p>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                <p className="text-sm text-amber-800">⚠️ Yeh action undo nahi ho sakta</p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>
                  Ruk Jao
                </Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? "Delete ho raha hai..." : "Haan, Delete Karo"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── EDIT MODE ── */}
        {editMode ? (
          <div className="px-4 pt-4 space-y-4">
            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
              <h3 className="font-semibold mb-3">Items</h3>
              {editItems.map((item, idx) => (
                <div key={idx} className="border border-border rounded-xl p-3 mb-3 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">Item #{idx + 1}</p>
                    {editItems.length > 1 && (
                      <button onClick={() => removeItem(idx)} className="text-red-500 p-1">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Input
                    placeholder="Item ka naam (e.g. Saree)"
                    value={item.itemName}
                    onChange={(e) => updateItem(idx, "itemName", e.target.value)}
                    className="rounded-lg"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Qty (pcs)</label>
                      <Input
                        type="number"
                        placeholder="100"
                        value={item.totalQty}
                        onChange={(e) => updateItem(idx, "totalQty", e.target.value)}
                        className="rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Rate/pc (₹)</label>
                      <Input
                        type="number"
                        placeholder="Optional"
                        value={item.ratePerPc}
                        onChange={(e) => updateItem(idx, "ratePerPc", e.target.value)}
                        className="rounded-lg"
                      />
                    </div>
                  </div>
                  <Input
                    placeholder="Notes (optional)"
                    value={item.notes}
                    onChange={(e) => updateItem(idx, "notes", e.target.value)}
                    className="rounded-lg"
                  />
                </div>
              ))}
              <button
                onClick={addItem}
                className="w-full border-2 border-dashed border-border rounded-xl p-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" /> Item Add Karo
              </button>
            </div>

            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
              <label className="text-sm font-semibold mb-2 block">Notes</label>
              <Textarea
                placeholder="Koi bhi notes..."
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="rounded-xl"
                rows={3}
              />
            </div>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-12 rounded-xl text-base font-semibold gap-2"
            >
              <Save className="h-5 w-5" />
              {saving ? "Save ho raha hai..." : "Save Karo ✓"}
            </Button>
          </div>
        ) : (
          /* ── VIEW MODE ── */
          <div className="px-4 pt-4 space-y-4">
            {/* Status banner */}
            <div className={`rounded-2xl p-4 ${statusInfo.color}`}>
              <p className="font-bold text-lg">{statusInfo.label}</p>
              <p className="text-sm opacity-80 mt-0.5">{statusInfo.desc}</p>
            </div>

            {/* Parties */}
            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Parties</h3>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600 shrink-0">
                  {(s.seth?.name || s.seth?.code || "S")[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Seth (Dene Wala)</p>
                  <p className="font-semibold">{s.seth?.name || s.seth?.code}</p>
                </div>
                {isSeth && <span className="ml-auto text-[10px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-semibold">Aap</span>}
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-sm font-bold text-green-600 shrink-0">
                  {(s.karigar?.name || s.karigar?.code || "K")[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Karigar (Lene Wala)</p>
                  <p className="font-semibold">{s.karigar?.name || s.karigar?.code}</p>
                </div>
                {isKarigar && <span className="ml-auto text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold">Aap</span>}
              </div>
            </div>

            {/* Items list */}
            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex justify-between items-center">
                <h3 className="font-semibold">Maal ki List</h3>
                <span className="text-xs text-muted-foreground">{items.length} item(s)</span>
              </div>
              {items.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">Koi item nahi</div>
              ) : (
                items.map((item: any, i: number) => {
                  const photos = parsePhotoUrls(item.photoUrl);
                  const pRate = item.ratePerPc ? parseFloat(item.ratePerPc) : null;
                  const fRate = item.finalRate ? parseFloat(item.finalRate) : null;
                  const displayRate = fRate ?? pRate;
                  const rateChanged = fRate && pRate && Math.abs(fRate - pRate) > 0.001;
                  return (
                    <div key={item.id} className={`px-4 py-3 ${i < items.length - 1 ? "border-b border-border" : ""}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-semibold">{item.itemName}</p>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {item.totalQty?.toLocaleString()} pcs
                            {displayRate && !fRate && (
                              <span className="ml-2">@ ₹{displayRate.toFixed(2)}/pc</span>
                            )}
                          </p>

                          {/* Final Rate (set at payment time) */}
                          {fRate && (
                            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                                Final Rate: ₹{fRate.toFixed(2)}/pc
                              </span>
                              {rateChanged && pRate && (
                                <span className="text-xs text-muted-foreground line-through">
                                  P.rate: ₹{pRate.toFixed(2)}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Total amount based on effective rate */}
                          {displayRate && (
                            <p className="text-sm font-medium text-primary mt-1">
                              Issued Total: ₹{(item.totalQty * displayRate).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                            </p>
                          )}

                          {item.notes && (
                            <p className="text-xs text-muted-foreground italic mt-1">{item.notes}</p>
                          )}
                        </div>
                      </div>
                      {photos.length > 0 && <PhotoCarousel urls={photos} />}
                    </div>
                  );
                })
              )}
            </div>

            {/* Balance summary */}
            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
              <h3 className="font-semibold mb-3">Hisaab ka Khulasa</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-xs text-blue-600 mb-1">Total Diya</p>
                  <p className="text-lg font-bold text-blue-700">{totalQty.toLocaleString()}</p>
                  <p className="text-xs text-blue-600">pcs</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3">
                  <p className="text-xs text-green-600 mb-1">Wapas Aaya</p>
                  <p className="text-lg font-bold text-green-700">{jamaQty.toLocaleString()}</p>
                  <p className="text-xs text-green-600">pcs</p>
                </div>
                <div className={`rounded-xl p-3 ${balanceQty > 0 ? "bg-amber-50" : "bg-green-50"}`}>
                  <p className={`text-xs mb-1 ${balanceQty > 0 ? "text-amber-600" : "text-green-600"}`}>Baaki</p>
                  <p className={`text-lg font-bold ${balanceQty > 0 ? "text-amber-700" : "text-green-700"}`}>{balanceQty.toLocaleString()}</p>
                  <p className={`text-xs ${balanceQty > 0 ? "text-amber-600" : "text-green-600"}`}>pcs</p>
                </div>
              </div>

              {/* Jama Bill — same calculation as statement page */}
              {jamaBillAmt > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Jama Bill
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {goodJamaQty}pc × ₹{weightedEffectiveRate.toFixed(2)}/pc
                        {hasAnyFinalRate && (
                          <span className="ml-1 text-emerald-600 font-medium">(Final Rate)</span>
                        )}
                      </p>
                    </div>
                    <p className="text-xl font-bold text-emerald-600">
                      ₹{jamaBillAmt.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                </div>
              )}

              {/* No Work summary if any */}
              {(s.noWorkQty ?? 0) > 0 && (
                <div className="mt-3 bg-orange-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-orange-600 mb-1">No Work (Wapas — Zero Payment)</p>
                  <p className="text-lg font-bold text-orange-700">{s.noWorkQty.toLocaleString()} pcs</p>
                </div>
              )}
            </div>

            {s.notes && (
              <div className="bg-muted/50 rounded-2xl p-4">
                <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{s.notes}</p>
              </div>
            )}

            {/* Delete protection info */}
            {isSeth && !canDelete && status !== "draft" && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                <p className="text-sm text-red-700 font-medium">🔒 Slip delete nahi ho sakti</p>
                <p className="text-xs text-red-600 mt-1">
                  {status === "confirmed" || status === "completed"
                    ? "Karigar ne maal receive confirm kar diya hai"
                    : "Is slip pe maal wapsi ki entry hai"}
                </p>
              </div>
            )}

            {/* Timeline */}
            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Slip Ki Journey</h3>
              <div className="space-y-2">
                <TimelineStep done={true} label="Slip bani" sub={format(new Date(s.createdAt), "dd MMM, hh:mm a")} color="blue" />
                <TimelineStep done={status !== "draft"} label="Karigar ko bheja" color="amber" />
                <TimelineStep done={status === "viewed" || status === "confirmed" || status === "completed"} label="Karigar ne dekha" color="blue" />
                <TimelineStep done={status === "confirmed" || status === "completed"} label="Karigar ne OK kiya — Maal mila" color="green" />
                <TimelineStep done={status === "completed"} label="Poora maal wapas" color="purple" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom action bar — View mode only */}
      {!editMode && (
        <>
          {(isSeth && status === "draft") && (
            <div className="fixed bottom-16 left-0 right-0 p-4 bg-background border-t border-border shadow-lg z-40">
              <div className="max-w-md mx-auto space-y-2">
                <p className="text-xs text-center text-muted-foreground mb-1">Slip abhi draft mein hai — karigar ko notification nahi gayi</p>
                <Button
                  onClick={handleSend}
                  disabled={sendSlip.isPending}
                  className="w-full h-12 rounded-xl text-base font-semibold gap-2 bg-green-600 hover:bg-green-700"
                >
                  <Send className="h-5 w-5" />
                  {sendSlip.isPending ? "Bhej raha hai..." : "Karigar ko Bhejo 📤"}
                </Button>
              </div>
            </div>
          )}

          {isKarigar && status === "sent" && (
            <div className="fixed bottom-16 left-0 right-0 p-4 bg-background border-t border-border shadow-lg z-40">
              <div className="max-w-md mx-auto">
                <Button
                  variant="outline"
                  onClick={handleView}
                  disabled={markViewed.isPending}
                  className="w-full h-12 rounded-xl text-base font-semibold"
                >
                  <Eye className="h-5 w-5 mr-2" />
                  {markViewed.isPending ? "Bhej raha hai..." : "Dekh Liya — Seth ko batao 👁"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

function TimelineStep({ done, label, sub, color }: { done: boolean; label: string; sub?: string; color: string }) {
  const dotColor = done
    ? color === "green" ? "bg-green-500"
    : color === "amber" ? "bg-amber-500"
    : color === "purple" ? "bg-purple-500"
    : "bg-blue-500"
    : "bg-gray-200";
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 w-3 h-3 rounded-full shrink-0 ${dotColor}`} />
      <div>
        <p className={`text-sm font-medium ${done ? "text-foreground" : "text-muted-foreground"}`}>{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}
