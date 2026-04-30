import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { connectionsTable } from "./connections";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  paymentId: text("payment_id").notNull().unique(),
  fromUserId: integer("from_user_id").notNull().references(() => usersTable.id),
  toUserId: integer("to_user_id").notNull().references(() => usersTable.id),
  connectionId: integer("connection_id").notNull().references(() => connectionsTable.id),
  amount: numeric("amount").notNull(),
  note: text("note"),
  screenshotUrl: text("screenshot_url"),
  linkedSlipId: integer("linked_slip_id"),
  // New: link to job slip (new payment system)
  jobSlipId: integer("job_slip_id"),
  finalRate: numeric("final_rate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
