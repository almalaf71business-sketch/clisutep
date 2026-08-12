import { and, desc, eq, like, or, isNotNull, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, InsertVideoContent, User, users, videoContents, youtubeConnections } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { encryptRefreshToken, decryptRefreshToken, toYoutubePublicConnection } from "./youtube";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; }
  }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function listVideos(userId: number, filters?: { status?: InsertVideoContent["status"]; category?: InsertVideoContent["category"]; search?: string; dateFilter?: "all" | "scheduled" | "this_week" }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(videoContents.userId, userId)];
  if (filters?.status) conditions.push(eq(videoContents.status, filters.status));
  if (filters?.category) conditions.push(eq(videoContents.category, filters.category));
  if (filters?.dateFilter === "scheduled") conditions.push(isNotNull(videoContents.scheduledAt));
  if (filters?.dateFilter === "this_week") { const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay()); conditions.push(gte(videoContents.updatedAt, start)); }
  if (filters?.search) {
    const term = `%${filters.search}%`;
    conditions.push(or(like(videoContents.title, term), like(videoContents.idea, term))!);
  }
  return db.select().from(videoContents).where(and(...conditions)).orderBy(desc(videoContents.updatedAt));
}

export async function getVideo(userId: number, id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(videoContents).where(and(eq(videoContents.userId, userId), eq(videoContents.id, id))).limit(1);
  return rows[0];
}

export async function createVideo(data: InsertVideoContent) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(videoContents).values(data);
  return getVideo(data.userId, Number(result[0].insertId));
}

export async function updateVideo(userId: number, id: number, data: Partial<InsertVideoContent>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(videoContents).set(data).where(and(eq(videoContents.userId, userId), eq(videoContents.id, id)));
  return getVideo(userId, id);
}

export async function getYoutubeConnection(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ id: youtubeConnections.id, channelId: youtubeConnections.channelId, channelTitle: youtubeConnections.channelTitle, createdAt: youtubeConnections.createdAt, updatedAt: youtubeConnections.updatedAt }).from(youtubeConnections).where(eq(youtubeConnections.userId, userId)).limit(1);
  return rows[0] ? toYoutubePublicConnection(rows[0]) : null;
}

export async function saveYoutubeConnection(data: { userId: number; channelId: string; channelTitle: string; refreshToken: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const encryptedToken = encryptRefreshToken(data.refreshToken);
  await db.insert(youtubeConnections).values({ ...data, refreshToken: encryptedToken }).onDuplicateKeyUpdate({ set: { channelId: data.channelId, channelTitle: data.channelTitle, refreshToken: encryptedToken, updatedAt: new Date() } });
  return getYoutubeConnection(data.userId);
}

export async function getYoutubeRefreshToken(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ refreshToken: youtubeConnections.refreshToken }).from(youtubeConnections).where(eq(youtubeConnections.userId, userId)).limit(1);
  return rows[0]?.refreshToken ? decryptRefreshToken(rows[0].refreshToken) : undefined;
}

export async function getVideoStats(userId: number) {
  const videos = await listVideos(userId);
  return {
    total: videos.length,
    ideas: videos.filter(v => v.status === "idea").length,
    drafts: videos.filter(v => v.status === "draft").length,
    review: videos.filter(v => v.status === "review").length,
    ready: videos.filter(v => v.status === "ready").length,
    published: videos.filter(v => v.status === "published").length,
    scheduled: videos.filter(v => Boolean(v.scheduledAt)).length,
  };
}
