import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const contentItems = pgTable("content_items", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  analysisMode: text("analysis_mode"),
  summary: text("summary").notNull().default(""),
  transcript: text("transcript"),
  keyTopics: text("key_topics"),
  insights: text("insights"),
  rawCaption: text("raw_caption"),
  thumbnailData: text("thumbnail_data"),
  status: text("status").notNull().default("processing"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const contentImages = pgTable("content_images", {
  id: serial("id").primaryKey(),
  contentId: integer("content_id")
    .notNull()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  imageData: text("image_data").notNull(),
  orderIndex: integer("order_index").notNull(),
});

export const qaMessages = pgTable("qa_messages", {
  id: serial("id").primaryKey(),
  contentId: integer("content_id")
    .notNull()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type ContentItem = typeof contentItems.$inferSelect;
export type ContentImage = typeof contentImages.$inferSelect;
export type QAMessage = typeof qaMessages.$inferSelect;
