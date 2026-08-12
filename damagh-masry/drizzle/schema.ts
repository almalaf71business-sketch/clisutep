import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const youtubeConnections = mysqlTable("youtube_connections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  channelId: varchar("channelId", { length: 128 }).notNull(),
  channelTitle: varchar("channelTitle", { length: 255 }).notNull(),
  refreshToken: text("refreshToken").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const videoContents = mysqlTable("video_contents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  idea: text("idea").notNull(),
  topic: varchar("topic", { length: 180 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  category: mysqlEnum("category", ["technology", "ai", "useful_info"]).notNull(),
  status: mysqlEnum("status", ["idea", "draft", "review", "ready", "published"]).default("idea").notNull(),
  script: text("script"),
  description: text("description"),
  keywords: text("keywords"),
  scheduledAt: timestamp("scheduledAt"),
  publishSlot: varchar("publishSlot", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type VideoContent = typeof videoContents.$inferSelect;
export type InsertVideoContent = typeof videoContents.$inferInsert;
