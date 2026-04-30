import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const galleryImagesTable = pgTable("gallery_images", {
  id: serial("id").primaryKey(),
  uploadedBy: integer("uploaded_by").notNull().references(() => usersTable.id),
  thumbnail: text("thumbnail").notNull(),
  fullImage: text("full_image").notNull(),
  caption: text("caption"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GalleryImage = typeof galleryImagesTable.$inferSelect;
