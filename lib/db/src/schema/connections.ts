import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const connectionsTable = pgTable("connections", {
  id: serial("id").primaryKey(),
  fromUserId: integer("from_user_id").notNull().references(() => usersTable.id),
  toUserId: integer("to_user_id").notNull().references(() => usersTable.id),
  roleLabel: text("role_label").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertConnectionSchema = createInsertSchema(connectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConnection = z.infer<typeof insertConnectionSchema>;
export type Connection = typeof connectionsTable.$inferSelect;
