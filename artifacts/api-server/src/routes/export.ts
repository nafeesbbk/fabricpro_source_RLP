import { Router } from "express";
import { eq, and, or, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  connectionsTable,
  jobSlipsTable,
  jobSlipItemsTable,
  returnSlipsTable,
  returnSlipEntriesTable,
  paymentsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import XLSX from "xlsx";

const router = Router();
router.use(requireAuth);

function fmt(dt: Date | string | null | undefined): string {
  if (!dt) return "";
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function fmtDate(dt: Date | string | null | undefined): string {
  if (!dt) return "";
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// GET /users/me/export-excel
router.get("/users/me/export-excel", async (req, res): Promise<void> => {
  const user = (req as any).user;
  const userId: number = user.id;
  const isAdmin = user.role === "super_admin";

  // ── 1. Contacts (connections) ─────────────────────────────────────────
  const conns = await db
    .select()
    .from(connectionsTable)
    .where(
      and(
        or(eq(connectionsTable.fromUserId, userId), eq(connectionsTable.toUserId, userId)),
        eq(connectionsTable.status, "accepted")
      )
    );

  const otherIds = conns.map((c) =>
    c.fromUserId === userId ? c.toUserId : c.fromUserId
  );

  const contacts = otherIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, otherIds))
    : [];

  const contactMap = new Map(contacts.map((u) => [u.id, u]));
  const connMap = new Map(conns.map((c) => [c.id, c]));

  // ── 2. Job Slips (Maal Gaya) ─────────────────────────────────────────
  const jobSlips = await db
    .select()
    .from(jobSlipsTable)
    .where(
      isAdmin
        ? undefined
        : or(eq(jobSlipsTable.sethId, userId), eq(jobSlipsTable.karigarId, userId))
    )
    .orderBy(jobSlipsTable.createdAt);

  const jobSlipIds = jobSlips.map((j) => j.id);
  const allItems = jobSlipIds.length
    ? await db.select().from(jobSlipItemsTable).where(inArray(jobSlipItemsTable.slipId, jobSlipIds))
    : [];

  // ── 3. Return Slips (Maal Wapas Aya) ─────────────────────────────────
  const retSlips = await db
    .select()
    .from(returnSlipsTable)
    .where(
      isAdmin
        ? undefined
        : or(eq(returnSlipsTable.sethId, userId), eq(returnSlipsTable.karigarId, userId))
    )
    .orderBy(returnSlipsTable.createdAt);

  const retIds = retSlips.map((r) => r.id);
  const retEntries = retIds.length
    ? await db.select().from(returnSlipEntriesTable).where(inArray(returnSlipEntriesTable.returnSlipId, retIds))
    : [];

  // ── 4. Payments ──────────────────────────────────────────────────────
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(
      isAdmin
        ? undefined
        : or(eq(paymentsTable.fromUserId, userId), eq(paymentsTable.toUserId, userId))
    )
    .orderBy(paymentsTable.createdAt);

  // ── 5. All users (admin only) ─────────────────────────────────────────
  let allUsers: (typeof usersTable.$inferSelect)[] = [];
  if (isAdmin) {
    allUsers = await db
      .select()
      .from(usersTable)
      .orderBy(usersTable.name);
  }

  // ── Build XLSX workbook ──────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary / Account Info
  const meUser = isAdmin
    ? user
    : await db.select().from(usersTable).where(eq(usersTable.id, userId)).then((r) => r[0]);

  const summaryData = [
    ["FabricPro — Data Export", "", ""],
    ["Exported On", fmt(new Date()), ""],
    ["", "", ""],
    ["ACCOUNT INFO", "", ""],
    ["Name", meUser?.name ?? "", ""],
    ["Mobile", meUser?.mobile ?? "", ""],
    ["Code", meUser?.code ?? "", ""],
    ["Role", meUser?.role ?? "", ""],
    ["Plan", meUser?.plan ?? "", ""],
    ["", "", ""],
    ["DATA SUMMARY", "", ""],
    ["Total Contacts (Accepted)", conns.length, ""],
    ["Total Job Slips (Maal Gaya)", jobSlips.length, ""],
    ["Total Return Slips (Maal Wapas)", retSlips.length, ""],
    ["Total Payments", payments.length, ""],
    ["Total Amount Paid (given by me)",
      payments.filter(p => p.fromUserId === userId).reduce((s, p) => s + Number(p.amount), 0), "Rs"],
    ["Total Amount Received (by me)",
      payments.filter(p => p.toUserId === userId).reduce((s, p) => s + Number(p.amount), 0), "Rs"],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary["!cols"] = [{ wch: 35 }, { wch: 30 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // Sheet 2: Contacts
  const contactRows = conns.map((c) => {
    const otherId = c.fromUserId === userId ? c.toUserId : c.fromUserId;
    const other = contactMap.get(otherId);
    const myRole = c.fromUserId === userId ? "Seth (Maine Diya)" : "Karigar (Maine Liya)";
    return {
      "Connection ID": c.id,
      "Name": other?.name ?? "",
      "Mobile": other?.mobile ?? "",
      "Code": other?.code ?? "",
      "Role in App": other?.role ?? "",
      "Mera Role": myRole,
      "Label": c.roleLabel,
      "Status": c.status,
      "Connected On": fmtDate(c.createdAt),
    };
  });
  const wsContacts = XLSX.utils.json_to_sheet(contactRows.length ? contactRows : [{ "Note": "Koi accepted contact nahi hai" }]);
  wsContacts["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 10 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsContacts, "Contacts");

  // Sheet 3: Job Slips (Maal Gaya)
  const jobSlipRows = jobSlips.map((j) => {
    const sethUser = contactMap.get(j.sethId) ?? (j.sethId === userId ? meUser : null);
    const karigarUser = contactMap.get(j.karigarId) ?? (j.karigarId === userId ? meUser : null);
    const items = allItems.filter((i) => i.slipId === j.id);
    const totalQty = items.reduce((s, i) => s + i.totalQty, 0);
    return {
      "Slip Number": j.slipNumber,
      "Date": fmtDate(j.createdAt),
      "Seth (Dene Wala)": sethUser?.name ?? `User#${j.sethId}`,
      "Karigar (Lene Wala)": karigarUser?.name ?? `User#${j.karigarId}`,
      "Status": j.status,
      "Total Items": items.length,
      "Total Qty": totalQty,
      "Paid Amount (Rs)": Number(j.paidAmount ?? 0),
      "Payment Status": j.paymentStatus,
      "Notes": j.notes ?? "",
    };
  });
  const wsJobSlips = XLSX.utils.json_to_sheet(jobSlipRows.length ? jobSlipRows : [{ "Note": "Koi job slip nahi hai" }]);
  wsJobSlips["!cols"] = [{ wch: 15 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 15 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsJobSlips, "Maal Gaya (Job Slips)");

  // Sheet 4: Job Slip Items detail
  const itemRows = allItems.map((i) => {
    const slip = jobSlips.find((j) => j.id === i.slipId);
    return {
      "Slip Number": slip?.slipNumber ?? "",
      "Slip Date": slip ? fmtDate(slip.createdAt) : "",
      "Item Name": i.itemName,
      "Total Qty": i.totalQty,
      "Rate/Pc (Rs)": i.ratePerPc ? Number(i.ratePerPc) : "",
      "Final Rate (Rs)": i.finalRate ? Number(i.finalRate) : "",
      "Notes": i.notes ?? "",
    };
  });
  const wsItems = XLSX.utils.json_to_sheet(itemRows.length ? itemRows : [{ "Note": "Koi item nahi hai" }]);
  wsItems["!cols"] = [{ wch: 15 }, { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsItems, "Slip Items Detail");

  // Sheet 5: Return Slips (Maal Wapas)
  const retSlipRows = retSlips.map((r) => {
    const sethUser = contactMap.get(r.sethId) ?? (r.sethId === userId ? meUser : null);
    const karigarUser = contactMap.get(r.karigarId) ?? (r.karigarId === userId ? meUser : null);
    const entries = retEntries.filter((e) => e.returnSlipId === r.id);
    const totalJama = entries.reduce((s, e) => s + e.jamaQty, 0);
    const totalDamage = entries.reduce((s, e) => s + e.damageQty, 0);
    const totalShortage = entries.reduce((s, e) => s + e.shortageQty, 0);
    return {
      "Slip Number": r.slipNumber,
      "Date": fmtDate(r.createdAt),
      "Seth (Lene Wala)": sethUser?.name ?? `User#${r.sethId}`,
      "Karigar (Bhejne Wala)": karigarUser?.name ?? `User#${r.karigarId}`,
      "Total Entries": entries.length,
      "Jama Qty": totalJama,
      "Damage Qty": totalDamage,
      "Shortage Qty": totalShortage,
      "Notes": r.notes ?? "",
    };
  });
  const wsRetSlips = XLSX.utils.json_to_sheet(retSlipRows.length ? retSlipRows : [{ "Note": "Koi return slip nahi hai" }]);
  wsRetSlips["!cols"] = [{ wch: 15 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsRetSlips, "Maal Wapas (Return Slips)");

  // Sheet 6: Payments
  const paymentRows = payments.map((p) => {
    const fromUser = contactMap.get(p.fromUserId) ?? (p.fromUserId === userId ? meUser : null);
    const toUser = contactMap.get(p.toUserId) ?? (p.toUserId === userId ? meUser : null);
    const direction = p.fromUserId === userId ? "Maine Diya" : "Mujhe Mila";
    return {
      "Payment ID": p.paymentId,
      "Date": fmtDate(p.createdAt),
      "Direction": direction,
      "Se (From)": fromUser?.name ?? `User#${p.fromUserId}`,
      "Ko (To)": toUser?.name ?? `User#${p.toUserId}`,
      "Amount (Rs)": Number(p.amount),
      "Note": p.note ?? "",
      "Linked Slip": p.jobSlipId ? `JobSlip#${p.jobSlipId}` : "",
    };
  });
  const wsPayments = XLSX.utils.json_to_sheet(paymentRows.length ? paymentRows : [{ "Note": "Koi payment nahi hai" }]);
  wsPayments["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsPayments, "Payments");

  // Sheet 7: All Users (admin only)
  if (isAdmin && allUsers.length) {
    const userRows = allUsers.map((u) => ({
      "ID": u.id,
      "Name": u.name ?? "",
      "Mobile": u.mobile,
      "Code": u.code,
      "Role": u.role,
      "KYC": u.kycCompleted ? "Yes" : "No",
      "Plan": u.plan,
      "Activation": u.activationStatus,
      "Slips Used": u.slipsUsed,
      "Registered On": fmtDate(u.createdAt),
    }));
    const wsUsers = XLSX.utils.json_to_sheet(userRows);
    wsUsers["!cols"] = [{ wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsUsers, "All Users (Admin)");
  }

  // ── Send file ────────────────────────────────────────────────────────
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const safeName = (meUser?.name ?? "User").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `FabricPro_${safeName}_${dateStr}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
});

export default router;
