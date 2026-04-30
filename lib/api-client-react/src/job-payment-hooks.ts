import { useQuery, useMutation } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface JobSlipPaymentEntry {
  returnSlipId: number;
  returnSlipNumber: string | null;
  returnDate: string | null;
  jamaQty: number;
  damageQty: number;
  shortageQty: number;
  noWorkQty: number;
}

export interface PendingJobSlip {
  id: number;
  slipNumber: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  items: Array<{
    id: number;
    itemName: string;
    totalQty: number;
    ratePerPc: number | null;
    finalRate: number | null;
  }>;
  totalIssuedQty: number;
  totalJamaQty: number;
  paidAmount: number;
  returnSlips: JobSlipPaymentEntry[];
}

export interface ItemRateInput {
  itemId: number;
  finalRate: number;
}

export interface SlipPaymentInput {
  jobSlipId: number;
  itemRates: ItemRateInput[];
  amount: number;
}

export interface RecordJobPaymentBody {
  connectionId: number;
  toUserId: number;
  totalAmount: number;
  slipPayments: SlipPaymentInput[];
  note?: string;
  screenshotUrl?: string;
}

export function useGetPendingJobSlips(
  params: { connectionId: number },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ["pending-job-slips", params.connectionId],
    queryFn: () =>
      customFetch<PendingJobSlip[]>(
        `/api/payments/pending-job-slips?connectionId=${params.connectionId}`
      ),
    enabled: options?.enabled !== false && params.connectionId > 0,
  });
}

export function useRecordJobPayment() {
  return useMutation({
    mutationFn: (body: RecordJobPaymentBody) =>
      customFetch<{ success: boolean; paymentsCreated: number }>(
        "/api/payments/record-job-payment",
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      ),
  });
}
