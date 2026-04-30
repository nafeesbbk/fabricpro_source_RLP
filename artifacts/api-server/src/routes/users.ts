import { Router } from "express";
import { eq, isNull, isNotNull, or } from "drizzle-orm";
import {
  db, usersTable, appSettingsTable, DEFAULT_SETTINGS,
  sessionsTable, otpTable, notificationsTable, messagesTable,
  connectionsTable, slipsTable, paymentsTable, galleryImagesTable,
} from "@workspace/db";
import { LookupUserByCodeQueryParams, AdminChangePasswordBody, AdminChangeMobileBody, AdminToggleChatBody, ActivateUserBody } from "@workspace/api-zod";
import { requireAuth, generateUserCode } from "../lib/auth";
import { hashPassword, verifyPassword, isValidPassword } from "../lib/password";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

function isUserOnline(lastSeen: Date | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - lastSeen.getTime() < ONLINE_THRESHOLD_MS;
}

function sanitizeUser(u: Record<string, any>) {
  const { password, ...rest } = u;
  return {
    ...rest,
    hasPassword: !!password,
    isOnline: isUserOnline(u.lastSeen instanceof Date ? u.lastSeen : u.lastSeen ? new Date(u.lastSeen) : null),
  };
}

// POST /users/me/heartbeat — mark current user online + optional location
router.post("/users/me/heartbeat", async (req: Request & { user?: any }, res): Promise<void> => {
  const updates: Record<string, any> = { isOnline: true, lastSeen: new Date() };
  const body = req.body ?? {};
  const lat = typeof body.lat === "number" ? body.lat : null;
  const lng = typeof body.lng === "number" ? body.lng : null;
  if (lat !== null && lng !== null) {
    updates.latitude = lat;
    updates.longitude = lng;
    updates.locationUpdatedAt = new Date();
  }
  await db.update(usersTable).set(updates).where(eq(usersTable.id, req.user.id));
  res.json({ ok: true });
});

// GET /users - admin only (active/non-deleted users only)
router.get("/users", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const users = await db.select().from(usersTable).where(isNull(usersTable.deletedAt)).orderBy(usersTable.createdAt);
  res.json(users.map(sanitizeUser));
});

// GET /admin/dead-users - soft-deleted users list
router.get("/admin/dead-users", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const users = await db.select().from(usersTable).where(isNotNull(usersTable.deletedAt)).orderBy(usersTable.deletedAt);
  res.json(users.map(sanitizeUser));
});

// DELETE /admin/users/:id - soft delete user (move to dead list)
router.delete("/admin/users/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (id === req.user.id) {
    res.status(400).json({ error: "Aap khud ko delete nahi kar sakte" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "User nahi mila" });
    return;
  }
  if (existing.role === "super_admin") {
    res.status(400).json({ error: "Admin user ko delete nahi kar sakte" });
    return;
  }
  const [deleted] = await db.update(usersTable)
    .set({ deletedAt: new Date(), deletedBy: req.user.id, isOnline: false })
    .where(eq(usersTable.id, id))
    .returning();
  res.json({ ok: true, user: sanitizeUser(deleted) });
});

// DELETE /admin/users/:id/permanent — hard delete (removes all data, allows re-registration)
router.delete("/admin/users/:id/permanent", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  if (id === req.user.id) { res.status(400).json({ error: "Aap khud ko delete nahi kar sakte" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User nahi mila" }); return; }
  if (user.role === "super_admin") { res.status(400).json({ error: "Admin user ko delete nahi kar sakte" }); return; }

  // Delete in correct order to respect FK constraints
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, id));
  await db.delete(otpTable).where(eq(otpTable.mobile, user.mobile));
  await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
  await db.delete(messagesTable).where(or(eq(messagesTable.fromUserId, id), eq(messagesTable.toUserId, id)));
  await db.delete(galleryImagesTable).where(eq(galleryImagesTable.uploadedBy, id));
  // Get connection IDs for this user, then delete payments/slips referencing them
  const userConns = await db.select().from(connectionsTable)
    .where(or(eq(connectionsTable.fromUserId, id), eq(connectionsTable.toUserId, id)));
  for (const conn of userConns) {
    await db.delete(paymentsTable).where(eq(paymentsTable.connectionId, conn.id));
  }
  await db.delete(slipsTable).where(or(eq(slipsTable.fromUserId, id), eq(slipsTable.toUserId, id)));
  await db.delete(connectionsTable).where(or(eq(connectionsTable.fromUserId, id), eq(connectionsTable.toUserId, id)));
  await db.delete(usersTable).where(eq(usersTable.id, id));

  res.json({ ok: true, mobile: user.mobile });
});

