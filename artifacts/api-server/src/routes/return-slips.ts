import { Router } from "express";
import { eq, and, or, inArray } from "drizzle-orm";
import {
  db,
  returnSlipsTable,
  returnSlipEntriesTable,
  jobSlipsTable,
  jobSlipItemsTable,
  usersTable,
  notificationsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

function generateReturnSlipNumber(count: number): string {
  return `WJ-${String(count).padStart(4, "0")}`;
}

async function enrichReturnSlip(slip: typeof returnSlipsTable.$inferSelect) {
  const [karigar] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name, mobile: usersTable.mobile })
    .from(usersTable)
    .where(eq(usersTable.id, slip.karigarId));

  const [seth] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name, mobile: usersTable.mobile })
    .from(usersTable)
    .where(eq(usersTable.id, slip.sethId));

  const rawEntries = await db
    .select()
    .from(returnSlipEntriesTable)
    .where(eq(returnSlipEntriesTable.returnSlipId, slip.id));

  const entries = await Promise.all(
    rawEntries.map(async (entry) => {
      const [jobSlip] = await db
        .select()
        .from(jobSlipsTable)
        .where(eq(jobSlipsTable.id, entry.jobSlipId));

      const items = jobSlip
        ? await db
            .select()
            .from(jobSlipItemsTable)
            .where(eq(jobSlipItemsTable.slipId, jobSlip.id))
        : [];

      const totalQty = items.reduce((sum, i) => sum + i.totalQty, 0);

      return {
        ...entry,
        ratePerPc: entry.ratePerPc ? parseFloat(entry.ratePerPc) : null,
        noWorkQty: entry.noWorkQty ?? 0,
        jobSlip: jobSlip
          ? {
              ...jobSlip,
              items,
              totalQty,
            }
          : null,
      };
    })
  );

  return {
    ...slip,
    karigar: karigar ?? null,
    seth: seth ?? null,
    entries,
  };
}

// Batch version for list — avoids N+1 queries
async function enrichReturnSlipsBatch(slips: (typeof returnSlipsTable.$inferSelect)[]) {
  if (slips.length === 0) return [];

  const slipIds = slips.map((s) => s.id);
  const userIds = [...new Set([...slips.map((s) => s.karigarId), ...slips.map((s) => s.sethId)])];

  const [allUsers, allEntries] = await Promise.all([
    db
      .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name, mobile: usersTable.mobile })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds)),
    db.select().from(returnSlipEntriesTable).where(inArray(returnSlipEntriesTable.returnSlipId, slipIds)),
  ]);

  const userMap = new Map(allUsers.map((u) => [u.id, u]));

  const jobSlipIds = [...new Set(allEntries.map((e) => e.jobSlipId))];
  const [allJobSlips, allJobItems] = jobSlipIds.length > 0
    ? await Promise.all([
        db.select().from(jobSlipsTable).where(inArray(jobSlipsTable.id, jobSlipIds)),
        db.select().from(jobSlipItemsTable).where(inArray(jobSlipItemsTable.slipId, jobSlipIds)),
      ])
    : [[], []];

  const jobSlipMap = new Map(allJobSlips.map((js) => [js.id, js]));
  const itemsByJobSlip = new Map<number, typeof allJobItems>();
  for (const item of allJobItems) {
    if (!itemsByJobSlip.has(item.slipId)) itemsByJobSlip.set(item.slipId, []);
    itemsByJobSlip.get(item.slipId)!.push(item);
  }

  const entriesByReturnSlip = new Map<number, typeof allEntries>();
  for (const entry of allEntries) {
    if (!entriesByReturnSlip.has(entry.returnSlipId)) entriesByReturnSlip.set(entry.returnSlipId, []);
    entriesByReturnSlip.get(entry.returnSlipId)!.push(entry);
  }

  return slips.map((slip) => {
    const entries = (entriesByReturnSlip.get(slip.id) ?? []).map((entry) => {
      const jobSlip = jobSlipMap.get(entry.jobSlipId);
      const items = itemsByJobSlip.get(entry.jobSlipId) ?? [];
      const totalQty = items.reduce((s, i) => s + i.totalQty, 0);
      return {
        ...entry,
        ratePerPc: entry.ratePerPc ? parseFloat(entry.ratePerPc) : null,
        noWorkQty: entry.noWorkQty ?? 0,
        jobSlip: jobSlip ? { ...jobSlip, items, totalQty } : null,
      };
    });
    return {
      ...slip,
      karigar: userMap.get(slip.karigarId) ?? null,
      seth: userMap.get(slip.sethId) ?? null,
      entries,
    };
  });
}

// GET /return-slips
router.get("/return-slips", async (req: Request & { user?: any }, res): Promise<void> => {
  const userId = req.user.id;
  const { role } = req.query as { role?: string };

  let rows;
  if (role === "karigar") {
    rows = await db.select().from(returnSlipsTable).where(eq(returnSlipsTable.karigarId, userId));
  } else if (role === "seth") {
    rows = await db.select().from(returnSlipsTable).where(eq(returnSlipsTable.sethId, userId));
  } else {
    rows = await db
      .select()
      .from(returnSlipsTable)
      .where(or(eq(returnSlipsTable.karigarId, userId), eq(returnSlipsTable.sethId, userId)));
  }

  rows = rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const enriched = await enrichReturnSlipsBatch(rows);
  res.json(enriched);
});

