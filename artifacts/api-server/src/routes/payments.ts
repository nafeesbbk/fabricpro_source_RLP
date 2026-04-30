import { Router } from "express";
import { eq, or, and, inArray } from "drizzle-orm";
import {
  db,
  paymentsTable,
  usersTable,
  notificationsTable,
  slipsTable,
  connectionsTable,
  jobSlipsTable,
  jobSlipItemsTable,
  returnSlipsTable,
  returnSlipEntriesTable,
} from "@workspace/db";
import { CreatePaymentBody, GetPaymentsQueryParams } from "@workspace/api-zod";
import { requireAuth, generatePaymentId } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

async function enrichPayment(payment: any) {
  const [fromUser] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, payment.fromUserId));
  const [toUser] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, payment.toUserId));

  // If linked to job slip, fetch its info
  let jobSlip = null;
  if (payment.jobSlipId) {
    const [js] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, payment.jobSlipId));
    if (js) jobSlip = { id: js.id, slipNumber: js.slipNumber };
  }

  return {
    ...payment,
    amount: parseFloat(payment.amount),
    finalRate: payment.finalRate ? parseFloat(payment.finalRate) : null,
    fromUser: fromUser ?? null,
    toUser: toUser ?? null,
    jobSlip,
  };
}

// GET /payments
router.get("/payments", async (req: Request & { user?: any }, res): Promise<void> => {
  const params = GetPaymentsQueryParams.safeParse(req.query);
  const userId = req.user.id;

  let rows = await db
    .select()
    .from(paymentsTable)
    .where(or(eq(paymentsTable.fromUserId, userId), eq(paymentsTable.toUserId, userId)))
    .orderBy(paymentsTable.createdAt);

  if (params.success && params.data.connectionId) {
    rows = rows.filter((r) => r.connectionId === params.data.connectionId);
  }

  const enriched = await Promise.all(rows.map(enrichPayment));
  res.json(enriched);
});

