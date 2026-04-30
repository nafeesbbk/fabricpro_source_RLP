import { Router } from "express";
import { eq, or, and, desc, like } from "drizzle-orm";
import { db, connectionsTable, usersTable, notificationsTable, appSettingsTable, DEFAULT_SETTINGS, jobSlipsTable } from "@workspace/db";
import {
  SendConnectionRequestBody,
  GetConnectionsQueryParams,
  AcceptConnectionParams,
  RejectConnectionParams,
} from "@workspace/api-zod";
import { requireAuth, generateUserCode } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

// GET /connections
router.get("/connections", async (req: Request & { user?: any }, res): Promise<void> => {
  const params = GetConnectionsQueryParams.safeParse(req.query);
  const statusFilter = params.success ? params.data.status : undefined;
  const rawStatus = req.query.status as string | undefined;

  const userId = req.user.id;

  // Support "admin_review" status filter directly since it's not in zod enum
  const effectiveStatus = rawStatus ?? statusFilter;

  const rows = await db
    .select()
    .from(connectionsTable)
    .where(
      effectiveStatus
        ? and(
            or(eq(connectionsTable.fromUserId, userId), eq(connectionsTable.toUserId, userId)),
            eq(connectionsTable.status, effectiveStatus),
          )
        : or(eq(connectionsTable.fromUserId, userId), eq(connectionsTable.toUserId, userId)),
    )
    .orderBy(connectionsTable.createdAt);

  // Batch: fetch all job slips where userId is Seth or Karigar (to determine role per connection)
  const allMySlips = await db
    .select({ sethId: jobSlipsTable.sethId, karigarId: jobSlipsTable.karigarId })
    .from(jobSlipsTable)
    .where(or(eq(jobSlipsTable.sethId, userId), eq(jobSlipsTable.karigarId, userId)));

  // Build a map: otherUserId → myRole ("seth" | "karigar")
  const roleByOther = new Map<number, "seth" | "karigar">();
  for (const slip of allMySlips) {
    if (slip.sethId === userId) roleByOther.set(slip.karigarId, "seth");
    else roleByOther.set(slip.sethId, "karigar");
  }

  const result = await Promise.all(
    rows.map(async (conn) => {
      const otherUserId = conn.fromUserId === userId ? conn.toUserId : conn.fromUserId;
      const [connectedUser] = await db.select().from(usersTable).where(eq(usersTable.id, otherUserId));
      const myRole = roleByOther.get(otherUserId) ?? "unknown";
      return {
        ...conn,
        connectedUser: connectedUser ?? null,
        direction: conn.fromUserId === userId ? "sent" : "received",
        myRole,
      };
    }),
  );

  res.json(result);
});

// POST /connections/add-offline-karigar — Seth creates offline karigar (no phone required)
router.post("/connections/add-offline-karigar", async (req: Request & { user?: any }, res): Promise<void> => {
  const sethId = req.user.id;
  const { name, mobile: providedMobile } = req.body;

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    res.status(400).json({ error: "Karigar ka naam zaroori hai (kam se kam 2 akshar)" });
    return;
  }

  let mobile: string;

  if (providedMobile && typeof providedMobile === "string" && providedMobile.trim().length > 0) {
    // Real mobile provided — validate it
    const cleaned = providedMobile.trim().replace(/\D/g, "");
    if (cleaned.length !== 10 || !/^[6-9]/.test(cleaned)) {
      res.status(400).json({ error: "Mobile number 10 digit ka hona chahiye aur 6/7/8/9 se shuru hona chahiye" });
      return;
    }
    // Check if already exists
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.mobile, cleaned));
    if (existing) {
      res.status(400).json({ error: "Yeh mobile number pehle se registered hai. Use karo normal 'Connection Add' option." });
      return;
    }
    mobile = cleaned;
  } else {
    // Auto-generate dummy mobile (starts with 100, 10 digits)
    const dummyRows = await db
      .select({ mobile: usersTable.mobile })
      .from(usersTable)
      .where(like(usersTable.mobile, "100%"))
      .orderBy(desc(usersTable.mobile))
      .limit(1);

    if (dummyRows.length > 0) {
      const lastNum = parseInt(dummyRows[0].mobile, 10);
      mobile = String(lastNum + 1);
    } else {
      mobile = "1000000001";
    }
  }

  // Generate unique code
  let code = generateUserCode();
  let codeExists = await db.select().from(usersTable).where(eq(usersTable.code, code));
  while (codeExists.length > 0) {
    code = generateUserCode();
    codeExists = await db.select().from(usersTable).where(eq(usersTable.code, code));
  }

  // Create offline karigar user
  const [newKarigar] = await db
    .insert(usersTable)
    .values({
      name: name.trim(),
      mobile,
      code,
      role: "karigar",
      kycCompleted: true,
      activationStatus: "active",
    })
    .returning();

  // Create auto-accepted connection (Seth → Karigar)
  const [conn] = await db
    .insert(connectionsTable)
    .values({
      fromUserId: sethId,
      toUserId: newKarigar.id,
      roleLabel: "karigar",
      status: "accepted",
    })
    .returning();

  res.json({ ...conn, connectedUser: newKarigar, direction: "sent" });
});

