import { pgTable, text, serial, timestamp, boolean, integer, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name"),
  mobile: text("mobile").notNull().unique(),
  role: text("role").notNull().default("karigar"),
  address: text("address"),
  password: text("password"),
  avatarUrl: text("avatar_url"),
  aadhaar: text("aadhaar"),
  chatEnabled: boolean("chat_enabled").notNull().default(true),
  kycCompleted: boolean("kyc_completed").notNull().default(false),
  isOnline: boolean("is_online").notNull().default(false),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
  plan: text("plan").notNull().default("trial"),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  slipsUsed: integer("slips_used").notNull().default(0),
  activationStatus: text("activation_status").notNull().default("active"),
  paymentScreenshot: text("payment_screenshot"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),
  waToken: text("wa_token"),
  waTokenMode: text("wa_token_mode"),
  waTokenExpiry: timestamp("wa_token_expiry", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
