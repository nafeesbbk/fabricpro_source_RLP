import { Router } from "express";
import { eq, and, or, inArray } from "drizzle-orm";
import {
  db,
  jobSlipsTable,
  jobSlipItemsTable,
  returnSlipEntriesTable,
  returnSlipsTable,
  usersTable,
  notificationsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

function generateJobSlipNumber(count: number): string {
  return `JO-${String(count).padStart(4, "0")}`;
}

async function computeSlipBalance(slipId: number) {
  const items = await db
    .select()
    .from(jobSlipItemsTable)
    .where(eq(jobSlipItemsTable.slipId, slipId));

  const totalQty = items.reduce((sum, item) => sum + item.totalQty, 0);

  const entries = await db
    .select()
    .from(returnSlipEntriesTable)
    .where(eq(returnSlipEntriesTable.jobSlipId, slipId));

  const jamaQty = entries.reduce((sum, e) => sum + e.jamaQty, 0);
  const damageQty = entries.reduce((sum, e) => sum + e.damageQty, 0);
  const shortageQty = entries.reduce((sum, e) => sum + e.shortageQty, 0);
  const noWorkQty = entries.reduce((sum, e) => sum + (e.noWorkQty ?? 0), 0);
  const balanceQty = totalQty - jamaQty - damageQty - shortageQty - noWorkQty;

  return { totalQty, jamaQty, damageQty, shortageQty, noWorkQty, balanceQty, isComplete: balanceQty <= 0, items };
}

async function enrichJobSlip(slip: typeof jobSlipsTable.$inferSelect, requesterId?: number) {
  const [seth] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name, mobile: usersTable.mobile })
    .from(usersTable)
    .where(eq(usersTable.id, slip.sethId));

  const [karigar] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name, mobile: usersTable.mobile })
    .from(usersTable)
    .where(eq(usersTable.id, slip.karigarId));

  const balance = await computeSlipBalance(slip.id);

  const returnEntries = await db
    .select({ id: returnSlipEntriesTable.id })
    .from(returnSlipEntriesTable)
    .where(eq(returnSlipEntriesTable.jobSlipId, slip.id));
  const hasReturnSlips = returnEntries.length > 0;

  const isCreator = requesterId == null || slip.sethId === requesterId;
  return {
    ...slip,
    seth: seth ?? null,
    karigar: karigar ?? null,
    ...balance,
    hasReturnSlips,
    canDelete: isCreator && slip.status !== "confirmed" && slip.status !== "completed" && !hasReturnSlips,
    canEdit: isCreator && slip.status === "draft" && !hasReturnSlips,
    isCreator,
  };
}

// Batch version — single DB call per query instead of N queries per slip
async function enrichJobSlipsBatch(slips: (typeof jobSlipsTable.$inferSelect)[]) {
  if (slips.length === 0) return [];

  const slipIds = slips.map((s) => s.id);
  const userIds = [...new Set([...slips.map((s) => s.sethId), ...slips.map((s) => s.karigarId)])];

  const [allUsers, allItems, allEntries] = await Promise.all([
    db
      .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name, mobile: usersTable.mobile })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds)),
    db.select().from(jobSlipItemsTable).where(inArray(jobSlipItemsTable.slipId, slipIds)),
    db.select().from(returnSlipEntriesTable).where(inArray(returnSlipEntriesTable.jobSlipId, slipIds)),
  ]);

  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const itemsBySlip = new Map<number, typeof allItems>();
  for (const item of allItems) {
    if (!itemsBySlip.has(item.slipId)) itemsBySlip.set(item.slipId, []);
    itemsBySlip.get(item.slipId)!.push(item);
  }
  const entriesBySlip = new Map<number, typeof allEntries>();
  for (const entry of allEntries) {
    if (!entriesBySlip.has(entry.jobSlipId)) entriesBySlip.set(entry.jobSlipId, []);
    entriesBySlip.get(entry.jobSlipId)!.push(entry);
  }

  return slips.map((slip) => {
    const items = itemsBySlip.get(slip.id) ?? [];
    const entries = entriesBySlip.get(slip.id) ?? [];
    const totalQty = items.reduce((s, i) => s + i.totalQty, 0);
    const jamaQty = entries.reduce((s, e) => s + e.jamaQty, 0);
    const damageQty = entries.reduce((s, e) => s + e.damageQty, 0);
    const shortageQty = entries.reduce((s, e) => s + e.shortageQty, 0);
    const noWorkQty = entries.reduce((s, e) => s + (e.noWorkQty ?? 0), 0);
    const balanceQty = totalQty - jamaQty - damageQty - shortageQty - noWorkQty;
    const hasReturnSlips = entries.length > 0;
    return {
      ...slip,
      seth: userMap.get(slip.sethId) ?? null,
      karigar: userMap.get(slip.karigarId) ?? null,
      totalQty,
      jamaQty,
      damageQty,
      shortageQty,
      noWorkQty,
      balanceQty,
      isComplete: balanceQty <= 0,
      items,
      hasReturnSlips,
      canDelete: slip.status !== "confirmed" && slip.status !== "completed" && !hasReturnSlips,
      canEdit: slip.status === "draft" && !hasReturnSlips,
    };
  });
}

