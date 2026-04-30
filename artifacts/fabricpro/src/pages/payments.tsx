import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetPayments, getGetPaymentsQueryKey, useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, IndianRupee, ArrowUp, ArrowDown, Image,
  MoreVertical, Pencil, Trash2, Loader2, Printer, Share2,
} from "lucide-react";
import { generatePaymentPdf, sharePdf } from "@/lib/print-utils";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "").replace(/\/[^/]*$/, "") || "";

export default function Payments() {
  const { data: payments, isLoading } = useGetPayments({
    query: { queryKey: getGetPaymentsQueryKey() }
  });
  const { data: me } = useGetMe();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [deletePayment, setDeletePayment] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleDelete() {
    if (!deletePayment) return;
    setDeleteLoading(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`${API_BASE}/api/payments/${deletePayment.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Delete failed");
      }
      toast({ title: "Payment delete ho gaya" });
      setDeletePayment(null);
      queryClient.invalidateQueries({ queryKey: getGetPaymentsQueryKey() });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <Layout>
      <div className="pb-24">
        <header className="bg-primary text-primary-foreground px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">Payments</h1>
              <p className="text-primary-foreground/70 text-sm mt-1">Sab lena-dena</p>
            </div>
            <Link href="/payments/new">
              <Button size="icon" variant="secondary" className="rounded-full h-12 w-12 shadow-lg">
                <Plus className="h-6 w-6" />
              </Button>
            </Link>
          </div>
        </header>

        <div className="px-4 pt-4 space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)
          ) : !payments || payments.length === 0 ? (
            <div className="text-center py-16">
              <IndianRupee className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground font-medium">Koi payment nahi mila</p>
              <Link href="/payments/new">
                <Button className="mt-4">Payment Record Karo</Button>
              </Link>
            </div>
          ) : (
            payments.map((payment) => {
              const isOutgoing = me && payment.fromUserId === me.id;
              const canEdit = isOutgoing;
              return (
                <div key={payment.id} className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`p-2.5 rounded-full shrink-0 ${isOutgoing ? "bg-red-100" : "bg-green-100"}`}>
                        {isOutgoing
                          ? <ArrowDown className="h-5 w-5 text-red-600" />
                          : <ArrowUp className="h-5 w-5 text-green-600" />
                        }
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">
                          {isOutgoing
                            ? `${payment.toUser?.name ?? payment.toUser?.code ?? "User"} ko`
                            : `${payment.fromUser?.name ?? payment.fromUser?.code ?? "User"} se`
                          }
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {payment.note ?? (payment.jobSlip ? `Slip: ${payment.jobSlip.slipNumber}` : "Payment")}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-1 shrink-0">
                      <div className="text-right">
                        <p className={`text-lg font-bold ${isOutgoing ? "text-red-600" : "text-green-600"}`}>
                          {isOutgoing ? "-" : "+"} ₹{Number(payment.amount).toLocaleString()}
                        </p>
                        {payment.screenshotUrl && (
                          <div className="flex items-center gap-1 justify-end mt-1 text-xs text-muted-foreground">
                            <Image className="h-3 w-3" />
                            <span>Screenshot</span>
                          </div>
                        )}
                      </div>

                      {canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 mt-0.5">
                              <MoreVertical className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[170px]">
                            <DropdownMenuItem
                              onClick={() => {
                                const bytes = generatePaymentPdf({ ...payment, _isOutgoing: isOutgoing });
                                const blob = new Blob([bytes], { type: "application/pdf" });
                                const url = URL.createObjectURL(blob);
                                window.open(url, "_blank");
                                setTimeout(() => URL.revokeObjectURL(url), 10000);
                              }}
                              className="gap-2"
                            >
                              <Printer className="h-4 w-4" />
                              Print karo
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={async () => {
                                const bytes = generatePaymentPdf({ ...payment, _isOutgoing: isOutgoing });
                                await sharePdf(bytes, `payment-${payment.id}.pdf`);
                              }}
                              className="gap-2"
                            >
                              <Share2 className="h-4 w-4 text-primary" />
                              PDF Share karo
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => navigate(`/payments/edit/${payment.id}`)}
                              className="gap-2"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit Karo
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeletePayment(payment)}
                              className="gap-2 text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete Karo
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-border">
                    <span className="text-xs font-mono text-muted-foreground">{payment.paymentId}</span>
                    {payment.createdAt && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(payment.createdAt), "dd MMM yyyy")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Delete Confirm ── */}
      <AlertDialog open={!!deletePayment} onOpenChange={(open) => { if (!open) setDeletePayment(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Payment Delete Karein?</AlertDialogTitle>
            <AlertDialogDescription>
              ₹{deletePayment ? Number(deletePayment.amount).toLocaleString() : ""} ka payment hamesha ke liye delete ho jayega.
              {deletePayment?.jobSlipId && (
                <span className="block mt-1 text-amber-600 font-medium">
                  Slip ka balance bhi wapas ho jayega — dobara payment kar sakenge.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Nahi</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Deleting...</>
                : "Haan, Delete Karo"
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
