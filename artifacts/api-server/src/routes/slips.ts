import { Router } from "express";
import { eq, or, and, sum, isNull } from "drizzle-orm";
import { db, slipsTable, usersTable, notificationsTable } from "@workspace/db";
import {
  GetSlipsQueryParams,
  CreateSlipBody,
  GetSlipParams,
  UpdateSlipStatusParams,
  UpdateSlipStatusBody,
} from "@workspace/api-zod";
import { requireAuth, generateSlipId } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

async function enrichSlip(slip: any) {
  const [fromUser] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, slip.fromUserId));
  const [toUser] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, slip.toUserId));

  let linkedSlip = null;
  if (slip.linkedSlipId) {
    const [ls] = await db
      .select({ id: slipsTable.id, slipId: slipsTable.slipId, description: slipsTable.description, quantity: slipsTable.quantity, unit: slipsTable.unit, type: slipsTable.type })
      .from(slipsTable)
      .where(eq(slipsTable.id, slip.linkedSlipId));
    linkedSlip = ls ?? null;
  }

  let alreadyReturnedQuantity = 0;
  if (slip.type === "maal_issue") {
    const returnSlips = await db
      .select({ quantity: slipsTable.quantity })
      .from(slipsTable)
      .where(and(eq(slipsTable.linkedSlipId, slip.id), eq(slipsTable.type, "maal_return")));
    alreadyReturnedQuantity = returnSlips.reduce((acc, r) => acc + (parseFloat(r.quantity ?? "0") || 0), 0);
  }

  return {
    ...slip,
    quantity: slip.quantity ? parseFloat(slip.quantity) : null,
    rate: slip.rate ? parseFloat(slip.rate) : null,
    fromUser: fromUser ?? null,
    toUser: toUser ?? null,
    linkedSlip,
    alreadyReturnedQuantity,
  };
}

// GET /slips
router.get("/slips", async (req: Request & { user?: any }, res): Promise<void> => {
  const params = GetSlipsQueryParams.safeParse(req.query);
  const userId = req.user.id;

  let rows = await db
    .select()
    .from(slipsTable)
    .where(and(or(eq(slipsTable.fromUserId, userId), eq(slipsTable.toUserId, userId)), isNull(slipsTable.deletedAt)))
    .orderBy(slipsTable.createdAt);

  if (params.success) {
    if (params.data.type) {
      rows = rows.filter((r) => r.type === params.data.type);
    }
    if (params.data.status) {
      rows = rows.filter((r) => r.status === params.data.status);
    }
    if (params.data.connectionId) {
      rows = rows.filter((r) => r.connectionId === params.data.connectionId);
    }
  }

  const enriched = await Promise.all(rows.map(enrichSlip));
  res.json(enriched);
});

// POST /slips
router.post("/slips", async (req: Request & { user?: any }, res): Promise<void> => {
  const parsed = CreateSlipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const fromUserId = req.user.id;

  // Generate unique slip ID
  const count = await db.select().from(slipsTable);
  const slipId = generateSlipId(count.length + 1);

  const [slip] = await db
    .insert(slipsTable)
    .values({
      slipId,
      fromUserId,
      status: "pending",
      ...parsed.data,
    })
    .returning();

  const typeLabel =
    parsed.data.type === "maal_issue"
      ? "Maal Issue"
      : parsed.data.type === "maal_receive"
      ? "Maal Receive"
      : "Maal Return";

  const qty = parsed.data.quantity ? ` (${parsed.data.quantity} ${parsed.data.unit ?? ""})` : "";

  await db.insert(notificationsTable).values({
    userId: parsed.data.toUserId,
    type: "maal_update",
    title: `Naya ${typeLabel} Slip Aaya`,
    message: `${req.user.name || req.user.mobile} ne aapko ${typeLabel} slip bheja: ${parsed.data.description}${qty}`,
    referenceId: slip.id,
    referenceType: "slip",
  });

  res.json(await enrichSlip(slip));
});

// GET /slips/:id
router.get("/slips/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [slip] = await db.select().from(slipsTable).where(eq(slipsTable.id, id));
  if (!slip) {
    res.status(404).json({ error: "Slip not found" });
    return;
  }

  res.json(await enrichSlip(slip));
});

// PATCH /slips/:id/status
router.patch("/slips/:id/status", async (req: Request & { user?: any }, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = UpdateSlipStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [slip] = await db.select().from(slipsTable).where(eq(slipsTable.id, id));
  if (!slip) {
    res.status(404).json({ error: "Slip not found" });
    return;
  }

  const [updated] = await db
    .update(slipsTable)
    .set({ status: body.data.status, updatedAt: new Date() })
    .where(eq(slipsTable.id, id))
    .returning();

  const otherUserId = slip.fromUserId === req.user.id ? slip.toUserId : slip.fromUserId;
  const statusLabel =
    body.data.status === "completed" ? "Mukammal" : body.data.status === "seen" ? "Dekha Gaya" : "Pending";

  await db.insert(notificationsTable).values({
    userId: otherUserId,
    type: "maal_update",
    title: "Slip Update Hua",
    message: `Slip ${slip.slipId} ka status "${statusLabel}" ho gaya`,
    referenceId: slip.id,
    referenceType: "slip",
  });

  res.json(await enrichSlip(updated));
});

// PUT /slips/:id — edit slip (creator only, pending status only)
router.put("/slips/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [slip] = await db.select().from(slipsTable).where(eq(slipsTable.id, id));
  if (!slip) { res.status(404).json({ error: "Slip not found" }); return; }

  const isSuperAdmin = req.user.role === "super_admin";
  const isCreator = slip.fromUserId === req.user.id;
  if (!isCreator && !isSuperAdmin) {
    res.status(403).json({ error: "Sirf creator ya admin edit kar sakta hai" });
    return;
  }
  if (slip.status !== "pending" && !isSuperAdmin) {
    res.status(403).json({ error: "Sirf pending slip edit ho sakti hai" });
    return;
  }

  const { description, quantity, unit, rate, notes, imageUrl } = req.body;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (description !== undefined) updateData.description = description;
  if (quantity !== undefined) updateData.quantity = quantity ? String(quantity) : null;
  if (unit !== undefined) updateData.unit = unit;
  if (rate !== undefined) updateData.rate = rate ? String(rate) : null;
  if (notes !== undefined) updateData.notes = notes;
  if (imageUrl !== undefined) updateData.imageUrl = imageUrl;

  const [updated] = await db.update(slipsTable).set(updateData).where(eq(slipsTable.id, id)).returning();
  res.json(await enrichSlip(updated));
});

// DELETE /slips/:id — soft delete (creator or admin only)
router.delete("/slips/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [slip] = await db.select().from(slipsTable).where(eq(slipsTable.id, id));
  if (!slip) { res.status(404).json({ error: "Slip not found" }); return; }

  const isSuperAdmin = req.user.role === "super_admin";
  const isCreator = slip.fromUserId === req.user.id;
  if (!isCreator && !isSuperAdmin) {
    res.status(403).json({ error: "Sirf creator ya admin delete kar sakta hai" });
    return;
  }

  await db.update(slipsTable).set({ deletedAt: new Date(), updatedAt: new Date() } as any).where(eq(slipsTable.id, id));
  res.json({ success: true });
});

export default router;