// GET /job-slips
router.get("/job-slips", async (req: Request & { user?: any }, res): Promise<void> => {
  const userId = req.user.id;
  const { role, status } = req.query as { role?: string; status?: string };

  let rows;
  if (role === "seth") {
    rows = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.sethId, userId));
  } else if (role === "karigar") {
    rows = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.karigarId, userId));
  } else {
    rows = await db
      .select()
      .from(jobSlipsTable)
      .where(or(eq(jobSlipsTable.sethId, userId), eq(jobSlipsTable.karigarId, userId)));
  }

  if (status) {
    rows = rows.filter((r) => r.status === status);
  }

  rows = rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const enriched = await enrichJobSlipsBatch(rows);
  res.json(enriched);
});

// GET /job-slips/karigar/:karigarId/pending — Seth fetches pending slips FOR a specific karigar (for offline karigar return slip creation)
router.get("/job-slips/karigar/:karigarId/pending", async (req: Request & { user?: any }, res): Promise<void> => {
  const karigarId = parseInt(req.params.karigarId, 10);
  const sethId = req.user.id;

  if (isNaN(karigarId)) {
    res.status(400).json({ error: "Invalid karigarId" });
    return;
  }

  const rows = await db
    .select()
    .from(jobSlipsTable)
    .where(and(eq(jobSlipsTable.sethId, sethId), eq(jobSlipsTable.karigarId, karigarId)));

  const enriched = await enrichJobSlipsBatch(rows);
  const withBalance = enriched.filter((s) => s.balanceQty > 0);
  withBalance.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(withBalance);
});

// GET /job-slips/seth/:sethId/pending — must be before /:id
router.get("/job-slips/seth/:sethId/pending", async (req: Request & { user?: any }, res): Promise<void> => {
  const sethId = parseInt(req.params.sethId, 10);
  const userId = req.user.id;

  if (isNaN(sethId)) {
    res.status(400).json({ error: "Invalid sethId" });
    return;
  }

  const rows = await db
    .select()
    .from(jobSlipsTable)
    .where(and(eq(jobSlipsTable.sethId, sethId), eq(jobSlipsTable.karigarId, userId)));

  const enriched = await enrichJobSlipsBatch(rows);
  const withBalance = enriched.filter((s) => s.balanceQty > 0);
  withBalance.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(withBalance);
});

// GET /job-slips/:id
router.get("/job-slips/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [slip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));
  if (!slip) {
    res.status(404).json({ error: "Slip not found" });
    return;
  }

  res.json(await enrichJobSlip(slip, req.user.id));
});

// POST /job-slips
router.post("/job-slips", async (req: Request & { user?: any }, res): Promise<void> => {
  const { karigarId, notes, voiceNoteUrl, items } = req.body;

  if (!karigarId || !items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "karigarId aur items required hain" });
    return;
  }

  for (const item of items) {
    if (!item.itemName || !item.totalQty || item.totalQty <= 0) {
      res.status(400).json({ error: "Har item mein itemName aur totalQty required hai" });
      return;
    }
  }

  const count = await db.select().from(jobSlipsTable);
  const slipNumber = generateJobSlipNumber(count.length + 1);

  const [slip] = await db
    .insert(jobSlipsTable)
    .values({
      slipNumber,
      sethId: req.user.id,
      karigarId,
      status: "draft",
      notes: notes ?? null,
      voiceNoteUrl: voiceNoteUrl ?? null,
    })
    .returning();

  await db.insert(jobSlipItemsTable).values(
    items.map((item: any) => ({
      slipId: slip.id,
      itemName: item.itemName,
      totalQty: item.totalQty,
      ratePerPc: item.ratePerPc ? String(item.ratePerPc) : null,
      photoUrl: item.photoUrls && Array.isArray(item.photoUrls) && item.photoUrls.length > 0
        ? JSON.stringify(item.photoUrls)
        : (item.photoUrl ?? null),
      notes: item.notes ?? null,
    }))
  );

  res.json(await enrichJobSlip(slip));
});

// PATCH /job-slips/:id — Edit slip (draft only, no return slips)
router.patch("/job-slips/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [slip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));
  if (!slip) { res.status(404).json({ error: "Slip nahi mili" }); return; }
  if (slip.sethId !== req.user.id) { res.status(403).json({ error: "Sirf Seth edit kar sakta hai" }); return; }
  if (slip.status !== "draft") { res.status(400).json({ error: "Sirf draft slip edit ho sakti hai" }); return; }

  // Check no return slips reference this
  const returnEntries = await db
    .select({ id: returnSlipEntriesTable.id })
    .from(returnSlipEntriesTable)
    .where(eq(returnSlipEntriesTable.jobSlipId, id));
  if (returnEntries.length > 0) {
    res.status(400).json({ error: "Return slip link hai, edit nahi ho sakta" });
    return;
  }

  const { notes, items } = req.body;

  // Update notes
  await db
    .update(jobSlipsTable)
    .set({ notes: notes ?? null, updatedAt: new Date() })
    .where(eq(jobSlipsTable.id, id));

  // Replace items if provided
  if (items && Array.isArray(items) && items.length > 0) {
    for (const item of items) {
      if (!item.itemName || !item.totalQty || item.totalQty <= 0) {
        res.status(400).json({ error: "Har item mein itemName aur totalQty required hai" });
        return;
      }
    }
    await db.delete(jobSlipItemsTable).where(eq(jobSlipItemsTable.slipId, id));
    await db.insert(jobSlipItemsTable).values(
      items.map((item: any) => ({
        slipId: id,
        itemName: item.itemName,
        totalQty: item.totalQty,
        ratePerPc: item.ratePerPc ? String(item.ratePerPc) : null,
        photoUrl: item.photoUrl ?? null,
        notes: item.notes ?? null,
      }))
    );
  }

  const [updated] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));
  res.json(await enrichJobSlip(updated));
});