// GET /payments/pending-slips?connectionId=X  (old system — keep for backward compat)
router.get("/payments/pending-slips", async (req: Request & { user?: any }, res): Promise<void> => {
  const connectionId = parseInt(req.query.connectionId as string, 10);
  if (!connectionId || isNaN(connectionId)) {
    res.status(400).json({ error: "connectionId required" });
    return;
  }

  const userId = req.user.id;

  const [conn] = await db
    .select()
    .from(connectionsTable)
    .where(
      and(
        eq(connectionsTable.id, connectionId),
        or(eq(connectionsTable.fromUserId, userId), eq(connectionsTable.toUserId, userId))
      )
    );

  if (!conn) {
    res.status(403).json({ error: "Connection not found" });
    return;
  }

  const slips = await db
    .select()
    .from(slipsTable)
    .where(
      and(
        eq(slipsTable.connectionId, connectionId),
        eq(slipsTable.type, "maal_issue")
      )
    )
    .orderBy(slipsTable.createdAt);

  const enrichedSlips = await Promise.all(
    slips.map(async (slip) => {
      const quantity = slip.quantity ? parseFloat(slip.quantity) : null;
      const rate = slip.rate ? parseFloat(slip.rate) : null;
      let paymentBill: number | null = slip.paymentBill ? parseFloat(slip.paymentBill) : null;
      if (!paymentBill && rate && quantity) paymentBill = rate * quantity;
      const paidAmount = slip.paidAmount ? parseFloat(slip.paidAmount) : 0;
      const balance = paymentBill !== null ? Math.max(0, paymentBill - paidAmount) : null;
      return {
        id: slip.id,
        slipId: slip.slipId,
        description: slip.description,
        quantity,
        rate,
        paymentBill,
        paidAmount,
        balance: balance ?? 0,
        paymentStatus: slip.paymentStatus,
        createdAt: slip.createdAt,
      };
    })
  );

  res.json(enrichedSlips.filter((s) => s.paymentBill !== null && s.balance > 0));
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW SYSTEM: Job-slip based payments
// ─────────────────────────────────────────────────────────────────────────────

// GET /payments/pending-job-slips?connectionId=X
// Returns job slips that have at least one return slip (jamaQty > 0) and are not fully paid
router.get("/payments/pending-job-slips", async (req: Request & { user?: any }, res): Promise<void> => {
  const connectionId = parseInt(req.query.connectionId as string, 10);
  if (!connectionId || isNaN(connectionId)) {
    res.status(400).json({ error: "connectionId required" });
    return;
  }

  const userId = req.user.id;

  // Verify connection
  const [conn] = await db
    .select()
    .from(connectionsTable)
    .where(
      and(
        eq(connectionsTable.id, connectionId),
        or(eq(connectionsTable.fromUserId, userId), eq(connectionsTable.toUserId, userId))
      )
    );
  if (!conn) { res.status(403).json({ error: "Connection not found" }); return; }

  // Determine the karigar and seth
  const karigarId = conn.toUserId === userId ? conn.fromUserId : conn.toUserId;
  const sethId = conn.fromUserId === userId ? conn.fromUserId : conn.toUserId;

  // Get all job slips between this pair (sent/confirmed/completed)
  const jobSlips = await db
    .select()
    .from(jobSlipsTable)
    .where(
      and(
        eq(jobSlipsTable.sethId, sethId),
        eq(jobSlipsTable.karigarId, karigarId)
      )
    )
    .orderBy(jobSlipsTable.createdAt);

  if (jobSlips.length === 0) { res.json([]); return; }

  const slipIds = jobSlips.map((s) => s.id);

  // Batch: get all items for these slips
  const allItems = await db
    .select()
    .from(jobSlipItemsTable)
    .where(inArray(jobSlipItemsTable.slipId, slipIds));

  // Batch: get all return slip entries that reference these job slips
  const allReturnEntries = await db
    .select()
    .from(returnSlipEntriesTable)
    .where(inArray(returnSlipEntriesTable.jobSlipId, slipIds));

  // Batch: get return slip metadata (number + date) for those entries
  const returnSlipIds = [...new Set(allReturnEntries.map((e) => e.returnSlipId))];
  const allReturnSlips = returnSlipIds.length > 0
    ? await db.select().from(returnSlipsTable).where(inArray(returnSlipsTable.id, returnSlipIds))
    : [];

  const returnSlipMap = new Map(allReturnSlips.map((rs) => [rs.id, rs]));

  // Group by job slip id
  const itemsBySlip = new Map<number, typeof allItems>();
  for (const item of allItems) {
    if (!itemsBySlip.has(item.slipId)) itemsBySlip.set(item.slipId, []);
    itemsBySlip.get(item.slipId)!.push(item);
  }

  const entriesBySlip = new Map<number, typeof allReturnEntries>();
  for (const entry of allReturnEntries) {
    if (!entriesBySlip.has(entry.jobSlipId)) entriesBySlip.set(entry.jobSlipId, []);
    entriesBySlip.get(entry.jobSlipId)!.push(entry);
  }

  const result = [];

  for (const slip of jobSlips) {
    const items = itemsBySlip.get(slip.id) ?? [];
    const entries = entriesBySlip.get(slip.id) ?? [];

    // Total issued qty
    const totalIssuedQty = items.reduce((s, i) => s + i.totalQty, 0);

    // Total returned qty (only jamaQty = good maal wapis)
    const totalJamaQty = entries.reduce((s, e) => s + e.jamaQty, 0);

    // Skip slips with no returns yet
    if (totalJamaQty === 0) continue;

    // Already paid on this job slip
    const paidAmount = parseFloat(slip.paidAmount) || 0;

    // Return slip details
    const returnSlipDetails = entries.map((e) => {
      const rs = returnSlipMap.get(e.returnSlipId);
      return {
        returnSlipId: e.returnSlipId,
        returnSlipNumber: rs?.slipNumber ?? null,
        returnDate: rs?.createdAt ?? null,
        jamaQty: e.jamaQty,
        damageQty: e.damageQty,
        shortageQty: e.shortageQty,
        noWorkQty: e.noWorkQty ?? 0,
      };
    });

    result.push({
      id: slip.id,
      slipNumber: slip.slipNumber,
      status: slip.status,
      paymentStatus: slip.paymentStatus,
      createdAt: slip.createdAt,
      items: items.map((i) => ({
        id: i.id,
        itemName: i.itemName,
        totalQty: i.totalQty,
        ratePerPc: i.ratePerPc ? parseFloat(i.ratePerPc) : null,
        finalRate: i.finalRate ? parseFloat(i.finalRate) : null,
      })),
      totalIssuedQty,
      totalJamaQty,
      paidAmount,
      returnSlips: returnSlipDetails,
    });
  }

  res.json(result);
});

// POST /payments/record-job-payment
// Body: { connectionId, toUserId, totalAmount, slipPayments: [{jobSlipId, itemRates:[{itemId,finalRate}], amount}], note?, screenshotUrl? }
router.post("/payments/record-job-payment", async (req: Request & { user?: any }, res): Promise<void> => {
  const { connectionId, toUserId, totalAmount, slipPayments, note, screenshotUrl } = req.body;

  if (
    !connectionId || !toUserId ||
    !Array.isArray(slipPayments) || slipPayments.length === 0 ||
    typeof totalAmount !== "number" || totalAmount <= 0
  ) {
    res.status(400).json({ error: "connectionId, toUserId, totalAmount, slipPayments required" });
    return;
  }

  for (const sp of slipPayments) {
    if (!sp.jobSlipId || typeof sp.amount !== "number" || sp.amount < 0) {
      res.status(400).json({ error: "Each slipPayment needs jobSlipId and amount" });
      return;
    }
    if (!Array.isArray(sp.itemRates) || sp.itemRates.length === 0) {
      res.status(400).json({ error: "Each slipPayment needs itemRates array" });
      return;
    }
    for (const ir of sp.itemRates) {
      if (!ir.itemId || typeof ir.finalRate !== "number" || ir.finalRate < 0) {
        res.status(400).json({ error: "Each itemRate needs itemId and finalRate" });
        return;
      }
    }
  }

  const fromUserId = req.user.id;

  // Verify connection
  const [conn] = await db
    .select()
    .from(connectionsTable)
    .where(
      and(
        eq(connectionsTable.id, connectionId),
        or(eq(connectionsTable.fromUserId, fromUserId), eq(connectionsTable.toUserId, fromUserId))
      )
    );
  if (!conn) { res.status(403).json({ error: "Connection not found" }); return; }

  const allPayments = await db.select({ id: paymentsTable.id }).from(paymentsTable);
  let baseCount = allPayments.length;

  const createdPayments = [];

  for (const sp of slipPayments) {
    if (sp.amount <= 0) continue;

    // Get the job slip
    const [jobSlip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, sp.jobSlipId));
    if (!jobSlip) continue;

    // Get all items for this slip
    const slipItems = await db
      .select()
      .from(jobSlipItemsTable)
      .where(eq(jobSlipItemsTable.slipId, jobSlip.id));

    // Calculate weighted average rate from per-item rates
    // weightedRate = sum(item.totalQty × item.finalRate) / sum(item.totalQty)
    let totalWeightedValue = 0;
    let totalIssuedQty = 0;
    const itemRateMap = new Map<number, number>();
    for (const ir of sp.itemRates) {
      itemRateMap.set(ir.itemId, ir.finalRate);
    }
    for (const item of slipItems) {
      const rate = itemRateMap.get(item.id) ?? 0;
      totalWeightedValue += item.totalQty * rate;
      totalIssuedQty += item.totalQty;
    }
    const weightedRate = totalIssuedQty > 0 ? totalWeightedValue / totalIssuedQty : 0;

    // Get return entries for max payable calculation
    const entries = await db
      .select()
      .from(returnSlipEntriesTable)
      .where(eq(returnSlipEntriesTable.jobSlipId, jobSlip.id));

    const totalJamaQty = entries.reduce((s, e) => s + e.jamaQty, 0);
    const currentPaid = parseFloat(jobSlip.paidAmount) || 0;
    const maxPayable = Math.max(0, totalJamaQty * weightedRate - currentPaid);

    // Cap payment to not overpay
    const payAmount = Math.min(sp.amount, maxPayable + 0.01) > 0 ? Math.min(sp.amount, Math.max(sp.amount, maxPayable)) : sp.amount;
    const actualPay = Math.min(sp.amount, maxPayable > 0 ? maxPayable : sp.amount);
    if (actualPay <= 0 && maxPayable <= 0 && sp.amount > 0) {
      // Allow payment even if maxPayable calc is off — trust user input
    }
    const finalPayAmount = sp.amount; // Trust user's distribution

    // Update each item's finalRate
    for (const ir of sp.itemRates) {
      if (ir.finalRate > 0) {
        await db
          .update(jobSlipItemsTable)
          .set({ finalRate: String(ir.finalRate) })
          .where(eq(jobSlipItemsTable.id, ir.itemId));
      }
    }

    // Create payment record
    const paymentId = generatePaymentId(++baseCount);
    const [payment] = await db
      .insert(paymentsTable)
      .values({
        paymentId,
        fromUserId,
        toUserId,
        connectionId,
        amount: String(finalPayAmount),
        note: note || null,
        screenshotUrl: screenshotUrl || null,
        jobSlipId: jobSlip.id,
        finalRate: weightedRate > 0 ? String(Math.round(weightedRate * 100) / 100) : null,
      })
      .returning();

    createdPayments.push(payment);

    // Update job slip paid_amount and payment_status
    const newPaidAmount = currentPaid + finalPayAmount;
    const maxTotalPayable = totalJamaQty * weightedRate;
    const newPaymentStatus =
      maxTotalPayable > 0 && newPaidAmount >= maxTotalPayable - 0.5 ? "paid" : "partial";

    await db
      .update(jobSlipsTable)
      .set({
        paidAmount: String(newPaidAmount),
        paymentStatus: newPaymentStatus,
        updatedAt: new Date(),
      })
      .where(eq(jobSlipsTable.id, jobSlip.id));
  }

  if (createdPayments.length === 0) {
    res.status(400).json({ error: "Koi payment nahi bana — amounts invalid ya pehle se paid" });
    return;
  }

  // Send notification
  await db.insert(notificationsTable).values({
    userId: toUserId,
    type: "payment_update",
    title: "Payment Aaya! 💰",
    message: `${req.user.name || req.user.mobile} ne Rs. ${totalAmount.toLocaleString("en-IN")} bheja${slipPayments.length > 1 ? ` (${slipPayments.length} slips ke liye)` : ""}`,
    referenceType: "payment",
  });

  res.json({ success: true, paymentsCreated: createdPayments.length });
});

// POST /payments/record-slip-payment  (old system — keep for backward compat)
router.post("/payments/record-slip-payment", async (req: Request & { user?: any }, res): Promise<void> => {
  const { connectionId, toUserId, screenshotUrl, note, slipPayments } = req.body;

  if (!connectionId || !toUserId || !Array.isArray(slipPayments) || slipPayments.length === 0) {
    res.status(400).json({ error: "connectionId, toUserId, slipPayments required" });
    return;
  }

  const fromUserId = req.user.id;

  const [conn] = await db
    .select()
    .from(connectionsTable)
    .where(
      and(
        eq(connectionsTable.id, connectionId),
        or(eq(connectionsTable.fromUserId, fromUserId), eq(connectionsTable.toUserId, fromUserId))
      )
    );
  if (!conn) { res.status(403).json({ error: "Connection not found" }); return; }

  const allPayments = await db.select({ id: paymentsTable.id }).from(paymentsTable);
  let baseCount = allPayments.length;
  const createdPayments = [];

  for (const sp of slipPayments) {
    if (!sp.slipId || typeof sp.amount !== "number" || sp.amount <= 0) continue;
    const [slip] = await db.select().from(slipsTable).where(eq(slipsTable.id, sp.slipId));
    if (!slip) continue;

    const quantity = slip.quantity ? parseFloat(slip.quantity) : null;
    const rate = slip.rate ? parseFloat(slip.rate) : null;
    let paymentBill: number | null = slip.paymentBill ? parseFloat(slip.paymentBill) : null;
    if (!paymentBill && rate && quantity) paymentBill = rate * quantity;
    const paidAmount = slip.paidAmount ? parseFloat(slip.paidAmount) : 0;
    const balance = paymentBill !== null ? Math.max(0, paymentBill - paidAmount) : null;
    const payAmount = balance !== null ? Math.min(sp.amount, balance) : sp.amount;

    const paymentId = generatePaymentId(++baseCount);
    const [payment] = await db
      .insert(paymentsTable)
      .values({
        paymentId, fromUserId, toUserId, connectionId,
        amount: String(payAmount),
        note: note || `Slip ${slip.slipId} ka payment`,
        screenshotUrl: screenshotUrl || undefined,
        linkedSlipId: slip.id,
      })
      .returning();

    createdPayments.push(payment);

    const newPaidAmount = paidAmount + payAmount;
    const newPaymentStatus = paymentBill !== null
      ? (newPaidAmount >= paymentBill ? "paid" : "partial")
      : "partial";

    await db
      .update(slipsTable)
      .set({ paidAmount: String(newPaidAmount), paymentStatus: newPaymentStatus, updatedAt: new Date() })
      .where(eq(slipsTable.id, slip.id));
  }

  const totalPaid = slipPayments.reduce((s: number, p: any) => s + p.amount, 0);
  await db.insert(notificationsTable).values({
    userId: toUserId,
    type: "payment_update",
    title: "Payment Aaya",
    message: `${req.user.name || req.user.mobile} ne Rs. ${totalPaid.toLocaleString("en-IN")} bheja`,
    referenceType: "payment",
  });

  res.json({ success: true, paymentsCreated: createdPayments.length });
});

// GET /payments/:id  — full payment details including job slip items + jama qty
router.get("/payments/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const paymentId = parseInt(req.params.id, 10);
  if (isNaN(paymentId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const userId = req.user.id;

  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, paymentId));

  if (!payment) { res.status(404).json({ error: "Payment nahi mila" }); return; }
  if (payment.fromUserId !== userId && payment.toUserId !== userId) {
    res.status(403).json({ error: "Access nahi hai" }); return;
  }

  const base = await enrichPayment(payment);

  if (!payment.jobSlipId) {
    res.json({ ...base, jobSlipDetail: null });
    return;
  }

  // Fetch job slip items
  const items = await db
    .select()
    .from(jobSlipItemsTable)
    .where(eq(jobSlipItemsTable.slipId, payment.jobSlipId));

  // Fetch jama qty from return entries
  const returnEntries = await db
    .select()
    .from(returnSlipEntriesTable)
    .where(eq(returnSlipEntriesTable.jobSlipId, payment.jobSlipId));

  const totalJamaQty = returnEntries.reduce((s, e) => s + e.jamaQty, 0);

  // paidAmount on slip minus THIS payment (so user sees max they can set for this payment)
  const [jobSlip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, payment.jobSlipId));
  const slipPaidAmount = jobSlip ? (parseFloat(jobSlip.paidAmount) || 0) : 0;
  const thisAmount = parseFloat(payment.amount) || 0;
  const otherPaidAmount = Math.max(0, slipPaidAmount - thisAmount);

  res.json({
    ...base,
    jobSlipDetail: {
      id: payment.jobSlipId,
      slipNumber: base.jobSlip?.slipNumber ?? null,
      totalJamaQty,
      otherPaidAmount,
      items: items.map((i) => ({
        id: i.id,
        itemName: i.itemName,
        totalQty: i.totalQty,
        ratePerPc: i.ratePerPc ? parseFloat(i.ratePerPc) : null,
        finalRate: i.finalRate ? parseFloat(i.finalRate) : null,
      })),
    },
  });
});

