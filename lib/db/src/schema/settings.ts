import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;

// Default settings
export const DEFAULT_SETTINGS: Record<string, string> = {
  trial_days: "30",
  trial_slips: "100",
  trial_chat_users: "25",
  trial_gallery_days: "5",
  basic_price_monthly: "100",
  basic_chat_users: "50",
  basic_gallery_days: "90",
  pro_price_monthly: "250",
  pro_price_yearly: "2500",
  gallery_daily_limit: "10",
  registration_required: "false",
  registration_fee: "50",
  registration_upi_id: "",
  registration_upi_name: "",
  otp_mode: "system",
  admin_whatsapp: "",
  connection_approval: "false",
  admin_email: "",
  admin_mobile: "",
};