// GET /users/lookup-by-mobile — check if a mobile is registered (for phone contacts invite feature)
router.get("/users/lookup-by-mobile", async (req: Request & { user?: any }, res): Promise<void> => {
  const mobile = String(req.query.mobile || "").replace(/\D/g, "").slice(-10);
  if (mobile.length < 10) { res.status(400).json({ error: "Valid mobile required" }); return; }
  const [user] = await db.select({
    id: usersTable.id, name: usersTable.name, code: usersTable.code, mobile: usersTable.mobile,
    deletedAt: usersTable.deletedAt, kycCompleted: usersTable.kycCompleted,
  }).from(usersTable).where(eq(usersTable.mobile, mobile));
  // User doesn't exist or is permanently deleted (soft-deleted also treated as not available)
  if (!user || user.deletedAt) {
    res.json({ registered: false });
    return;
  }
  // User exists (even if KYC incomplete) — show them as registered
  res.json({
    registered: true,
    name: user.name ?? `+91 ${user.mobile}`,
    code: user.code,
    mobile: user.mobile,
    kycCompleted: user.kycCompleted,
  });
});

// PATCH /admin/users/:id/complete-kyc — manually complete KYC for a user
router.patch("/admin/users/:id/complete-kyc", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const body = req.body ?? {};
  const name = String(body.name ?? "").trim();
  const address = body.address ? String(body.address).trim() : null;
  const role = ["seth", "karigar"].includes(body.role) ? body.role : null;

  if (!name) {
    res.status(400).json({ error: "Naam zaroori hai" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) { res.status(404).json({ error: "User nahi mila" }); return; }
  if (existing.kycCompleted) { res.status(400).json({ error: "Is user ki KYC pehle se complete hai" }); return; }

  const updates: Record<string, any> = {
    name,
    kycCompleted: true,
    activationStatus: "active",
  };
  if (address) updates.address = address;
  if (role) updates.role = role;
  if (!existing.trialStartedAt) updates.trialStartedAt = new Date();

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  res.json(sanitizeUser(updated));
});

// PATCH /users/:id/chat — admin toggle chat permission
router.patch("/users/:id/chat", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = AdminToggleChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ chatEnabled: parsed.data.chatEnabled })
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User nahi mila" });
    return;
  }
  res.json(sanitizeUser(updated));
});

// PATCH /users/:id/password — admin resets any user's password
router.patch("/users/:id/password", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = AdminChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { password } = parsed.data;
  if (!isValidPassword(password)) {
    res.status(400).json({ error: "Password kam se kam 6 character hona chahiye (sirf letters aur numbers)" });
    return;
  }
  const hashed = hashPassword(password);
  const [updated] = await db
    .update(usersTable)
    .set({ password: hashed })
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User nahi mila" });
    return;
  }
  res.json(sanitizeUser(updated));
});

// PATCH /users/:id/mobile — admin changes any user's mobile
router.patch("/users/:id/mobile", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = AdminChangeMobileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { mobile } = parsed.data;
  if (!/^\d{10}$/.test(mobile)) {
    res.status(400).json({ error: "Mobile 10 digit hona chahiye" });
    return;
  }
  // Check duplicate
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
  if (existing && existing.id !== id) {
    res.status(409).json({ error: "Yeh mobile number pehle se kisi aur ka hai" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ mobile })
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User nahi mila" });
    return;
  }
  res.json(sanitizeUser(updated));
});

// Helper to get all settings with defaults filled in
async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(appSettingsTable);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

// GET /admin/settings — get admin settings
router.get("/admin/settings", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const settings = await getAllSettings();
  res.json(settings);
});

// PUT /admin/settings — update admin settings
router.put("/admin/settings", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const body = req.body as Record<string, string>;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  for (const [key, value] of Object.entries(body)) {
    if (typeof key !== "string" || typeof value !== "string") continue;
    await db
      .insert(appSettingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
  }
  const settings = await getAllSettings();
  res.json(settings);
});

