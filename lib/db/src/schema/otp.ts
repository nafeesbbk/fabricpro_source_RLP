import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export const otpTable = pgTable("otp", {
  id: serial("id").primaryKey(),
  mobile: text("mobile").notNull(),
  otp: text("otp").notNull(),
  used: boolean("used").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
