import { Router } from "express";
import { eq, and, or, desc, inArray, isNull, not, ilike } from "drizzle-orm";
import { db, usersTable, messagesTable, connectionsTable } from "@workspace/db";
import { SendMessageBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import type { Request } from "express";

const router = Router();
router.use(requireAuth);

function sanitizeUser(u: Record<string, any>) {
  const { password, ...rest } = u;
  return { ...rest, hasPassword: !!password };
}

// Truncate image/voice content for list views (avoid sending huge base64)
function truncateContent(msg: any) {
  if (!msg) return msg;
  if (msg.type === "image") return { ...msg, content: "📷 Photo" };
  if (msg.type === "voice") return { ...msg, content: "🎤 Voice note" };
  return msg;
}

// GET /chat/conversations
router.get("/chat/conversations", async (req: Request & { user?: any }, res): Promise<void> => {
  const me = req.user;

  const allMsgs = await db
    .select()
    .from(messagesTable)
    .where(or(eq(messagesTable.fromUserId, me.id), eq(messagesTable.toUserId, me.id)))
    .orderBy(desc(messagesTable.createdAt));

  // Mark undelivered incoming messages as delivered
  const undeliveredIds = allMsgs
    .filter((m) => m.toUserId === me.id && !m.deliveredAt)
    .map((m) => m.id);
  if (undeliveredIds.length > 0) {
    await db
      .update(messagesTable)
      .set({ deliveredAt: new Date() })
      .where(inArray(messagesTable.id, undeliveredIds));
  }

  // Build conversation map: latest message per partner
  const convMap = new Map<number, typeof allMsgs[0]>();
  for (const msg of allMsgs) {
    const partnerId = msg.fromUserId === me.id ? msg.toUserId : msg.fromUserId;
    if (!convMap.has(partnerId)) convMap.set(partnerId, msg);
  }

  // Count unread per partner
  const unreadMap = new Map<number, number>();
  for (const msg of allMsgs) {
    if (msg.toUserId === me.id && !msg.readAt) {
      unreadMap.set(msg.fromUserId, (unreadMap.get(msg.fromUserId) ?? 0) + 1);
    }
  }

  const partnerIds = Array.from(convMap.keys());
  if (partnerIds.length === 0) { res.json([]); return; }

  const partnerUsers = await db
    .select()
    .from(usersTable)
    .where(inArray(usersTable.id, partnerIds));

  const conversations = partnerUsers.map((u) => ({
    userId: u.id,
    user: { id: u.id, code: u.code, name: u.name },
    lastMessage: truncateContent(convMap.get(u.id)),
    unreadCount: unreadMap.get(u.id) ?? 0,
  })).sort((a, b) => {
    const aTime = (a.lastMessage as any)?.createdAt?.getTime() ?? 0;
    const bTime = (b.lastMessage as any)?.createdAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  res.json(conversations);
});

// GET /chat/search — search ALL registered users, return connection status
router.get("/chat/search", async (req: Request & { user?: any }, res): Promise<void> => {
  const me = req.user;
  const q = ((req.query.q as string) ?? "").trim();
  if (q.length < 2) { res.json([]); return; }

  // Get my connections (all statuses)
  const myConns = await db.select().from(connectionsTable).where(
    or(eq(connectionsTable.fromUserId, me.id), eq(connectionsTable.toUserId, me.id))
  );

  // Build connection status map
  const connStatusMap = new Map<number, string>();
  for (const conn of myConns) {
    const otherId = conn.fromUserId === me.id ? conn.toUserId : conn.fromUserId;
    connStatusMap.set(otherId, conn.status);
  }

  // Search all non-deleted users except self
  const allUsers = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      mobile: usersTable.mobile,
      code: usersTable.code,
      role: usersTable.role,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .where(and(isNull(usersTable.deletedAt), not(eq(usersTable.id, me.id))));

  const ql = q.toLowerCase();
  const matches = allUsers
    .filter(u =>
      (u.name ?? "").toLowerCase().includes(ql) ||
      (u.mobile ?? "").includes(q) ||
      (u.code ?? "").toLowerCase().includes(ql)
    )
    .slice(0, 20)
    .map(u => ({
      id: u.id,
      name: u.name,
      mobile: u.mobile,
      code: u.code,
      role: u.role,
      avatarUrl: u.avatarUrl,
      connectionStatus: connStatusMap.get(u.id) ?? "none",
    }));

  res.json(matches);
});

// GET /chat/:userId — get messages, mark as read + delivered
router.get("/chat/:userId", async (req: Request & { user?: any }, res): Promise<void> => {
  const me = req.user;
  const otherId = parseInt(req.params.userId, 10);
  if (isNaN(otherId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const messages = await db
    .select()
    .from(messagesTable)
    .where(
      or(
        and(eq(messagesTable.fromUserId, me.id), eq(messagesTable.toUserId, otherId)),
        and(eq(messagesTable.fromUserId, otherId), eq(messagesTable.toUserId, me.id)),
      )
    )
    .orderBy(messagesTable.createdAt);

  const now = new Date();

  // Mark undelivered incoming
  const undeliveredIds = messages.filter(m => m.toUserId === me.id && !m.deliveredAt).map(m => m.id);
  if (undeliveredIds.length > 0) {
    await db.update(messagesTable).set({ deliveredAt: now }).where(inArray(messagesTable.id, undeliveredIds));
  }

  // Mark unread incoming as read
  const unreadIds = messages.filter(m => m.toUserId === me.id && !m.readAt).map(m => m.id);
  if (unreadIds.length > 0) {
    await db.update(messagesTable).set({ readAt: now, deliveredAt: now }).where(inArray(messagesTable.id, unreadIds));
  }

  // Return with updated statuses reflected
  const result = messages.map(m => {
    if (m.toUserId === me.id) {
      return { ...m, deliveredAt: m.deliveredAt ?? now, readAt: m.readAt ?? now };
    }
    return m;
  });

  res.json(result);
});

// DELETE /chat/:userId/conversation
router.delete("/chat/:userId/conversation", async (req: Request & { user?: any }, res): Promise<void> => {
  const me = req.user;
  const otherId = parseInt(req.params.userId, 10);
  if (isNaN(otherId)) { res.status(400).json({ error: "Invalid userId" }); return; }
  await db.delete(messagesTable).where(
    or(
      and(eq(messagesTable.fromUserId, me.id), eq(messagesTable.toUserId, otherId)),
      and(eq(messagesTable.fromUserId, otherId), eq(messagesTable.toUserId, me.id))
    )
  );
  res.json({ success: true });
});

// POST /chat/:userId — send message
router.post("/chat/:userId", async (req: Request & { user?: any }, res): Promise<void> => {
  const me = req.user;
  const otherId = parseInt(req.params.userId, 10);
  if (isNaN(otherId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  const [recipient] = await db.select().from(usersTable).where(eq(usersTable.id, otherId));
  if (!recipient) { res.status(404).json({ error: "User nahi mila" }); return; }

  if (me.role !== "super_admin") {
    if (!me.chatEnabled) { res.status(403).json({ error: "Aapka chat disable hai. Admin se contact karo." }); return; }
    if (!recipient.chatEnabled) { res.status(403).json({ error: "Is user ka chat disable hai." }); return; }
  }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { type, content, replyToId, replyPreview } = parsed.data as any;
  const [msg] = await db
    .insert(messagesTable)
    .values({ fromUserId: me.id, toUserId: otherId, type, content, replyToId: replyToId ?? null, replyPreview: replyPreview ?? null })
    .returning();

  res.json(msg);
});

// DELETE /chat/:userId/clear — clear all messages between current user and other user
router.delete("/chat/:userId/clear", async (req: Request & { user?: any }, res): Promise<void> => {
  const me = req.user;
  const otherId = parseInt(req.params.userId, 10);
  if (isNaN(otherId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  await db
    .delete(messagesTable)
    .where(
      or(
        and(eq(messagesTable.fromUserId, me.id), eq(messagesTable.toUserId, otherId)),
        and(eq(messagesTable.fromUserId, otherId), eq(messagesTable.toUserId, me.id))
      )
    );

  res.json({ success: true });
});

export default router;
