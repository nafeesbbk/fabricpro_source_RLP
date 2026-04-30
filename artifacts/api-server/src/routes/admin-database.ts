import { Router } from "express";
import {
  db,
  usersTable,
  connectionsTable,
  slipsTable,
  paymentsTable,
  notificationsTable,
  messagesTable,
  appSettingsTable,
  galleryImagesTable,
  jobSlipsTable,
  jobSlipItemsTable,
  returnSlipsTable,
  returnSlipEntriesTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();

router.get("/admin/database/backup", requireAuth, async (req, res) => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Sirf admin kar sakta hai" });
    return;
  }

  const [
    users,
    connections,
    slips,
    jobSlips,
    jobSlipItems,
    returnSlips,
    returnSlipEntries,
    payments,
    notifications,
    messages,
    settings,
    gallery,
  ] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(connectionsTable),
    db.select().from(slipsTable),
    db.select().from(jobSlipsTable),
    db.select().from(jobSlipItemsTable),
    db.select().from(returnSlipsTable),
    db.select().from(returnSlipEntriesTable),
    db.select().from(paymentsTable),
    db.select().from(notificationsTable),
    db.select().from(messagesTable),
    db.select().from(appSettingsTable),
    db.select().from(galleryImagesTable),
  ]);

  const backup = {
    version: "2.0",
    appName: "FabricPro",
    timestamp: new Date().toISOString(),
    data: {
      users,
      connections,
      slips,
      jobSlips,
      jobSlipItems,
      returnSlips,
      returnSlipEntries,
      payments,
      notifications,
      messages,
      settings,
      gallery,
    },
  };

  res.json(backup);
});

router.post("/admin/database/restore", requireAuth, async (req, res) => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Sirf admin kar sakta hai" });
    return;
  }

  const backup = req.body;
  if (!backup || !backup.data || !backup.version) {
    res.status(400).json({ error: "Galat backup file hai. Sahi FabricPro backup file select karo." });
    return;
  }

  const { slips, jobSlips, jobSlipItems, returnSlips, returnSlipEntries, payments, notifications } = backup.data;

  await db.delete(returnSlipEntriesTable);
  await db.delete(returnSlipsTable);
  await db.delete(jobSlipItemsTable);
  await db.delete(jobSlipsTable);
  await db.delete(slipsTable);
  await db.delete(paymentsTable);
  await db.delete(notificationsTable);

  if (slips?.length) await db.insert(slipsTable).values(slips);
  if (jobSlips?.length) await db.insert(jobSlipsTable).values(jobSlips);
  if (jobSlipItems?.length) await db.insert(jobSlipItemsTable).values(jobSlipItems);
  if (returnSlips?.length) await db.insert(returnSlipsTable).values(returnSlips);
  if (returnSlipEntries?.length) await db.insert(returnSlipEntriesTable).values(returnSlipEntries);
  if (payments?.length) await db.insert(paymentsTable).values(payments);
  if (notifications?.length) await db.insert(notificationsTable).values(notifications);

  res.json({ success: true, message: "Data restore ho gaya hai" });
});

router.delete("/admin/database/clean", requireAuth, async (req, res) => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Sirf admin kar sakta hai" });
    return;
  }

  await db.delete(returnSlipEntriesTable);
  await db.delete(returnSlipsTable);
  await db.delete(jobSlipItemsTable);
  await db.delete(jobSlipsTable);
  await db.delete(slipsTable);
  await db.delete(paymentsTable);
  await db.delete(notificationsTable);

  res.json({
    success: true,
    message: "Data clean ho gaya. Users, connections aur chat messages safe hain.",
  });
});

export default router;
