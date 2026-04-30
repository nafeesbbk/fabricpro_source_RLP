import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  fromUserId: integer("from_user_id").notNull().references(() => usersTable.id),
  toUserId: integer("to_user_id").notNull().references(() => usersTable.id),
  type: text("type").notNull().default("text"), // "text" | "voice" | "image"
  content: text("content").notNull(), // text, base64 audio, or base64 image data URL
  replyToId: integer("reply_to_id"), // nullable, references messages.id
  replyPreview: text("reply_preview"), // short preview of the replied message
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true, readAt: true, deliveredAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
