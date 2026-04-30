import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { connectionsTable } from "./connections";

export const slipsTable = pgTable("slips", {
  id: serial("id").primaryKey(),
  slipId: text("slip_id").notNull().unique(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  fromUserId: integer("from_user_id").notNull().references(() => usersTable.id),
  toUserId: integer("to_user_id").notNull().references(() => usersTable.id),
  connectionId: integer("connection_id").notNull().references(() => connectionsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity"),
  unit: text("unit"),
  imageUrl: text("image_url"),
  linkedSlipId: integer("linked_slip_id"),
  rate: numeric("rate"),
  notes: text("notes"),
  // Payment tracking fields
  paymentBill: numeric("payment_bill"),
  paidAmount: numeric("paid_amount").notNull().default("0"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertSlipSchema = createInsertSchema(slipsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSlip = z.infer<typeof insertSlipSchema>;
export type Slip = typeof slipsTable.$inferSelect;