// GET /return-slips/:id
router.get("/return-slips/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [slip] = await db.select().from(returnSlipsTable).where(eq(returnSlipsTable.id, id));
  if (!slip) {
    res.status(404).json({ error: "Slip nahi mila" });
    return;
  }

  res.json(await enrichReturnSlip(slip));
});

// POST /return-slips
router.post("/return-slips", async (req: Request & { user?: any }, res): Promise<void> => {
  const { sethId, karigarId: karigarIdOverride, notes, voiceNoteUrl, entries } = req.body;

  if (!sethId || !entries || !Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: "sethId aur entries required hain" });
    return;
  }

  for (const entry of entries) {
    if (entry.jobSlipId == null) {
      res.status(400).json({ error: "Har entry mein jobSlipId required hai" });
      return;
    }
    const totalEntry =
      (entry.jamaQty || 0) + (entry.damageQty || 0) + (entry.shortageQty || 0) + (entry.noWorkQty || 0);
    if (totalEntry <= 0) {
      res.status(400).json({ error: "Har entry mein kuch qty honi chahiye (jama, damage, shortage, ya No Work)" });
      return;
    }
  }

  // Determine karigarId: if Seth is creating on behalf of an offline karigar, use the override
  let effectiveKarigarId: number = req.user.id;
  if (karigarIdOverride && typeof karigarIdOverride === "number" && karigarIdOverride !== req.user.id) {
    // Validate: the karigar must be an offline karigar (dummy mobile starting with "100")
    const [karigar] = await db.select().from(usersTable).where(eq(usersTable.id, karigarIdOverride));
    if (!karigar || !karigar.mobile.startsWith("100")) {
      res.status(400).json({ error: "Yeh karigar offline nahi hai — woh khud apni slip bana sakta hai" });
      return;
    }
    effectiveKarigarId = karigarIdOverride;
  }

  const count = await db.select().from(returnSlipsTable);
  const slipNumber = generateReturnSlipNumber(count.length + 1);

  const [slip] = await db
    .insert(returnSlipsTable)
    .values({
      slipNumber,
      karigarId: effectiveKarigarId,
      sethId,
      notes: notes ?? null,
      voiceNoteUrl: voiceNoteUrl ?? null,
    })
    .returning();

  await db.insert(returnSlipEntriesTable).values(
    entries.map((entry: any) => ({
      returnSlipId: slip.id,
      jobSlipId: entry.jobSlipId,
      jamaQty: entry.jamaQty || 0,
      damageQty: entry.damageQty || 0,
      shortageQty: entry.shortageQty || 0,
      noWorkQty: entry.noWorkQty || 0,
      ratePerPc: entry.ratePerPc ? String(entry.ratePerPc) : null,
      photoUrl: entry.photoUrl ?? null,
      notes: entry.notes ?? null,
    }))
  );

  // Update job slip status if fully returned
  const slipIds = entries.map((e: any) => e.jobSlipId);
  for (const jobSlipId of slipIds) {
    const [jobSlip] = await db.select().from(jobSlipsTable).where(eq(jobSlipsTable.id, jobSlipId));
    if (!jobSlip) continue;

    const items = await db.select().from(jobSlipItemsTable).where(eq(jobSlipItemsTable.slipId, jobSlip.id));
    const totalQty = items.reduce((sum, i) => sum + i.totalQty, 0);

    const allEntries = await db
      .select()
      .from(returnSlipEntriesTable)
      .where(eq(returnSlipEntriesTable.jobSlipId, jobSlip.id));

    const returned = allEntries.reduce(
      (sum, e) => sum + e.jamaQty + e.damageQty + e.shortageQty + (e.noWorkQty ?? 0),
      0
    );

    if (returned >= totalQty && jobSlip.status !== "completed") {
      await db
        .update(jobSlipsTable)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(jobSlipsTable.id, jobSlip.id));
    }
  }

  const totalReturnQty = entries.reduce(
    (sum: number, e: any) =>
      sum + (e.jamaQty || 0) + (e.damageQty || 0) + (e.shortageQty || 0) + (e.noWorkQty || 0),
    0
  );

  await db.insert(notificationsTable).values({
    userId: sethId,
    type: "maal_update",
    title: "Maal Wapas Aya",
    message: `${req.user.name || req.user.mobile} ne maal wapas kiya: Slip ${slipNumber} (${totalReturnQty} pcs)`,
    referenceId: slip.id,
    referenceType: "return_slip",
  });

  res.json(await enrichReturnSlip(slip));
});

// PATCH /return-slips/:id/view
router.patch("/return-slips/:id/view", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [slip] = await db.select().from(returnSlipsTable).where(eq(returnSlipsTable.id, id));

  if (!slip) {
    res.status(404).json({ error: "Slip nahi mila" });
    return;
  }
  if (slip.sethId !== req.user.id) {
    res.status(403).json({ error: "Sirf Seth dekh sakta hai" });
    return;
  }

  if (!slip.viewedAt) {
    await db
      .update(returnSlipsTable)
      .set({ viewedAt: new Date() })
      .where(eq(returnSlipsTable.id, id));

    await db.insert(notificationsTable).values({
      userId: slip.karigarId,
      type: "maal_update",
      title: "Return Slip Dekhi Gayi",
      message: `${req.user.name || req.user.mobile} ne aapki return slip ${slip.slipNumber} dekh li`,
      referenceId: slip.id,
      referenceType: "return_slip",
    });
  }

  const [updated] = await db.select().from(returnSlipsTable).where(eq(returnSlipsTable.id, id));
  res.json(await enrichReturnSlip(updated));
});

export default router;
