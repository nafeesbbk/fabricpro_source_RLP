import { Router } from "express";
import { eq, or, and, inArray } from "drizzle-orm";
import {
  db,
  jobSlipsTable,
  jobSlipItemsTable,
  returnSlipsTable,
  returnSlipEntriesTable,
  paymentsTable,
  connectionsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

// GET /dashboard/summary
router.get("/dashboard/summary", async (req: Request & { user?: any }, res): Promise<void> => {
  const userId = req.user.id;
  const role = req.user.role;

  const [jobSlips, payments, acceptedConns, unreadNotifs] = await Promise.all([
    db.select().from(jobSlipsTable).where(
      or(eq(jobSlipsTable.sethId, userId), eq(jobSlipsTable.karigarId, userId))
    ),
    db.select().from(paymentsTable).where(
      or(eq(paymentsTable.fromUserId, userId), eq(paymentsTable.toUserId, userId))
    ),
    db.select().from(connectionsTable).where(
      and(
        or(eq(connectionsTable.fromUserId, userId), eq(connectionsTable.toUserId, userId)),
        eq(connectionsTable.status, "accepted"),
      ),
    ),
    db.select().from(notificationsTable).where(
      and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false))
    ),
  ]);

  const pendingSlips = jobSlips.filter((s) => s.status !== "completed" && s.status !== "cancelled").length;

  // Seth: maal aya = slips where karigarId = userId (maal bheja gaya karigar ko — seth view)
  //       maal gaya = slips where sethId = userId
  // Karigar: maal liya = slips where karigarId = userId
  //          maal diya = return slips they created
  const maalAya = jobSlips.filter((s) => s.sethId === userId).length;
  const maalGaya = jobSlips.filter((s) => s.karigarId === userId).length;
  const maalLiya = jobSlips.filter((s) => s.karigarId === userId).length;
  const maalDiya = jobSlips.filter((s) => s.sethId === userId).length;

  const paymentAya = payments
    .filter((p) => p.toUserId === userId)
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);
  const paymentDiya = payments
    .filter((p) => p.fromUserId === userId)
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  res.json({
    role,
    maalAya,
    maalGaya,
    paymentAya: Math.round(paymentAya),
    maalLiya,
    maalDiya,
    paymentDiya: Math.round(paymentDiya),
    totalConnections: acceptedConns.length,
    pendingSlips,
    unreadNotifications: unreadNotifs.length,
  });
});

// GET /dashboard/recent-activity — uses job slips, return slips, payments
router.get("/dashboard/recent-activity", async (req: Request & { user?: any }, res): Promise<void> => {
  const userId = req.user.id;

  const [jobSlips, returnSlips, payments] = await Promise.all([
    db.select().from(jobSlipsTable).where(
      or(eq(jobSlipsTable.sethId, userId), eq(jobSlipsTable.karigarId, userId))
    ),
    db.select().from(returnSlipsTable).where(
      or(eq(returnSlipsTable.sethId, userId), eq(returnSlipsTable.karigarId, userId))
    ),
    db.select().from(paymentsTable).where(
      or(eq(paymentsTable.fromUserId, userId), eq(paymentsTable.toUserId, userId))
    ),
  ]);

  // For job slips: batch compute hasReturnSlips + items for canDelete/canEdit
  const slipIds = jobSlips.map((s) => s.id);
  const [allItems, allEntries] = slipIds.length > 0
    ? await Promise.all([
        db.select().from(jobSlipItemsTable).where(inArray(jobSlipItemsTable.slipId, slipIds)),
        db.select().from(returnSlipEntriesTable).where(inArray(returnSlipEntriesTable.jobSlipId, slipIds)),
      ])
    : [[], []];

  const returnedSlipIds = new Set(allEntries.map((e) => e.jobSlipId));

  // Get partner user info for payments
  const paymentPartnerIds = [...new Set([
    ...payments.map((p) => p.fromUserId === userId ? p.toUserId : p.fromUserId),
  ])];
  const partnerUsers = paymentPartnerIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, code: usersTable.code })
        .from(usersTable).where(inArray(usersTable.id, paymentPartnerIds))
    : [];
  const partnerMap = new Map(partnerUsers.map((u) => [u.id, u]));

  const slipActivities = jobSlips.map((s) => {
    const items = allItems.filter((i) => i.slipId === s.id);
    const totalQty = items.reduce((sum, i) => sum + i.totalQty, 0);
    const hasReturnSlips = returnedSlipIds.has(s.id);
    const canDelete = s.status !== "confirmed" && s.status !== "completed" && !hasReturnSlips;
    const canEdit = s.status === "draft" && !hasReturnSlips;
    return {
      id: `slip-${s.id}`,
      activityType: "slip" as const,
      title: `Job Slip ${s.slipNumber}`,
      subtitle: `${totalQty} pcs`,
      status: s.status,
      timestamp: s.createdAt,
      referenceId: s.id,
      canEdit: s.sethId === userId ? canEdit : false,
      canDelete: s.sethId === userId ? canDelete : false,
    };
  });

  const returnActivities = returnSlips.map((s) => ({
    id: `return-${s.id}`,
    activityType: "return" as const,
    title: `Wapsi Slip ${s.slipNumber}`,
    subtitle: s.status === "confirmed" ? "Confirmed" : "Pending",
    status: s.status,
    timestamp: s.createdAt,
    referenceId: s.id,
    canEdit: false,
    canDelete: false,
  }));

  const paymentActivities = payments.map((p) => {
    const partnerId = p.fromUserId === userId ? p.toUserId : p.fromUserId;
    const partner = partnerMap.get(partnerId);
    const partnerName = partner?.name || partner?.code || "—";
    const isSent = p.fromUserId === userId;
    return {
      id: `pay-${p.id}`,
      activityType: "payment" as const,
      title: `Payment ₹${parseFloat(p.amount).toFixed(0)}`,
      subtitle: isSent ? `Diya → ${partnerName}` : `Mila ← ${partnerName}`,
      status: "completed",
      timestamp: p.createdAt,
      referenceId: p.id,
      canEdit: false,
      canDelete: false,
    };
  });

  const all = [...slipActivities, ...returnActivities, ...paymentActivities].sort(
    (a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime(),
  );

  res.json(all.slice(0, 30));
});

export default router;