// PATCH /connections/:id/update-offline-karigar — Seth updates offline karigar name/mobile
router.patch("/connections/:id/update-offline-karigar", async (req: Request & { user?: any }, res): Promise<void> => {
  const connId = parseInt(req.params.id, 10);
  const sethId = req.user.id;
  const { name, mobile: newMobile } = req.body;

  const [conn] = await db.select().from(connectionsTable).where(eq(connectionsTable.id, connId));
  if (!conn) {
    res.status(404).json({ error: "Connection nahi mila" });
    return;
  }
  if (conn.fromUserId !== sethId && conn.toUserId !== sethId) {
    res.status(403).json({ error: "Aap is connection ko edit nahi kar sakte" });
    return;
  }

  // The offline karigar is the OTHER user
  const karigarId = conn.fromUserId === sethId ? conn.toUserId : conn.fromUserId;
  const [karigar] = await db.select().from(usersTable).where(eq(usersTable.id, karigarId));
  if (!karigar) {
    res.status(404).json({ error: "Karigar nahi mila" });
    return;
  }

  // Only allow editing if karigar has dummy mobile (starts with "100")
  if (!karigar.mobile.startsWith("100")) {
    res.status(400).json({ error: "Yeh karigar real number se registered hai, edit nahi ho sakta" });
    return;
  }

  const updates: { name?: string; mobile?: string } = {};

  if (name && typeof name === "string" && name.trim().length >= 2) {
    updates.name = name.trim();
  }

  if (newMobile && typeof newMobile === "string" && newMobile.trim().length > 0) {
    const cleaned = newMobile.trim().replace(/\D/g, "");
    if (cleaned.length !== 10 || !/^[6-9]/.test(cleaned)) {
      res.status(400).json({ error: "Mobile 10 digit ka hona chahiye aur 6/7/8/9 se shuru hona chahiye" });
      return;
    }
    // Check duplicate
    const [dup] = await db.select().from(usersTable).where(eq(usersTable.mobile, cleaned));
    if (dup && dup.id !== karigarId) {
      res.status(400).json({ error: "Yeh number kisi aur ka account hai. Karigar se pehle apna number check karwa lo." });
      return;
    }
    updates.mobile = cleaned;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Kuch update karne ke liye naam ya mobile daalein" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, karigarId))
    .returning();

  res.json({ success: true, user: updated });
});

// POST /connections — sends to admin_review instead of directly pending
router.post("/connections", async (req: Request & { user?: any }, res): Promise<void> => {
  const parsed = SendConnectionRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userCode, roleLabel } = parsed.data;
  const fromUserId = req.user.id;

  // Find target user
  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.code, userCode));
  if (!targetUser) {
    res.status(404).json({ error: "User not found with this code" });
    return;
  }
  if (targetUser.id === fromUserId) {
    res.status(400).json({ error: "Cannot connect to yourself" });
    return;
  }

  // Check duplicate
  const existing = await db
    .select()
    .from(connectionsTable)
    .where(
      or(
        and(eq(connectionsTable.fromUserId, fromUserId), eq(connectionsTable.toUserId, targetUser.id)),
        and(eq(connectionsTable.fromUserId, targetUser.id), eq(connectionsTable.toUserId, fromUserId)),
      ),
    );
  if (existing.length > 0) {
    res.status(400).json({ error: "Connection already exists" });
    return;
  }

  // Check admin settings — is connection approval required?
  const settingRows = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "connection_approval"));
  const approvalRequired = settingRows.length > 0
    ? settingRows[0].value === "true"
    : DEFAULT_SETTINGS.connection_approval === "true";

  if (approvalRequired) {
    // Admin review flow — target user won't see until admin approves
    const [conn] = await db
      .insert(connectionsTable)
      .values({ fromUserId, toUserId: targetUser.id, roleLabel, status: "admin_review" })
      .returning();

    // Notify all super_admins
    const admins = await db.select().from(usersTable).where(eq(usersTable.role, "super_admin"));
    for (const admin of admins) {
      await db.insert(notificationsTable).values({
        userId: admin.id,
        type: "connection_request",
        title: "Naya Connection Request (Review Karo)",
        message: `${req.user.name || req.user.mobile} chahta hai ${targetUser.name || targetUser.mobile} se ${roleLabel} ke roop mein connect karna`,
        referenceId: conn.id,
        referenceType: "connection",
      });
    }
    res.json({ ...conn, connectedUser: targetUser, direction: "sent" });
  } else {
    // Direct flow — notify target user, let them accept/reject
    const [conn] = await db
      .insert(connectionsTable)
      .values({ fromUserId, toUserId: targetUser.id, roleLabel, status: "pending" })
      .returning();

    await db.insert(notificationsTable).values({
      userId: targetUser.id,
      type: "connection_request",
      title: "Naya Connection Request",
      message: `${req.user.name || req.user.mobile} ne aapko ${roleLabel} ke roop mein connect karna chahta hai`,
      referenceId: conn.id,
      referenceType: "connection",
    });
    res.json({ ...conn, connectedUser: targetUser, direction: "sent" });
  }
});

