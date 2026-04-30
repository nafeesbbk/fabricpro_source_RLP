import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPaymentsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Package, RotateCcw, Tag, IndianRupee, Loader2,
  AlertCircle, Banknote, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "").replace(/\/[^/]*$/, "") || "";

function usePaymentDetail(id: string) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const token = localStorage.getItem("fabricpro_token");
    fetch(`${API_BASE}/api/payments/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return { data, loading, error };
}

export default function EditPayment() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: payment, loading, error } = usePaymentDetail(params.id);

  // Per-item rate state
  const [itemRates, setItemRates] = useState<Record<number, string>>({});
  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Pre-fill when data loads
  useEffect(() => {
    if (!payment || initialized) return;
    setAmountStr(String(Number(payment.amount)));
    setNote(payment.note ?? "");

    if (payment.jobSlipDetail) {
      const rates: Record<number, string> = {};
      for (const item of payment.jobSlipDetail.items) {
        const r = item.finalRate ?? item.ratePerPc;
        if (r && r > 0) rates[item.id] = String(r);
      }
      setItemRates(rates);
    }
    setInitialized(true);
  }, [payment, initialized]);

  const parsedItemRates = useMemo(() => {
    const r: Record<number, number> = {};
    for (const [k, v] of Object.entries(itemRates)) {
      r[Number(k)] = parseFloat(v) || 0;
    }
    return r;
  }, [itemRates]);

  const detail = payment?.jobSlipDetail ?? null;

  // Per-item jama bill (proportional to issued qty — all jama attributed to items proportionally)
  const totalIssuedQty = useMemo(
    () => detail?.items?.reduce((s: number, i: any) => s + i.totalQty, 0) ?? 0,
    [detail]
  );

  const perItemJamaQty = useMemo(() => {
    if (!detail || totalIssuedQty === 0) return {};
    const result: Record<number, number> = {};
    for (const item of detail.items) {
      result[item.id] = (item.totalQty / totalIssuedQty) * detail.totalJamaQty;
    }
    return result;
  }, [detail, totalIssuedQty]);

  const jamaBill = useMemo(() => {
    if (!detail) return 0;
    return detail.items.reduce((s: number, item: any) => {
      const rate = parsedItemRates[item.id] ?? 0;
      const jQty = perItemJamaQty[item.id] ?? 0;
      return s + jQty * rate;
    }, 0);
  }, [detail, parsedItemRates, perItemJamaQty]);

  const maxPayable = useMemo(() => {
    if (!detail) return Infinity;
    return Math.max(0, jamaBill - detail.otherPaidAmount);
  }, [detail, jamaBill]);

  const amount = parseFloat(amountStr) || 0;
  const isOverpaid = detail ? amount > maxPayable + 0.5 : false;

  async function handleSave() {
    if (amount <= 0) {
      toast({ title: "Amount daalo", variant: "destructive" });
      return;
    }
    if (detail) {
      for (const item of detail.items) {
        if ((parsedItemRates[item.id] ?? 0) <= 0) {
          toast({ title: `"${item.itemName}" ka rate daalo`, variant: "destructive" });
          return;
        }
      }
    }

    setSaving(true);
    try {
      const body: any = { amount, note };
      if (detail) {
        body.itemRates = detail.items.map((item: any) => ({
          itemId: item.id,
          finalRate: parsedItemRates[item.id] ?? 0,
        }));
      }

      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`${API_BASE}/api/payments/${params.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save nahi hua");
      }

      toast({ title: "Payment update ho gaya ✓" });
      qc.invalidateQueries({ queryKey: getGetPaymentsQueryKey() });
      navigate("/payments");
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div className="pb-32">
        {/* Header */}
        <header className="bg-primary text-primary-foreground px-4 pt-10 pb-5 rounded-b-3xl shadow-md">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/payments")}
              className="bg-primary-foreground/20 p-2 rounded-full shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold">Payment Edit Karo</h1>
              <p className="text-primary-foreground/60 text-xs">
                {payment?.jobSlip?.slipNumber
                  ? `Slip: ${payment.jobSlip.slipNumber}`
                  : payment?.paymentId ?? "..."}
              </p>
            </div>
          </div>
        </header>

        <div className="px-4 pt-4 space-y-4">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))
          ) : error ? (
            <div className="text-center py-16">
              <AlertCircle className="h-12 w-12 mx-auto text-destructive/40 mb-3" />
              <p className="text-muted-foreground">{error}</p>
            </div>
          ) : payment && (
            <>
              {/* Who + date info */}
              <div className="bg-card border border-border rounded-2xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Kisko bheja</p>
                  <p className="font-bold text-foreground">
                    {payment.toUser?.name ?? payment.toUser?.code ?? "—"}
                  </p>
                </div>
                {payment.createdAt && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {format(new Date(payment.createdAt), "dd MMM yyyy")}
                  </span>
                )}
              </div>

              {/* Job Slip Details — per item rate editing */}
              {detail && (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  {/* Slip header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border">
                    <div>
                      <span className="font-bold text-sm">{detail.slipNumber ?? "Job Slip"}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                        Wapis: {detail.totalJamaQty}pc
                      </span>
                    </div>
                  </div>

                  <div className="px-4 py-3 space-y-3">
                    {/* Per-item rate inputs */}
                    {detail.items.map((item: any) => {
                      const jQty = perItemJamaQty[item.id] ?? 0;
                      const rate = parsedItemRates[item.id] ?? 0;
                      const itemBill = jQty * rate;

                      return (
                        <div key={item.id} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Package className="w-3.5 h-3.5 text-blue-500" />
                              <span className="text-sm font-semibold text-foreground">
                                {item.itemName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                ({item.totalQty}pc bheja, {jQty.toFixed(1)}pc jama)
                              </span>
                            </div>
                            {rate > 0 && (
                              <span className="text-xs font-mono text-emerald-600 font-semibold">
                                ₹{itemBill.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                              </span>
                            )}
                          </div>
                          <div className="relative">
                            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                            <Input
                              type="number"
                              inputMode="decimal"
                              placeholder="Rate per piece (₹)"
                              value={itemRates[item.id] ?? ""}
                              onChange={(e) =>
                                setItemRates((prev) => ({ ...prev, [item.id]: e.target.value }))
                              }
                              className="pl-8 h-10 text-sm"
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* Jama Bill Summary */}
                    <div className={cn(
                      "rounded-xl px-3 py-2.5 border flex items-center justify-between",
                      jamaBill > 0 ? "bg-emerald-50 border-emerald-200" : "bg-muted/50 border-border"
                    )}>
                      <span className="text-sm font-medium text-muted-foreground">
                        Jama Bill ({detail.totalJamaQty}pc)
                      </span>
                      <span className={cn(
                        "font-bold text-base",
                        jamaBill > 0 ? "text-emerald-700" : "text-muted-foreground"
                      )}>
                        ₹{jamaBill.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </div>

                    {/* Already paid by other payments on this slip */}
                    {detail.otherPaidAmount > 0 && (
                      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <Banknote className="w-3.5 h-3.5 shrink-0" />
                        <span>Doosri payments se ₹{detail.otherPaidAmount.toLocaleString("en-IN")} pehle se diya hai</span>
                      </div>
                    )}

                    {/* Max payable indicator */}
                    {jamaBill > 0 && (
                      <div className="flex items-center justify-between text-xs px-1">
                        <span className="text-muted-foreground">Is payment mein max de sakte ho:</span>
                        <span className="font-bold text-primary">
                          ₹{maxPayable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Payment Amount */}
              <div className="space-y-1.5">
                <Label className="font-semibold">Payment Amount (₹)</Label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="Kitna diya"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    className={cn("pl-9 h-12 text-base font-bold", isOverpaid && "border-red-400 focus-visible:ring-red-400")}
                  />
                </div>
                {isOverpaid && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Amount jama bill (₹{jamaBill.toLocaleString("en-IN", { maximumFractionDigits: 0 })}) se zyada hai
                  </p>
                )}
                {!isOverpaid && amount > 0 && detail && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Baaki: ₹{Math.max(0, maxPayable - amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })} remaining</span>
                  </div>
                )}
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <Label className="font-semibold">Note (optional)</Label>
                <Input
                  placeholder="Payment ke baare mein kuch likhna ho to..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        {/* Save Button — fixed at bottom */}
        {!loading && !error && payment && (
          <div className="fixed bottom-16 left-0 right-0 px-4 py-3 bg-background/90 backdrop-blur-sm border-t border-border z-40">
            <Button
              className="w-full h-12 text-base font-bold"
              onClick={handleSave}
              disabled={saving || amount <= 0}
            >
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...</>
                : `₹${amount > 0 ? amount.toLocaleString("en-IN") : "0"} Save Karo`
              }
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