// DELETE /job-slips/:id
router.delete("/job-slips/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [slip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));
  if (!slip) { res.status(404).json({ error: "Slip nahi mili" }); return; }
  if (slip.sethId !== req.user.id) { res.status(403).json({ error: "Sirf Seth delete kar sakta hai" }); return; }

  // Protection 1: Karigar ne maal receive confirm kar diya
  if (slip.status === "confirmed" || slip.status === "completed") {
    res.status(400).json({ error: "Karigar ne maal mil jaane ki confirmation de di hai — ab delete nahi ho sakta" });
    return;
  }

  // Protection 2: Return slip linked hai
  const returnEntries = await db
    .select({ id: returnSlipEntriesTable.id })
    .from(returnSlipEntriesTable)
    .where(eq(returnSlipEntriesTable.jobSlipId, id));
  if (returnEntries.length > 0) {
    res.status(400).json({ error: "Is slip pe maal wapsi ki entry hai — pehle maal wapsi slip delete karo" });
    return;
  }

  // Safe to delete — first delete items, then slip
  await db.delete(jobSlipItemsTable).where(eq(jobSlipItemsTable.slipId, id));
  await db.delete(jobSlipsTable).where(eq(jobSlipsTable.id, id));

  res.json({ success: true });
});

// PATCH /job-slips/:id/send  — Seth draft ko karigar ko officially bhejta hai
router.patch("/job-slips/:id/send", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [slip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));
  if (!slip) { res.status(404).json({ error: "Slip nahi mili" }); return; }
  if (slip.sethId !== req.user.id) { res.status(403).json({ error: "Sirf Seth bhej sakta hai" }); return; }
  if (slip.status !== "draft") { res.status(400).json({ error: "Slip pehle se bheji ja chuki hai" }); return; }

  await db
    .update(jobSlipsTable)
    .set({ status: "sent", updatedAt: new Date() })
    .where(eq(jobSlipsTable.id, id));

  const balance = await computeSlipBalance(id);

  await db.insert(notificationsTable).values({
    userId: slip.karigarId,
    type: "maal_update",
    title: "Naya Maal Aya Hai",
    message: `${req.user.name || req.user.mobile} ne aapko maal bheja: Slip ${slip.slipNumber} (${balance.totalQty} pcs)`,
    referenceId: slip.id,
    referenceType: "job_slip",
  });

  const [updated] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));
  res.json(await enrichJobSlip(updated));
});

// PATCH /job-slips/:id/view
router.patch("/job-slips/:id/view", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [slip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));

  if (!slip) {
    res.status(404).json({ error: "Slip nahi mila" });
    return;
  }
  if (slip.karigarId !== req.user.id) {
    res.status(403).json({ error: "Sirf karigar view kar sakta hai" });
    return;
  }
  if (slip.status === "sent") {
    await db
      .update(jobSlipsTable)
      .set({ status: "viewed", updatedAt: new Date() })
      .where(eq(jobSlipsTable.id, id));

    await db.insert(notificationsTable).values({
      userId: slip.sethId,
      type: "maal_update",
      title: "Slip Dekh Li Gayi",
      message: `${req.user.name || req.user.mobile} ne aapki slip ${slip.slipNumber} dekh li`,
      referenceId: slip.id,
      referenceType: "job_slip",
    });
  }

  const [updated] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));
  res.json(await enrichJobSlip(updated));
});

// PATCH /job-slips/:id/confirm
router.patch("/job-slips/:id/confirm", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [slip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));

  if (!slip) {
    res.status(404).json({ error: "Slip nahi mila" });
    return;
  }
  if (slip.karigarId !== req.user.id) {
    res.status(403).json({ error: "Sirf karigar confirm kar sakta hai" });
    return;
  }

  await db
    .update(jobSlipsTable)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(jobSlipsTable.id, id));

  await db.insert(notificationsTable).values({
    userId: slip.sethId,
    type: "maal_update",
    title: "Maal Mil Gaya ✓",
    message: `${req.user.name || req.user.mobile} ne confirm kiya: Slip ${slip.slipNumber} ka maal mil gaya`,
    referenceId: slip.id,
    referenceType: "job_slip",
  });

  const [updated] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, id));
  res.json(await enrichJobSlip(updated));
});

export default router;
