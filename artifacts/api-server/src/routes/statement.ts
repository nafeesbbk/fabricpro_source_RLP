import { Router } from "express";
import { eq, and, or, inArray } from "drizzle-orm";
import {
  db,
  jobSlipsTable,
  jobSlipItemsTable,
  returnSlipsTable,
  returnSlipEntriesTable,
  paymentsTable,
  connectionsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

// GET /statement?connectionId=X&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/statement", async (req: Request & { user?: any }, res): Promise<void> => {
  const connectionId = parseInt(req.query.connectionId as string, 10);
  if (!connectionId || isNaN(connectionId)) {
    res.status(400).json({ error: "connectionId required" });
    return;
  }

  const userId = req.user.id;

  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;
  const fromDate = fromStr ? new Date(fromStr + "T00:00:00.000Z") : null;
  const toDate = toStr ? new Date(toStr + "T23:59:59.999Z") : null;
  // asSeth=true → current user is Seth, asSeth=false → current user is Karigar
  // Used when a contact has role "both" — frontend explicitly tells us which side to show
  const asSethParam = req.query.asSeth as string | undefined;

  // Verify connection belongs to current user
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

  const otherUserId = conn.fromUserId === userId ? conn.toUserId : conn.fromUserId;

  // Fetch all job slips for this connection (either direction)
  const allJobSlipsForConn = await db
    .select()
    .from(jobSlipsTable)
    .where(
      or(
        and(eq(jobSlipsTable.sethId, userId), eq(jobSlipsTable.karigarId, otherUserId)),
        and(eq(jobSlipsTable.sethId, otherUserId), eq(jobSlipsTable.karigarId, userId))
      )
    );

  // Determine seth/karigar correctly using current user's actual position in slips
  let sethId: number;
  let karigarId: number;

  if (asSethParam !== undefined) {
    // Frontend explicitly told us the perspective (used for "both" role contacts)
    const userIsSeth = asSethParam === "true";
    sethId = userIsSeth ? userId : otherUserId;
    karigarId = userIsSeth ? otherUserId : userId;
  } else if (allJobSlipsForConn.length > 0) {
    // Auto-detect: check if current user is Seth in majority of the slips
    const sethSlips = allJobSlipsForConn.filter((s) => s.sethId === userId).length;
    const userIsSeth = sethSlips >= allJobSlipsForConn.length / 2;
    sethId = userIsSeth ? userId : otherUserId;
    karigarId = userIsSeth ? otherUserId : userId;
  } else {
    // No slips yet — default: fromUserId = Seth
    sethId = conn.fromUserId;
    karigarId = conn.toUserId;
  }

  // Fetch user info
  const [sethUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, code: usersTable.code, mobile: usersTable.mobile })
    .from(usersTable)
    .where(eq(usersTable.id, sethId));
  const [karigarUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, code: usersTable.code, mobile: usersTable.mobile })
    .from(usersTable)
    .where(eq(usersTable.id, karigarId));

  // Job slips (maal gaya: seth → karigar)
  const jobSlips = await db
    .select()
    .from(jobSlipsTable)
    .where(and(eq(jobSlipsTable.sethId, sethId), eq(jobSlipsTable.karigarId, karigarId)))
    .orderBy(jobSlipsTable.createdAt);

  const filteredJobSlips = jobSlips.filter((s) => {
    const d = new Date(s.createdAt);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });

  const jobSlipIds = filteredJobSlips.map((s) => s.id);

  const allItems = jobSlipIds.length > 0
    ? await db.select().from(jobSlipItemsTable).where(inArray(jobSlipItemsTable.slipId, jobSlipIds))
    : [];

  const itemsBySlip = new Map<number, typeof allItems>();
  for (const item of allItems) {
    if (!itemsBySlip.has(item.slipId)) itemsBySlip.set(item.slipId, []);
    itemsBySlip.get(item.slipId)!.push(item);
  }

  // Return slips (maal aya: karigar → seth)
  const allReturnEntries = jobSlipIds.length > 0
    ? await db.select().from(returnSlipEntriesTable).where(inArray(returnSlipEntriesTable.jobSlipId, jobSlipIds))
    : [];

  const returnSlipIds = [...new Set(allReturnEntries.map((e) => e.returnSlipId))];
  const allReturnSlips = returnSlipIds.length > 0
    ? await db.select().from(returnSlipsTable).where(inArray(returnSlipsTable.id, returnSlipIds))
    : [];

  const filteredReturnSlips = allReturnSlips.filter((rs) => {
    const d = new Date(rs.createdAt);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });

  const filteredReturnSlipIds = new Set(filteredReturnSlips.map((rs) => rs.id));
  const filteredReturnEntries = allReturnEntries.filter((e) => filteredReturnSlipIds.has(e.returnSlipId));

  // Payments
  const allPayments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.connectionId, connectionId))
    .orderBy(paymentsTable.createdAt);

  const filteredPayments = allPayments.filter((p) => {
    const d = new Date(p.createdAt);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });

  // Build map: jobSlipId → total jamaQty (from ALL return entries)
  const jamaBySlip = new Map<number, number>();
  for (const entry of allReturnEntries) {
    jamaBySlip.set(entry.jobSlipId, (jamaBySlip.get(entry.jobSlipId) ?? 0) + entry.jamaQty);
  }

  // Build per-slip paid map from payments table (ALL payments, not date-filtered)
  const linkedPaidBySlip = new Map<number, number>();
  let unlinkedPaidTotal = 0;
  for (const p of allPayments) {
    if (p.fromUserId !== sethId) continue; // only Seth→Karigar payments
    if (p.jobSlipId) {
      linkedPaidBySlip.set(p.jobSlipId, (linkedPaidBySlip.get(p.jobSlipId) ?? 0) + parseFloat(p.amount));
    } else {
      unlinkedPaidTotal += parseFloat(p.amount);
    }
  }

  // ── Maal Gaya aggregates ──
  // Helper: use finalRate if set (agreed payment rate), else fall back to ratePerPc
  function effectiveRate(item: { ratePerPc: string | null; finalRate: string | null }): number {
    if (item.finalRate && parseFloat(item.finalRate) > 0) return parseFloat(item.finalRate);
    if (item.ratePerPc && parseFloat(item.ratePerPc) > 0) return parseFloat(item.ratePerPc);
    return 0;
  }

  // First pass: compute jamaBill per slip (for proportional unlinked payment distribution)
  const slipJamaBills = filteredJobSlips.map((slip) => {
    const items = itemsBySlip.get(slip.id) ?? [];
    const issuedQty = items.reduce((s, i) => s + i.totalQty, 0);
    const bill = items.reduce((s, i) => s + i.totalQty * effectiveRate(i), 0);
    const jamaQty = jamaBySlip.get(slip.id) ?? 0;
    const jamaBill = issuedQty > 0 && bill > 0 && jamaQty > 0
      ? (jamaQty / issuedQty) * bill : 0;
    return { id: slip.id, jamaBill };
  });
  const totalJamaBillForDist = slipJamaBills.reduce((s, x) => s + x.jamaBill, 0);

  const maalGayaSlips = filteredJobSlips.map((slip, idx) => {
    const items = itemsBySlip.get(slip.id) ?? [];
    const totalQty = items.reduce((s, i) => s + i.totalQty, 0);
    const linkedPaid = linkedPaidBySlip.get(slip.id) ?? 0;
    const jamaBill = slipJamaBills[idx].jamaBill;
    // Distribute unlinked payments proportionally by jamaBill
    const unlinkedShare = totalJamaBillForDist > 0 && jamaBill > 0
      ? (jamaBill / totalJamaBillForDist) * unlinkedPaidTotal : 0;
    const effectivePaid = Math.max(parseFloat(slip.paidAmount) || 0, linkedPaid + unlinkedShare);
    return {
      id: slip.id,
      slipNumber: slip.slipNumber,
      date: slip.createdAt,
      totalQty,
      status: slip.status,
      paymentStatus: slip.paymentStatus,
      paidAmount: Math.round(effectivePaid * 100) / 100,
      jamaBill: Math.round(jamaBill * 100) / 100,
      items: items.map((i) => ({
        itemName: i.itemName,
        totalQty: i.totalQty,
        ratePerPc: i.ratePerPc ? parseFloat(i.ratePerPc) : null,
        finalRate: i.finalRate ? parseFloat(i.finalRate) : null,
      })),
    };
  });

  const totalIssuedQty = maalGayaSlips.reduce((s, sl) => s + sl.totalQty, 0);

  // ── Maal Aya (return) aggregates ──
  const returnSlipMap = new Map(allReturnSlips.map((rs) => [rs.id, rs]));
  const processedReturnSlips = [...filteredReturnSlipIds].map((rsId) => {
    const rs = returnSlipMap.get(rsId)!;
    const entries = filteredReturnEntries.filter((e) => e.returnSlipId === rsId);
    const jamaQty = entries.reduce((s, e) => s + e.jamaQty, 0);
    const damageQty = entries.reduce((s, e) => s + e.damageQty, 0);
    const shortageQty = entries.reduce((s, e) => s + e.shortageQty, 0);
    const noWorkQty = entries.reduce((s, e) => s + (e.noWorkQty ?? 0), 0);
    return {
      id: rsId,
      slipNumber: rs.slipNumber,
      date: rs.createdAt,
      jamaQty,
      damageQty,
      shortageQty,
      noWorkQty,
      totalWapis: jamaQty + damageQty + shortageQty + noWorkQty,
    };
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const totalJamaQty = processedReturnSlips.reduce((s, rs) => s + rs.jamaQty, 0);
  const totalDamageQty = processedReturnSlips.reduce((s, rs) => s + rs.damageQty, 0);
  const totalShortageQty = processedReturnSlips.reduce((s, rs) => s + rs.shortageQty, 0);
  const totalNoWorkQty = processedReturnSlips.reduce((s, rs) => s + rs.noWorkQty, 0);
  const totalWapisAll = processedReturnSlips.reduce((s, rs) => s + rs.totalWapis, 0);
  const pendingQty = Math.max(0, totalIssuedQty - totalWapisAll);

  // ── Payment aggregates ──
  // Seth pays karigar → "diya" from Seth's view, "mila" from Karigar's view
  const paymentsDiya = filteredPayments.filter((p) => p.fromUserId === sethId);
  const paymentsAaya = filteredPayments.filter((p) => p.fromUserId === karigarId);
  const totalDiya = paymentsDiya.reduce((s, p) => s + parseFloat(p.amount), 0);
  const totalAaya = paymentsAaya.reduce((s, p) => s + parseFloat(p.amount), 0);

  // Total jama bill: sirf jama hua maal ka paisa (proportional per slip)
  // Uses finalRate if set (agreed payment rate), else ratePerPc
  let totalJamaBill = 0;
  for (const slip of filteredJobSlips) {
    const items = itemsBySlip.get(slip.id) ?? [];
    const totalIssuedQty = items.reduce((s, i) => s + i.totalQty, 0);
    const slipBill = items.reduce((s, item) => s + item.totalQty * effectiveRate(item), 0);
    const jamaQty = jamaBySlip.get(slip.id) ?? 0;
    if (totalIssuedQty > 0 && slipBill > 0 && jamaQty > 0) {
      totalJamaBill += (jamaQty / totalIssuedQty) * slipBill;
    }
  }

  // Total payments received by karigar from seth (ALL payments for connection, not date-filtered)
  // This includes both old simple payments and new record-job-payment
  const allConnectionPayments = allPayments; // already fetched above (no date filter)
  const totalPaidToKarigar = allConnectionPayments
    .filter((p) => p.fromUserId === sethId)
    .reduce((s, p) => s + parseFloat(p.amount), 0);

  // Balance Due = jama bill - total received payments
  const balanceDue = Math.max(0, totalJamaBill - totalPaidToKarigar);

  // Slip payment summary (for display only — counts unpaid/partial/paid slips)
  const slipPaymentSummary = filteredJobSlips.reduce(
    (acc, slip) => {
      const ps = slip.paymentStatus;
      if (ps === "paid") acc.fullyPaid++;
      else if (ps === "partial") acc.partial++;
      else acc.unpaid++;
      acc.totalPaid += parseFloat(slip.paidAmount) || 0;
      return acc;
    },
    { fullyPaid: 0, partial: 0, unpaid: 0, totalPaid: 0 }
  );

  res.json({
    connection: { id: conn.id, status: conn.status },
    seth: sethUser ?? null,
    karigar: karigarUser ?? null,
    currentUserId: userId,
    isSeth: userId === sethId,
    dateRange: { from: fromStr ?? null, to: toStr ?? null },

    maalGaya: {
      slipCount: maalGayaSlips.length,
      totalQty: totalIssuedQty,
      slips: maalGayaSlips,
    },

    maalAya: {
      returnSlipCount: processedReturnSlips.length,
      totalJamaQty,
      totalDamageQty,
      totalShortageQty,
      totalNoWorkQty,
      totalWapis: totalWapisAll,
      returnSlips: processedReturnSlips,
    },

    pendingAtKarigar: pendingQty,

    payments: {
      totalDiya,
      totalAaya,
      diyaCount: paymentsDiya.length,
      aayaCount: paymentsAaya.length,
      records: filteredPayments.map((p) => ({
        id: p.id,
        paymentId: p.paymentId,
        amount: parseFloat(p.amount),
        finalRate: p.finalRate ? parseFloat(p.finalRate) : null,
        note: p.note,
        date: p.createdAt,
        direction: p.fromUserId === sethId ? "diya" : "mila",
        jobSlipId: p.jobSlipId ?? null,
      })),
    },

    slipPaymentSummary,
    balanceDue,
  });
});

export default router;
