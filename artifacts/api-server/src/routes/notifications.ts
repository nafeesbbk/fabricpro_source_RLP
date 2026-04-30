import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { MarkNotificationReadParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

// GET /notifications
router.get("/notifications", async (req: Request & { user?: any }, res): Promise<void> => {
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.user.id))
    .orderBy(notificationsTable.createdAt);

  res.json(rows.reverse());
});

// POST /notifications/:id/read
router.post("/notifications/:id/read", async (req: Request & { user?: any }, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user.id)));

  res.json({ success: true });
});

// POST /notifications/read-all
router.post("/notifications/read-all", async (req: Request & { user?: any }, res): Promise<void> => {
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, req.user.id));

  res.json({ success: true });
});

export default router;