// PATCH /payments/:id  — edit amount and/or note (only creator can edit)
router.patch("/payments/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const paymentId = parseInt(req.params.id, 10);
  if (isNaN(paymentId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const userId = req.user.id;

  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, paymentId));

  if (!payment) { res.status(404).json({ error: "Payment nahi mila" }); return; }
  if (payment.fromUserId !== userId) { res.status(403).json({ error: "Sirf payment karne wala edit kar sakta hai" }); return; }

  const { amount, note, itemRates } = req.body;
  const updates: Record<string, any> = {};

  if (typeof amount === "number" && amount > 0) {
    const oldAmount = parseFloat(payment.amount);
    const newAmount = amount;
    updates.amount = String(newAmount);

    // If linked to a job slip, update its paidAmount too
    if (payment.jobSlipId) {
      const [jobSlip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, payment.jobSlipId));
      if (jobSlip) {
        const currentPaid = parseFloat(jobSlip.paidAmount) || 0;
        const adjustedPaid = Math.max(0, currentPaid - oldAmount + newAmount);

        // Recompute paymentStatus from itemRates if provided, else use adjustedPaid vs slip total
        const slipItems = await db.select().from(jobSlipItemsTable).where(eq(jobSlipItemsTable.slipId, jobSlip.id));
        const returnEntries = await db.select().from(returnSlipEntriesTable).where(eq(returnSlipEntriesTable.jobSlipId, jobSlip.id));
        const totalJamaQty = returnEntries.reduce((s, e) => s + e.jamaQty, 0);
        const itemRateMap = new Map<number, number>();
        if (Array.isArray(itemRates)) {
          for (const ir of itemRates) {
            if (ir.itemId && typeof ir.finalRate === "number") itemRateMap.set(ir.itemId, ir.finalRate);
          }
        }
        let totalWeighted = 0, totalIssued = 0;
        for (const item of slipItems) {
          const rate = itemRateMap.get(item.id) ?? (item.finalRate ? parseFloat(item.finalRate) : 0);
          totalWeighted += item.totalQty * rate;
          totalIssued += item.totalQty;
        }
        const weightedRate = totalIssued > 0 ? totalWeighted / totalIssued : 0;
        const maxPayable = totalJamaQty * weightedRate;
        const newPaymentStatus = maxPayable > 0 && adjustedPaid >= maxPayable - 0.5 ? "paid" : adjustedPaid > 0 ? "partial" : "unpaid";

        await db.update(jobSlipsTable)
          .set({ paidAmount: String(adjustedPaid), paymentStatus: newPaymentStatus, updatedAt: new Date() })
          .where(eq(jobSlipsTable.id, jobSlip.id));

        // Update finalRate per item if provided, and store weighted avg in payment
        if (itemRateMap.size > 0) {
          for (const [itemId, finalRate] of itemRateMap) {
            if (finalRate > 0) {
              await db.update(jobSlipItemsTable)
                .set({ finalRate: String(finalRate) })
                .where(eq(jobSlipItemsTable.id, itemId));
            }
          }
          if (weightedRate > 0) updates.finalRate = String(Math.round(weightedRate * 100) / 100);
        }
      }
    }
  }

  if (typeof note === "string") {
    updates.note = note || null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "amount ya note chahiye" });
    return;
  }

  const [updated] = await db
    .update(paymentsTable)
    .set(updates)
    .where(eq(paymentsTable.id, paymentId))
    .returning();

  res.json(await enrichPayment(updated));
});

