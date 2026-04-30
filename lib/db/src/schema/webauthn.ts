import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const webauthnCredentialsTable = pgTable("webauthn_credentials", {
  credentialId: text("credential_id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WebauthnCredential = typeof webauthnCredentialsTable.$inferSelect;