// POST /connections/:id/accept — kept for backward compat (admin may still use)
router.post("/connections/:id/accept", async (req: Request & { user?: any }, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [conn] = await db.select().from(connectionsTable).where(eq(connectionsTable.id, id));
  if (!conn) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }
  if (conn.toUserId !== req.user.id && req.user.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [updated] = await db
    .update(connectionsTable)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(eq(connectionsTable.id, id))
    .returning();

  await db.insert(notificationsTable).values({
    userId: conn.fromUserId,
    type: "connection_request",
    title: "Connection Accept Ho Gaya",
    message: `${req.user.name || req.user.mobile} ne aapka connection request accept kar liya`,
    referenceId: conn.id,
    referenceType: "connection",
  });

  const [fromUser] = await db.select().from(usersTable).where(eq(usersTable.id, conn.fromUserId));
  res.json({ ...updated, connectedUser: fromUser ?? null, direction: "received" });
});

// POST /connections/:id/reject — also allows sender to cancel their own request
router.post("/connections/:id/reject", async (req: Request & { user?: any }, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [conn] = await db.select().from(connectionsTable).where(eq(connectionsTable.id, id));
  if (!conn) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  const isSender = conn.fromUserId === req.user.id;
  const isReceiver = conn.toUserId === req.user.id;
  const isAdmin = req.user.role === "super_admin";

  if (!isSender && !isReceiver && !isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [updated] = await db
    .update(connectionsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(connectionsTable.id, id))
    .returning();

  const [fromUser] = await db.select().from(usersTable).where(eq(usersTable.id, conn.fromUserId));
  res.json({ ...updated, connectedUser: fromUser ?? null, direction: "received" });
});

// ── ADMIN ENDPOINTS ────────────────────────────────────────────────────────────

// GET /admin/connections/review — all admin_review connections
router.get("/admin/connections/review", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const rows = await db
    .select()
    .from(connectionsTable)
    .where(eq(connectionsTable.status, "admin_review"))
    .orderBy(connectionsTable.createdAt);

  const result = await Promise.all(
    rows.map(async (conn) => {
      const [fromUser] = await db.select().from(usersTable).where(eq(usersTable.id, conn.fromUserId));
      const [toUser] = await db.select().from(usersTable).where(eq(usersTable.id, conn.toUserId));
      return { ...conn, fromUser: fromUser ?? null, toUser: toUser ?? null };
    }),
  );

  res.json(result);
});