// POST /admin/users/:id/activate — admin activates plan for user
router.post("/admin/users/:id/activate", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = ActivateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { plan, expiresAt } = parsed.data;
  const updates: Record<string, any> = { plan, activationStatus: "active" };
  if (expiresAt) updates.planExpiresAt = new Date(expiresAt);
  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User nahi mila" });
    return;
  }
  res.json(sanitizeUser(updated));
});

// POST /admin/users/create-dummy — admin creates pre-registered user with phone+password
router.post("/admin/users/create-dummy", async (req: Request & { user?: any }, res): Promise<void> => {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const { mobile, password, name, role } = req.body ?? {};
  if (!mobile || !/^\d{10}$/.test(String(mobile))) {
    res.status(400).json({ error: "Valid 10-digit mobile number dena zaroori hai" });
    return;
  }
  if (!password || !isValidPassword(String(password))) {
    res.status(400).json({ error: "Password 6+ alphanumeric hona chahiye" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.mobile, String(mobile)));
  if (existing) {
    res.status(409).json({ error: "Is mobile number se account pehle se hai" });
    return;
  }
  let code = generateUserCode();
  let codeCheck = await db.select().from(usersTable).where(eq(usersTable.code, code));
  while (codeCheck.length > 0) {
    code = generateUserCode();
    codeCheck = await db.select().from(usersTable).where(eq(usersTable.code, code));
  }
  const [created] = await db.insert(usersTable).values({
    mobile: String(mobile),
    code,
    password: hashPassword(String(password)),
    role: role === "seth" ? "seth" : "karigar",
    plan: "trial",
    trialStartedAt: new Date(),
    name: name ? String(name) : null,
    kycCompleted: false,
  }).returning();
  res.json(sanitizeUser(created));
});

// GET /users/lookup?code=XXX
router.get("/users/lookup", async (req: Request & { user?: any }, res): Promise<void> => {
  const params = LookupUserByCodeQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: "code is required" });
    return;
  }
  const [user] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.code, params.data.code));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

// PATCH /users/me/name — user updates own name
router.patch("/users/me/name", async (req: Request & { user?: any }, res): Promise<void> => {
  const name = String(req.body?.name ?? "").trim();
  if (!name || name.length < 2) {
    res.status(400).json({ error: "Naam kam se kam 2 characters ka hona chahiye" });
    return;
  }
  if (name.length > 60) {
    res.status(400).json({ error: "Naam bahut lamba hai (max 60 characters)" });
    return;
  }
  const [updated] = await db.update(usersTable).set({ name }).where(eq(usersTable.id, req.user.id)).returning();
  res.json(sanitizeUser(updated));
});

// PATCH /users/me/password — user changes own password (requires current password)
router.patch("/users/me/password", async (req: Request & { user?: any }, res): Promise<void> => {
  const currentPassword = String(req.body?.currentPassword ?? "").trim();
  const newPassword = String(req.body?.newPassword ?? "").trim();

  if (!currentPassword) {
    res.status(400).json({ error: "Purana password daalo" });
    return;
  }
  if (!newPassword || !isValidPassword(newPassword)) {
    res.status(400).json({ error: "Naya password kam se kam 6 characters ka hona chahiye" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
  if (!user) { res.status(404).json({ error: "User nahi mila" }); return; }

  if (!user.password || !verifyPassword(currentPassword, user.password)) {
    res.status(401).json({ error: "Purana password galat hai" });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ error: "Naya password purane se alag hona chahiye" });
    return;
  }

  const [updated] = await db.update(usersTable).set({ password: hp(newPassword) }).where(eq(usersTable.id, req.user.id)).returning();
  res.json(sanitizeUser(updated));
});

// PATCH /users/me/avatar — update profile avatar
router.patch("/users/me/avatar", async (req: Request & { user?: any }, res): Promise<void> => {
  const { avatarUrl } = req.body;
  if (!avatarUrl || typeof avatarUrl !== "string") {
    res.status(400).json({ error: "avatarUrl required" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ avatarUrl })
    .where(eq(usersTable.id, req.user.id))
    .returning();

  res.json(sanitizeUser(updated));
});

// GET /users/:id — get public profile
router.get("/users/:id", async (req: Request & { user?: any }, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, code: usersTable.code, name: usersTable.name, mobile: usersTable.mobile, avatarUrl: usersTable.avatarUrl, isOnline: usersTable.isOnline, lastSeen: usersTable.lastSeen })
    .from(usersTable)
    .where(eq(usersTable.id, id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

export default router;
