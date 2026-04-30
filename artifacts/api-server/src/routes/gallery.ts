import { Router } from "express";
import { eq, and, isNull, gte, inArray, desc, count, sql } from "drizzle-orm";
import { db, galleryImagesTable, usersTable, connectionsTable, appSettingsTable, DEFAULT_SETTINGS } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

async function getSetting(key: string): Promise<string> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? DEFAULT_SETTINGS[key] ?? "0";
}

async function getRetentionDays(plan: string): Promise<{ days: number; unlimited: boolean }> {
  if (plan === "pro") return { days: 36500, unlimited: true };
  if (plan === "basic") {
    const d = parseInt(await getSetting("basic_gallery_days"), 10);
    return { days: d, unlimited: false };
  }
  if (plan === "inactive") return { days: 0, unlimited: false };
  const d = parseInt(await getSetting("trial_gallery_days"), 10);
  return { days: d, unlimited: false };
}

function sanitizeUploader(u: Record<string, any>) {
  const { password, ...rest } = u;
  return rest;
}

// GET /gallery — get gallery images
router.get("/gallery", async (req: Request & { user?: any }, res): Promise<void> => {
  const user = req.user;
  // super_admin always has unlimited gallery access regardless of plan
  const effectivePlan = user.role === "super_admin" ? "pro" : (user.plan ?? "trial");
  const { days, unlimited } = await getRetentionDays(effectivePlan);

  if (!unlimited && days <= 0) {
    res.json({ images: [], total: 0, retentionDays: 0, plan: user.plan ?? "trial" });
    return;
  }

  const cutoff = unlimited ? new Date(0) : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const connections = await db
    .select()
    .from(connectionsTable)
    .where(
      and(
        eq(connectionsTable.status, "accepted"),
        eq(connectionsTable.fromUserId, user.id)
      )
    );
  const connections2 = await db
    .select()
    .from(connectionsTable)
    .where(
      and(
        eq(connectionsTable.status, "accepted"),
        eq(connectionsTable.toUserId, user.id)
      )
    );

  const connectedUserIds = [
    ...connections.map((c) => c.toUserId),
    ...connections2.map((c) => c.fromUserId),
    user.id,
  ];

  const allImages = await db
    .select()
    .from(galleryImagesTable)
    .where(
      and(
        isNull(galleryImagesTable.deletedAt),
        gte(galleryImagesTable.uploadedAt, cutoff),
        inArray(galleryImagesTable.uploadedBy, connectedUserIds)
      )
    )
    .orderBy(desc(galleryImagesTable.uploadedAt));

  const uploaderIds = [...new Set(allImages.map((i) => i.uploadedBy))];
  const uploaders =
    uploaderIds.length > 0
      ? await db.select().from(usersTable).where(inArray(usersTable.id, uploaderIds))
      : [];
  const uploaderMap = Object.fromEntries(uploaders.map((u) => [u.id, sanitizeUploader(u)]));

  const response = allImages.map((img) => {
    const isOwn = img.uploadedBy === user.id;
    const uploaderPlan = (uploaderMap[img.uploadedBy] as any)?.plan ?? "trial";
    const uploaderRetentionDays =
      uploaderPlan === "pro" ? 36500 : uploaderPlan === "basic" ? parseInt(DEFAULT_SETTINGS.basic_gallery_days, 10) : parseInt(DEFAULT_SETTINGS.trial_gallery_days, 10);
    const expiresAt = new Date(new Date(img.uploadedAt).getTime() + uploaderRetentionDays * 24 * 60 * 60 * 1000);

    return {
      id: img.id,
      uploadedBy: img.uploadedBy,
      uploader: uploaderMap[img.uploadedBy] ?? null,
      thumbnail: img.thumbnail,
      caption: img.caption,
      uploadedAt: img.uploadedAt,
      expiresAt: expiresAt.toISOString(),
      isOwn,
    };
  });

  res.json({ images: response, total: response.length, retentionDays: days, plan: user.plan ?? "trial" });
});

// GET /gallery/my-limit — get current user's gallery limit info
router.get("/gallery/my-limit", async (req: Request & { user?: any }, res): Promise<void> => {
  const user = req.user;
  const plan = user.role === "super_admin" ? "pro" : (user.plan ?? "trial");
  const { days, unlimited } = await getRetentionDays(plan);

  let message = "";
  if (plan === "pro") {
    message = "Pro plan: Gallery images unlimited time tak rehti hain";
  } else if (plan === "inactive") {
    message = "Account inactive hai — gallery access nahi hai";
  } else if (plan === "basic") {
    message = `Basic plan: Images ${days} din tak gallery mein rehti hain`;
  } else {
    message = `Trial plan: Images sirf ${days} din tak gallery mein rehti hain`;
  }

  res.json({ plan, retentionDays: days, isUnlimited: unlimited, message });
});

// POST /gallery — upload image
router.post("/gallery", async (req: Request & { user?: any }, res): Promise<void> => {
  const user = req.user;
  const { thumbnail, fullImage, caption } = req.body;

  if (!thumbnail || typeof thumbnail !== "string") {
    res.status(400).json({ error: "thumbnail required" });
    return;
  }
  if (!fullImage || typeof fullImage !== "string") {
    res.status(400).json({ error: "fullImage required" });
    return;
  }

  const plan = user.role === "super_admin" ? "pro" : (user.plan ?? "trial");
  const { days } = await getRetentionDays(plan);

  if (days <= 0 && plan !== "pro") {
    res.status(403).json({ error: "Aapke plan mein gallery access nahi hai" });
    return;
  }

  // Daily upload limit check (skip for super_admin)
  if (user.role !== "super_admin") {
    const dailyLimitStr = await getSetting("gallery_daily_limit");
    const dailyLimit = parseInt(dailyLimitStr, 10) || 10;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [{ value: todayCount }] = await db
      .select({ value: count() })
      .from(galleryImagesTable)
      .where(
        and(
          eq(galleryImagesTable.uploadedBy, user.id),
          isNull(galleryImagesTable.deletedAt),
          gte(galleryImagesTable.uploadedAt, todayStart)
        )
      );
    if (todayCount >= dailyLimit) {
      res.status(429).json({ error: `Aaj ki upload limit (${dailyLimit} images) poori ho gayi. Kal try karo.` });
      return;
    }
  }

  const [inserted] = await db
    .insert(galleryImagesTable)
    .values({
      uploadedBy: user.id,
      thumbnail,
      fullImage,
      caption: caption ?? null,
    })
    .returning();

  res.status(201).json({
    id: inserted.id,
    uploadedBy: inserted.uploadedBy,
    thumbnail: inserted.thumbnail,
    caption: inserted.caption,
    uploadedAt: inserted.uploadedAt,
    isOwn: true,
  });
});

// DELETE /gallery/:id — soft delete (uploader only)
router.delete("/gallery/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [img] = await db.select().from(galleryImagesTable).where(eq(galleryImagesTable.id, id));
  if (!img) {
    res.status(404).json({ error: "Image nahi mili" });
    return;
  }
  if (img.uploadedBy !== req.user.id && req.user.role !== "super_admin") {
    res.status(403).json({ error: "Sirf apni image delete kar sakte ho" });
    return;
  }

  await db.update(galleryImagesTable).set({ deletedAt: new Date() }).where(eq(galleryImagesTable.id, id));
  res.json({ ok: true });
});

export default router;
