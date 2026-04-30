import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const jobSlipsTable = pgTable("job_slips", {
  id: serial("id").primaryKey(),
  slipNumber: text("slip_number").notNull().unique(),
  sethId: integer("seth_id").notNull().references(() => usersTable.id),
  karigarId: integer("karigar_id").notNull().references(() => usersTable.id),
  status: text("status").notNull().default("sent"),
  notes: text("notes"),
  voiceNoteUrl: text("voice_note_url"),
  // Payment tracking
  paidAmount: numeric("paid_amount").notNull().default("0"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobSlipItemsTable = pgTable("job_slip_items", {
  id: serial("id").primaryKey(),
  slipId: integer("slip_id").notNull().references(() => jobSlipsTable.id),
  itemName: text("item_name").notNull(),
  totalQty: integer("total_qty").notNull(),
  ratePerPc: numeric("rate_per_pc"),
  finalRate: numeric("final_rate"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const returnSlipsTable = pgTable("return_slips", {
  id: serial("id").primaryKey(),
  slipNumber: text("slip_number").notNull().unique(),
  karigarId: integer("karigar_id").notNull().references(() => usersTable.id),
  sethId: integer("seth_id").notNull().references(() => usersTable.id),
  notes: text("notes"),
  voiceNoteUrl: text("voice_note_url"),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const returnSlipEntriesTable = pgTable("return_slip_entries", {
  id: serial("id").primaryKey(),
  returnSlipId: integer("return_slip_id").notNull().references(() => returnSlipsTable.id),
  jobSlipId: integer("job_slip_id").notNull().references(() => jobSlipsTable.id),
  jamaQty: integer("jama_qty").notNull().default(0),
  damageQty: integer("damage_qty").notNull().default(0),
  shortageQty: integer("shortage_qty").notNull().default(0),
  noWorkQty: integer("no_work_qty").notNull().default(0), // Maal wapas — kaam nahi hua — zero payment
  ratePerPc: numeric("rate_per_pc"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobSlip = typeof jobSlipsTable.$inferSelect;
export type JobSlipItem = typeof jobSlipItemsTable.$inferSelect;
export type ReturnSlip = typeof returnSlipsTable.$inferSelect;
export type ReturnSlipEntry = typeof returnSlipEntriesTable.$inferSelect;
