import { useState, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import {
  useGetConnections,
  getGetConnectionsQueryKey,
  getGetPaymentsQueryKey,
  useGetPendingJobSlips,
  useRecordJobPayment,
  type PendingJobSlip,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Search, CheckCircle2, ChevronRight, IndianRupee,
  ImagePlus, X, AlertCircle, Package, RotateCcw, Banknote, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type Step = "select_karigar" | "select_slips" | "enter_payment";

function compressImage(file: File, maxPx = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Compute weighted avg rate for a slip from per-item rates
function weightedRateForSlip(
  slip: PendingJobSlip,
  itemRates: Record<number, number>
): number {
  if (slip.totalIssuedQty === 0) return 0;
  const total = slip.items.reduce((sum, item) => {
    const r = itemRates[item.id] ?? 0;
    return sum + item.totalQty * r;
  }, 0);
  return total / slip.totalIssuedQty;
}

// Distribute totalAmount across slips (first-slip-first) using per-item weighted rates
function distributeAmount(
  slips: PendingJobSlip[],
  parsedItemRates: Record<number, number>,
  totalAmount: number
): Record<number, number> {
  const distribution: Record<number, number> = {};
  let remaining = totalAmount;

  for (const slip of slips) {
    const wRate = weightedRateForSlip(slip, parsedItemRates);
    if (wRate <= 0) { distribution[slip.id] = 0; continue; }
    const maxPayable = Math.max(0, slip.totalJamaQty * wRate - slip.paidAmount);
    const give = Math.min(remaining, maxPayable);
    distribution[slip.id] = Math.round(give * 100) / 100;
    remaining = Math.max(0, remaining - give);
    if (remaining <= 0) break;
  }

  return distribution;
}

export default function NewPayment() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("select_karigar");
  const [search, setSearch] = useState("");
  const [selectedConnection, setSelectedConnection] = useState<any>(null);
  const [selectedSlipIds, setSelectedSlipIds] = useState<Set<number>>(new Set());

  // Per-item rate state: Record<itemId, rateStr>
  const [itemRates, setItemRates] = useState<Record<number, string>>({});
  const [totalAmountStr, setTotalAmountStr] = useState("");
  const [screenshotBase64, setScreenshotBase64] = useState<string>("");
  const [note, setNote] = useState("");
  const [imgUploading, setImgUploading] = useState(false);

  const { data: connections } = useGetConnections({
    query: { queryKey: getGetConnectionsQueryKey({ status: "accepted" }) },
  });
  const acceptedConns = (connections ?? []).filter((c) => c.status === "accepted");
  const filteredConns = acceptedConns.filter((c) => {
    const name = (c.connectedUser?.name || c.connectedUser?.code || "").toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const { data: pendingSlips, isLoading: loadingSlips } = useGetPendingJobSlips(
    { connectionId: selectedConnection?.id ?? 0 },
    { enabled: !!selectedConnection?.id && step !== "select_karigar" }
  );

  const recordPaymentMutation = useRecordJobPayment();

  const selectedSlips = useMemo(
    () => (pendingSlips ?? []).filter((s) => selectedSlipIds.has(s.id)),
    [pendingSlips, selectedSlipIds]
  );

  // Parsed item rates: Record<itemId, number>
  const parsedItemRates = useMemo(() => {
    const r: Record<number, number> = {};
    for (const [k, v] of Object.entries(itemRates)) {
      r[Number(k)] = parseFloat(v) || 0;
    }
    return r;
  }, [itemRates]);

  // Max payable per slip (using weighted avg rate)
  const maxPayablePerSlip = useMemo(() => {
    const m: Record<number, number> = {};
    for (const slip of selectedSlips) {
      const wRate = weightedRateForSlip(slip, parsedItemRates);
      m[slip.id] = Math.max(0, slip.totalJamaQty * wRate - slip.paidAmount);
    }
    return m;
  }, [selectedSlips, parsedItemRates]);

  const totalMaxPayable = useMemo(
    () => Object.values(maxPayablePerSlip).reduce((s, v) => s + v, 0),
    [maxPayablePerSlip]
  );

  const totalAmount = parseFloat(totalAmountStr) || 0;
  const distribution = useMemo(
    () => distributeAmount(selectedSlips, parsedItemRates, totalAmount),
    [selectedSlips, parsedItemRates, totalAmount]
  );

  const handleKarigarSelect = (conn: any) => {
    setSelectedConnection(conn);
    setSelectedSlipIds(new Set());
    setItemRates({});
    setTotalAmountStr("");
    setStep("select_slips");
    setSearch("");
  };

  const toggleSlip = (id: number) => {
    setSelectedSlipIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSlipsNext = () => {
    if (selectedSlipIds.size === 0) {
      toast({ title: "Kam se kam ek slip select karo", variant: "destructive" });
      return;
    }
    // Pre-fill item rates from finalRate (previously set) or ratePerPc (from slip creation)
    const preRates: Record<number, string> = {};
    for (const slip of selectedSlips) {
      for (const item of slip.items) {
        if (!itemRates[item.id]) {
          const hint = item.finalRate ?? item.ratePerPc;
          if (hint && hint > 0) preRates[item.id] = String(hint);
        }
      }
    }
    if (Object.keys(preRates).length > 0) {
      setItemRates((prev) => ({ ...prev, ...preRates }));
    }
    setStep("enter_payment");
  };

  const handleScreenshot = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgUploading(true);
    try {
      setScreenshotBase64(await compressImage(file));
    } catch {
      toast({ title: "Image load nahi hua", variant: "destructive" });
    } finally {
      setImgUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [toast]);

  const handleSubmit = async () => {
    // Validate: all items on all selected slips must have rates
    for (const slip of selectedSlips) {
      for (const item of slip.items) {
        const rate = parsedItemRates[item.id] ?? 0;
        if (rate <= 0) {
          toast({
            title: `"${item.itemName}" ka rate daalo (${slip.slipNumber})`,
            variant: "destructive",
          });
          return;
        }
      }
    }
    if (totalAmount <= 0) {
      toast({ title: "Payment amount daalo", variant: "destructive" });
      return;
    }

    const slipPayments = selectedSlips
      .map((slip) => ({
        jobSlipId: slip.id,
        itemRates: slip.items.map((item) => ({
          itemId: item.id,
          finalRate: parsedItemRates[item.id] ?? 0,
        })),
        amount: distribution[slip.id] ?? 0,
      }))
      .filter((sp) => sp.amount > 0);

    if (slipPayments.length === 0) {
      toast({ title: "Koi payment nahi", variant: "destructive" });
      return;
    }

    try {
      await recordPaymentMutation.mutateAsync({
        connectionId: selectedConnection.id,
        toUserId: selectedConnection.connectedUser.id,
        totalAmount,
        slipPayments,
        note: note || undefined,
        screenshotUrl: screenshotBase64 || undefined,
      });
      qc.invalidateQueries({ queryKey: getGetPaymentsQueryKey() });
      qc.invalidateQueries({ queryKey: ["pending-job-slips"] });
      toast({ title: `✓ Rs. ${totalAmount.toLocaleString("en-IN")} payment record ho gaya!` });
      navigate("/payments");
    } catch {
      toast({ title: "Payment record nahi hua — dobara koshish karo", variant: "destructive" });
    }
  };

  const goBack = () => {
    if (step === "select_slips") { setStep("select_karigar"); setSearch(""); }
    else if (step === "enter_payment") setStep("select_slips");
    else navigate("/payments");
  };

  const stepIndex = { select_karigar: 0, select_slips: 1, enter_payment: 2 }[step];

  return (
    <Layout>
      <div className="pb-32">
        {/* Header */}
        <header className="bg-primary text-primary-foreground px-4 pt-10 pb-5 rounded-b-3xl shadow-md">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={goBack} className="bg-primary-foreground/20 p-2 rounded-full shrink-0">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold">Payment Karo</h1>
              <p className="text-primary-foreground/60 text-xs">
                {step === "select_karigar" ? "Karigar chuno"
                  : step === "select_slips" ? `${selectedConnection?.connectedUser?.name ?? "Karigar"} ki slips`
                  : "Item-wise rate daalo"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn(
                "h-1.5 flex-1 rounded-full transition-all",
                i < stepIndex ? "bg-white" : i === stepIndex ? "bg-white/70" : "bg-white/25"
              )} />
            ))}
          </div>
        </header>

        {/* ── STEP 1: Select Karigar ── */}
        {step === "select_karigar" && (
          <div className="px-4 pt-4">
            <div className="relative mb-4">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Karigar ka naam search karo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                className="w-full h-12 pl-10 pr-4 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-2">
              {filteredConns.length === 0 ? (
                <div className="text-center py-14 text-muted-foreground text-sm">
                  <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  {search ? "Koi nahi mila" : "Koi connected user nahi hai"}
                </div>
              ) : filteredConns.map((conn) => (
                <button
                  key={conn.id}
                  onClick={() => handleKarigarSelect(conn)}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-card border border-border hover:bg-accent/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">
                      {(conn.connectedUser?.name || conn.connectedUser?.code || "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{conn.connectedUser?.name ?? conn.connectedUser?.code ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{conn.roleLabel}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2: Select Job Slips ── */}
        {step === "select_slips" && (
          <div className="px-4 pt-4">
            {loadingSlips ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-2xl" />)}
              </div>
            ) : !pendingSlips || pendingSlips.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <CheckCircle2 className="w-14 h-14 mx-auto mb-3 text-emerald-400 opacity-60" />
                <p className="font-semibold text-base text-foreground">Koi pending payment nahi!</p>
                <p className="text-sm mt-1">Ya to maal wapis nahi aaya, ya payment ho chuka hai</p>
                <Button className="mt-5" variant="outline" onClick={() => setStep("select_karigar")}>
                  Dusra Karigar Chuno
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground font-medium">
                    {pendingSlips.length} slip available — select karo:
                  </p>
                  {pendingSlips.length > 1 && (
                    <button
                      onClick={() => setSelectedSlipIds(
                        selectedSlipIds.size === pendingSlips.length
                          ? new Set()
                          : new Set(pendingSlips.map((s) => s.id))
                      )}
                      className="text-xs text-primary font-bold"
                    >
                      {selectedSlipIds.size === pendingSlips.length ? "Sab Hatao" : "Sab Chuno"}
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {pendingSlips.map((slip) => {
                    const isSelected = selectedSlipIds.has(slip.id);
                    const alreadyPaid = slip.paidAmount > 0;
                    return (
                      <button
                        key={slip.id}
                        onClick={() => toggleSlip(slip.id)}
                        className={cn(
                          "w-full text-left p-4 rounded-2xl border-2 transition-all",
                          isSelected ? "border-primary bg-primary/5" : "border-border bg-card"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <span className={cn("text-sm font-bold", isSelected ? "text-primary" : "text-foreground")}>
                                {slip.slipNumber}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(slip.createdAt), "d MMM yyyy")}
                              </span>
                              {alreadyPaid && (
                                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                                  Partial Paid
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Package className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="text-xs text-muted-foreground">
                                Bheja: <span className="font-semibold text-foreground">{slip.totalIssuedQty}pc</span>
                                {slip.items.length > 0 && (
                                  <span className="ml-1">({slip.items.length} item{slip.items.length > 1 ? "s" : ""})</span>
                                )}
                              </span>
                            </div>
                            {/* Show item names preview */}
                            {slip.items.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {slip.items.map((item) => (
                                  <span key={item.id} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                                    {item.itemName} ({item.totalQty}pc)
                                  </span>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center gap-1.5">
                              <RotateCcw className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span className="text-xs text-muted-foreground">
                                Wapis aaya: <span className="font-bold text-emerald-600">{slip.totalJamaQty}pc</span>
                                <span className="ml-1">({slip.returnSlips.length} return slip)</span>
                              </span>
                            </div>

                            {alreadyPaid && (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <Banknote className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                <span className="text-xs text-amber-700 font-medium">
                                  Pehle diya: ₹{slip.paidAmount.toLocaleString("en-IN")}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className={cn(
                            "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                            isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                          )}>
                            {isSelected && <span className="text-white text-xs font-bold">✓</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── STEP 3: Per-item Rate + Payment Amount ── */}
        {step === "enter_payment" && (
          <div className="px-4 pt-4 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
              <p className="text-xs text-blue-700 font-semibold">
                Har item ka final rate daalo — phir total payment amount:
              </p>
            </div>

            {selectedSlips.map((slip) => {
              const maxPayable = maxPayablePerSlip[slip.id] ?? 0;
              const allocated = distribution[slip.id] ?? 0;
              const allItemsHaveRate = slip.items.every((item) => (parsedItemRates[item.id] ?? 0) > 0);
              const wRate = weightedRateForSlip(slip, parsedItemRates);

              return (
                <div key={slip.id} className="bg-card border border-border rounded-2xl overflow-hidden">
                  {/* Slip header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border">
                    <div>
                      <span className="font-bold text-sm">{slip.slipNumber}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {format(new Date(slip.createdAt), "d MMM yyyy")}
                      </span>
                    </div>
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                      Wapis: {slip.totalJamaQty}pc
                    </span>
                  </div>

                  <div className="px-4 py-3 space-y-3">
                    {/* Per-item rate inputs */}
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-primary" /> Item-wise Final Rate
                      </p>
                      {slip.items.map((item) => {
                        const rate = parsedItemRates[item.id] ?? 0;
                        return (
                          <div key={item.id} className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-muted-foreground mb-0.5 truncate">
                                {item.itemName}
                                <span className="ml-1 text-foreground/60">({item.totalQty}pc)</span>
                              </p>
                              <div className="relative">
                                <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  value={itemRates[item.id] ?? ""}
                                  onChange={(e) =>
                                    setItemRates((prev) => ({ ...prev, [item.id]: e.target.value }))
                                  }
                                  className="w-full h-9 pl-7 pr-3 rounded-lg border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                              </div>
                            </div>
                            <div className="shrink-0 text-right pt-4">
                              <p className={cn(
                                "text-xs font-bold",
                                rate > 0 ? "text-emerald-600" : "text-muted-foreground"
                              )}>
                                {rate > 0
                                  ? `= ₹${(item.totalQty * rate).toLocaleString("en-IN")}`
                                  : "—"
                                }
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Return slips info */}
                    {slip.returnSlips.length > 0 && (
                      <div className="space-y-1 border-t border-dashed border-border pt-2">
                        <p className="text-xs text-muted-foreground font-medium">Return Slips:</p>
                        {slip.returnSlips.map((rs) => (
                          <div key={rs.returnSlipId} className="flex justify-between text-xs text-muted-foreground">
                            <span className="text-emerald-600 font-medium">{rs.returnSlipNumber ?? `#${rs.returnSlipId}`}</span>
                            <span>{rs.jamaQty}pc wapis</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {slip.paidAmount > 0 && (
                      <div className="text-xs text-amber-600 font-medium border-t border-border pt-2">
                        Pehle diya: ₹{slip.paidAmount.toLocaleString("en-IN")}
                      </div>
                    )}

                    {/* Max payable summary */}
                    {allItemsHaveRate && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-emerald-700">
                            {slip.totalJamaQty}pc × avg ₹{wRate.toFixed(2)}/pc
                            {slip.paidAmount > 0 ? ` − ₹${slip.paidAmount.toLocaleString("en-IN")}` : ""}
                          </span>
                          <span className="font-bold text-emerald-700">Max ₹{maxPayable.toLocaleString("en-IN")}</span>
                        </div>
                        {allocated > 0 && (
                          <div className="flex justify-between items-center mt-1 text-xs">
                            <span className="text-emerald-600">Is payment mein dega:</span>
                            <span className={cn(
                              "font-bold",
                              allocated >= maxPayable - 0.01 ? "text-emerald-700" : "text-amber-600"
                            )}>
                              ₹{allocated.toLocaleString("en-IN")}
                              {allocated >= maxPayable - 0.01 && " ✓"}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Total amount input */}
            <div className="bg-card border-2 border-primary/30 rounded-2xl p-4">
              <label className="text-sm font-bold text-foreground block mb-3">
                Total Payment Amount
              </label>
              <div className="relative mb-3">
                <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={totalAmountStr}
                  onChange={(e) => setTotalAmountStr(e.target.value)}
                  className="w-full h-14 pl-10 pr-4 rounded-xl border border-input bg-background text-xl font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {totalMaxPayable > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Max payable:</span>
                  <button
                    onClick={() => setTotalAmountStr(String(Math.round(totalMaxPayable * 100) / 100))}
                    className="font-bold text-primary underline underline-offset-2"
                  >
                    ₹{totalMaxPayable.toLocaleString("en-IN")} (tap to fill)
                  </button>
                </div>
              )}
            </div>

            {/* Note */}
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Note (optional)</label>
              <input
                type="text"
                placeholder="e.g. NEFT / Cash / UPI..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Screenshot */}
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Payment Screenshot (optional)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleScreenshot}
                className="hidden"
              />
              {screenshotBase64 ? (
                <div className="relative">
                  <img
                    src={screenshotBase64}
                    alt="Screenshot"
                    className="w-full max-h-48 object-cover rounded-xl border border-border"
                  />
                  <button
                    onClick={() => setScreenshotBase64("")}
                    className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imgUploading}
                  className="w-full h-20 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  <ImagePlus className="w-6 h-6" />
                  <span className="text-xs font-medium">
                    {imgUploading ? "Upload ho raha hai..." : "Screenshot add karo"}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom Action Bar ── */}
      {step === "select_slips" && selectedSlipIds.size > 0 && (
        <div className="fixed bottom-16 left-0 right-0 p-4 bg-background border-t border-border shadow-lg z-40">
          <div className="max-w-md mx-auto">
            <Button
              onClick={handleSlipsNext}
              className="w-full h-12 rounded-xl text-base font-semibold gap-2"
            >
              {selectedSlipIds.size} slip select kiya — Aage Badho
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </div>
      )}

      {step === "enter_payment" && (
        <div className="fixed bottom-16 left-0 right-0 p-4 bg-background border-t border-border shadow-lg z-40">
          <div className="max-w-md mx-auto space-y-2">
            {totalAmount > 0 && (
              <p className="text-xs text-center text-muted-foreground">
                ₹{totalAmount.toLocaleString("en-IN")} bhej rahe ho
                {selectedSlips.length > 1 ? ` — ${selectedSlips.length} slips mein distribute hoga` : ""}
              </p>
            )}
            <Button
              onClick={handleSubmit}
              disabled={recordPaymentMutation.isPending || totalAmount <= 0}
              className="w-full h-12 rounded-xl text-base font-semibold bg-emerald-600 hover:bg-emerald-700 gap-2"
            >
              <Banknote className="w-5 h-5" />
              {recordPaymentMutation.isPending ? "Record ho raha hai..." : "Payment Record Karo ✓"}
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}
