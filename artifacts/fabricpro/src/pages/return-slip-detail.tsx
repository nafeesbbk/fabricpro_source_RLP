import { useRoute, useLocation } from "wouter";
import { useGetReturnSlip, useMarkReturnSlipViewed, useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertCircle, Eye, CheckCheck } from "lucide-react";
import { generateReturnSlipPdf } from "@/lib/print-utils";
import { PrintShareButton } from "@/components/print-share-button";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function ReturnSlipDetail() {
  const [, params] = useRoute("/slips/return/:id");
  const [, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const { toast } = useToast();
  const qc = useQueryClient();

  const id = parseInt(params?.id ?? "0", 10);
  const { data: slip, isLoading } = useGetReturnSlip(id);
  const markViewed = useMarkReturnSlipViewed();

  const s = slip as any;
  const isSeth = user?.id === s?.sethId;
  const isKarigar = user?.id === s?.karigarId;

  async function handleView() {
    try {
      await markViewed.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: ["getReturnSlip", id] });
      qc.invalidateQueries({ queryKey: ["getReturnSlips"] });
      toast({ title: "Dekh liya", description: "Karigar ko notification bhej diya" });
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="px-4 pt-20">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-40 w-full rounded-2xl mb-3" />
          <Skeleton className="h-40 w-full rounded-2xl" />
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

  const totalQty = (s.entries ?? []).reduce(
    (sum: number, e: any) => sum + (e.jamaQty || 0) + (e.damageQty || 0) + (e.shortageQty || 0),
    0
  );
  const totalShortageAmt = (s.entries ?? []).reduce(
    (sum: number, e: any) =>
      sum + (e.shortageQty || 0) * (e.ratePerPc || 0),
    0
  );

  return (
    <Layout>
      <div className="pb-32">
        <header className="bg-orange-500 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
          <div className="flex items-center gap-3">
            <button onClick={() => setLocation("/slips")} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold">{s.slipNumber}</h1>
              <p className="text-white/70 text-sm">{format(new Date(s.createdAt), "dd MMM yyyy, hh:mm a")}</p>
            </div>
            <PrintShareButton
              generatePdf={() => generateReturnSlipPdf(s)}
              filename={`${s.slipNumber ?? "return-slip"}.pdf`}
            />
          </div>
        </header>

        <div className="px-4 pt-4 space-y-4">
          <div className={`rounded-2xl p-4 ${s.viewedAt ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
            <div className="flex items-center gap-2">
              {s.viewedAt ? <CheckCheck className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              <div>
                <p className="font-bold">{s.viewedAt ? "Seth ne dekh liya" : "Seth ne abhi nahi dekha"}</p>
                {s.viewedAt && <p className="text-sm opacity-80">{format(new Date(s.viewedAt), "dd MMM, hh:mm a")}</p>}
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Parties</h3>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-600 shrink-0">
                {(s.karigar?.name || s.karigar?.code || "K")[0].toUpperCase()}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Karigar (Bhejne Wala)</p>
                <p className="font-semibold">{s.karigar?.name || s.karigar?.code}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600 shrink-0">
                {(s.seth?.name || s.seth?.code || "S")[0].toUpperCase()}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Seth (Lene Wala)</p>
                <p className="font-semibold">{s.seth?.name || s.seth?.code}</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold">Slip-wise Hisaab</h3>
            </div>

            {(s.entries ?? []).map((entry: any, i: number) => {
              const js = entry.jobSlip;
              const shortageAmt = (entry.shortageQty || 0) * (entry.ratePerPc || 0);
              return (
                <div key={entry.id} className={`p-4 ${i < (s.entries ?? []).length - 1 ? "border-b border-border" : ""}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold font-mono text-primary">{js?.slipNumber || `Slip #${entry.jobSlipId}`}</p>
                      {(js?.items ?? []).map((item: any) => (
                        <p key={item.id} className="text-sm text-muted-foreground">{item.itemName} — {item.totalQty?.toLocaleString()} pcs</p>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="text-center bg-green-50 rounded-xl p-2">
                      <p className="text-xs text-green-600">Jama</p>
                      <p className="font-bold text-green-700">{(entry.jamaQty || 0).toLocaleString()}</p>
                    </div>
                    <div className="text-center bg-orange-50 rounded-xl p-2">
                      <p className="text-xs text-orange-600">Damage</p>
                      <p className="font-bold text-orange-700">{(entry.damageQty || 0).toLocaleString()}</p>
                    </div>
                    <div className="text-center bg-red-50 rounded-xl p-2">
                      <p className="text-xs text-red-600">Shortage</p>
                      <p className="font-bold text-red-700">{(entry.shortageQty || 0).toLocaleString()}</p>
                    </div>
                  </div>

                  {entry.shortageQty > 0 && entry.ratePerPc && (
                    <div className="mt-2 bg-red-50 rounded-xl px-3 py-2">
                      <p className="text-xs text-red-600">
                        Shortage Deduction: {entry.shortageQty} × ₹{parseFloat(entry.ratePerPc).toFixed(2)} = <span className="font-bold">₹{shortageAmt.toLocaleString()}</span>
                      </p>
                    </div>
                  )}

                  {entry.notes && (
                    <p className="text-xs text-muted-foreground italic mt-2">{entry.notes}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <h3 className="font-semibold mb-3">Kul Mila ke</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted rounded-xl p-3 text-center">
                <p className="text-xs text-muted-foreground">Total Wapas</p>
                <p className="text-xl font-bold">{totalQty.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">pcs</p>
              </div>
              {totalShortageAmt > 0 && (
                <div className="bg-red-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-red-600">Shortage Deduction</p>
                  <p className="text-xl font-bold text-red-700">₹{totalShortageAmt.toLocaleString()}</p>
                  <p className="text-xs text-red-600">payment se minus</p>
                </div>
              )}
            </div>
          </div>

          {s.notes && (
            <div className="bg-muted/50 rounded-2xl p-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{s.notes}</p>
            </div>
          )}
        </div>
      </div>

      {isSeth && !s.viewedAt && (
        <div className="fixed bottom-16 left-0 right-0 p-4 bg-background border-t border-border shadow-lg z-40">
          <div className="max-w-md mx-auto">
            <Button
              onClick={handleView}
              disabled={markViewed.isPending}
              className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-base font-semibold"
            >
              <Eye className="h-5 w-5 mr-2" /> Maal Dekh Liya — OK ✓
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}
