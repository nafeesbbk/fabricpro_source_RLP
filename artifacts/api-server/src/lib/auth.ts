import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

export async function getSession(token: string) {
  const now = new Date();
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.token, token),
        eq(sessionsTable.isActive, true),
        gt(sessionsTable.expiresAt, now),
      ),
    );
  return session ?? null;
}

export async function getUserFromToken(token: string) {
  const session = await getSession(token);
  if (!session) return null;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId));
  return user ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  getUserFromToken(token)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      (req as Request & { user: typeof user }).user = user;
      next();
    })
    .catch(next);
}

export function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export function generateUserCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 7; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function generateSlipId(counter: number): string {
  return `SLP-${String(counter).padStart(4, "0")}`;
}

export function generatePaymentId(counter: number): string {
  return `PAY-${String(counter).padStart(4, "0")}`;
}