// POST /admin/connections/:id/approve — approve connection → accepted
router.post("/admin/connections/:id/approve", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [conn] = await db.select().from(connectionsTable).where(eq(connectionsTable.id, id));
  if (!conn) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db
    .update(connectionsTable)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(eq(connectionsTable.id, id))
    .returning();

  const [fromUser] = await db.select().from(usersTable).where(eq(usersTable.id, conn.fromUserId));
  const [toUser] = await db.select().from(usersTable).where(eq(usersTable.id, conn.toUserId));

  // Notify sender — request approved
  await db.insert(notificationsTable).values({
    userId: conn.fromUserId,
    type: "connection_request",
    title: "Connection Request Approve Ho Gaya ✅",
    message: `Admin ne aapki ${toUser?.name || toUser?.mobile || "user"} se connection request approve kar di`,
    referenceId: conn.id,
    referenceType: "connection",
  });

  // Notify target — new connection
  await db.insert(notificationsTable).values({
    userId: conn.toUserId,
    type: "connection_request",
    title: "Naya Connection Joda Gaya",
    message: `Admin ne ${fromUser?.name || fromUser?.mobile || "ek user"} ko ${conn.roleLabel} ke roop mein aapke saath connect kar diya`,
    referenceId: conn.id,
    referenceType: "connection",
  });

  res.json({ ...updated, fromUser: fromUser ?? null, toUser: toUser ?? null });
});

// POST /admin/connections/:id/reject — reject connection
router.post("/admin/connections/:id/reject", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [conn] = await db.select().from(connectionsTable).where(eq(connectionsTable.id, id));
  if (!conn) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db
    .update(connectionsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(connectionsTable.id, id))
    .returning();

  const [toUser] = await db.select().from(usersTable).where(eq(usersTable.id, conn.toUserId));

  // Notify sender — rejected
  await db.insert(notificationsTable).values({
    userId: conn.fromUserId,
    type: "connection_request",
    title: "Connection Request Reject Ho Gayi",
    message: `Admin ne ${toUser?.name || toUser?.mobile || "user"} se connection request approve nahi ki`,
    referenceId: conn.id,
    referenceType: "connection",
  });

  res.json(updated);
});

// PATCH /connections/:id/role — role label update (seth / karigar / both)
router.patch("/connections/:id/role", async (req: Request & { user?: any }, res): Promise<void> => {
  const connId = parseInt(req.params.id, 10);
  const { roleLabel } = req.body;

  if (!["seth", "karigar", "both"].includes(roleLabel)) {
    res.status(400).json({ error: "Invalid roleLabel — seth, karigar ya both hona chahiye" });
    return;
  }

  const [conn] = await db.select().from(connectionsTable).where(eq(connectionsTable.id, connId));
  if (!conn) {
    res.status(404).json({ error: "Connection nahi mili" });
    return;
  }
  if (conn.fromUserId !== req.user.id && conn.toUserId !== req.user.id) {
    res.status(403).json({ error: "Aap is connection ko update nahi kar sakte" });
    return;
  }
  if (conn.status !== "accepted") {
    res.status(400).json({ error: "Sirf accepted connection ka role badal sakte hain" });
    return;
  }

  const [updated] = await db
    .update(connectionsTable)
    .set({ roleLabel, updatedAt: new Date() })
    .where(eq(connectionsTable.id, connId))
    .returning();

  res.json(updated);
});

export default router;