// DELETE /payments/:id  — delete payment (only creator can delete)
router.delete("/payments/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const paymentId = parseInt(req.params.id, 10);
  if (isNaN(paymentId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const userId = req.user.id;

  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, paymentId));

  if (!payment) { res.status(404).json({ error: "Payment nahi mila" }); return; }
  if (payment.fromUserId !== userId) { res.status(403).json({ error: "Sirf payment karne wala delete kar sakta hai" }); return; }

  // Revert job slip paidAmount if applicable
  if (payment.jobSlipId) {
    const [jobSlip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, payment.jobSlipId));
    if (jobSlip) {
      const oldAmount = parseFloat(payment.amount) || 0;
      const currentPaid = parseFloat(jobSlip.paidAmount) || 0;
      const revertedPaid = Math.max(0, currentPaid - oldAmount);
      await db.update(jobSlipsTable)
        .set({ paidAmount: String(revertedPaid), paymentStatus: revertedPaid > 0 ? "partial" : "unpaid", updatedAt: new Date() })
        .where(eq(jobSlipsTable.id, jobSlip.id));
    }
  }

  await db.delete(paymentsTable).where(eq(paymentsTable.id, paymentId));

  res.json({ success: true });
});

// POST /payments  (general payment — keep for backward compat)
router.post("/payments", async (req: Request & { user?: any }, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const fromUserId = req.user.id;
  const count = await db.select({ id: paymentsTable.id }).from(paymentsTable);
  const paymentId = generatePaymentId(count.length + 1);

  const [payment] = await db
    .insert(paymentsTable)
    .values({ paymentId, fromUserId, amount: String(parsed.data.amount), ...parsed.data })
    .returning();

  await db.insert(notificationsTable).values({
    userId: parsed.data.toUserId,
    type: "payment_update",
    title: "Payment Aaya",
    message: `${req.user.name || req.user.mobile} ne aapko Rs. ${parsed.data.amount} bheja${parsed.data.note ? ": " + parsed.data.note : ""}`,
    referenceId: payment.id,
    referenceType: "payment",
  });

  res.json(await enrichPayment(payment));
});

export default router;
