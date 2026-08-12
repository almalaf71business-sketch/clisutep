import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { SignJWT, jwtVerify } from "jose";

const scope = "https://www.googleapis.com/auth/youtube.upload";
const secretValue = process.env.JWT_SECRET || "fallback-youtube-state-secret";
const secret = new TextEncoder().encode(secretValue);
const encryptionKey = createHash("sha256").update(secretValue).digest();

export function encryptRefreshToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptRefreshToken(value: string) {
  const [ivEncoded, tagEncoded, dataEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !dataEncoded) throw new Error("Invalid encrypted refresh token");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataEncoded, "base64url")), decipher.final()]).toString("utf8");
}

export function toYoutubePublicConnection(row: { id: number; channelId: string; channelTitle: string; createdAt: Date; updatedAt: Date }) {
  return { id: row.id, channelId: row.channelId, channelTitle: row.channelTitle, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function getYoutubeRedirectUri(req: { protocol: string; get: (name: string) => string | undefined }) {
  const forwardedProto = req.get("x-forwarded-proto");
  const forwardedHost = req.get("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  return `${forwardedProto || req.protocol}://${host}/api/youtube/callback`;
}

export async function createYoutubeState(userId: number, redirectUri: string) {
  return new SignJWT({ userId, redirectUri, purpose: "youtube-oauth" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(secret);
}

export async function verifyYoutubeState(state: string) {
  const { payload } = await jwtVerify(state, secret);
  if (payload.purpose !== "youtube-oauth" || typeof payload.userId !== "number" || typeof payload.redirectUri !== "string") throw new Error("Invalid YouTube OAuth state");
  return { userId: payload.userId, redirectUri: payload.redirectUri };
}

export function buildYoutubeAuthUrl(state: string, redirectUri: string) {
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_YOUTUBE_CLIENT_ID || "", redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope, state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeYoutubeCode(code: string, redirectUri: string) {
  const body = new URLSearchParams({ code, client_id: process.env.GOOGLE_YOUTUBE_CLIENT_ID || "", client_secret: process.env.GOOGLE_YOUTUBE_CLIENT_SECRET || "", redirect_uri: redirectUri, grant_type: "authorization_code" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error("YouTube OAuth token exchange failed");
  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

export async function refreshYoutubeAccessToken(refreshToken: string) {
  const body = new URLSearchParams({ client_id: process.env.GOOGLE_YOUTUBE_CLIENT_ID || "", client_secret: process.env.GOOGLE_YOUTUBE_CLIENT_SECRET || "", refresh_token: refreshToken, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error("YouTube access token refresh failed");
  const payload = await response.json() as { access_token: string };
  return payload.access_token;
}

export const SUPPORTED_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export function buildYoutubeVideoMetadata(input: { title: string; description: string; keywords?: string; privacyStatus: "private" | "unlisted" | "public"; publishAt?: string }) {
  return { snippet: { title: input.title, description: input.description, tags: (input.keywords || "").split(",").map(tag => tag.trim()).filter(Boolean), categoryId: "22" }, status: { privacyStatus: input.privacyStatus, ...(input.publishAt ? { publishAt: input.publishAt } : {}) } };
}

export function validateYoutubeUploadRequest(input: { contentType: string; privacyStatus: "private" | "unlisted" | "public"; publishAt?: string }) {
  if (!(SUPPORTED_VIDEO_MIME_TYPES as readonly string[]).includes(input.contentType)) throw new Error("صيغة الفيديو غير مدعومة؛ استخدم MP4 أو WebM أو MOV");
  if (input.publishAt) {
    if (input.privacyStatus !== "private") throw new Error("الفيديو المجدول لازم يكون خاص قبل موعد النشر");
    if (new Date(input.publishAt).getTime() <= Date.now()) throw new Error("موعد النشر لازم يكون في المستقبل");
  }
}

export async function uploadYoutubeVideo(input: { accessToken: string; filePath: string; contentType: string; title: string; description: string; keywords?: string; privacyStatus: "private" | "unlisted" | "public"; publishAt?: string }) {
  validateYoutubeUploadRequest(input);
  const metadata = buildYoutubeVideoMetadata(input);
  const size = statSync(input.filePath).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": input.contentType }, body: JSON.stringify(metadata) });
  if (!init.ok) throw new Error("YouTube upload session could not be created");
  const location = init.headers.get("location");
  if (!location) throw new Error("YouTube upload location missing");
  const upload = await fetch(location, { method: "PUT", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": input.contentType, "Content-Length": String(size) }, body: createReadStream(input.filePath), duplex: "half" } as any);
  if (!upload.ok) throw new Error("YouTube video upload failed");
  return upload.json() as Promise<{ id: string; snippet?: { title?: string } }>;
}

export async function getYoutubeChannel(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("YouTube channel lookup failed");
  const payload = await response.json() as { items?: Array<{ id: string; snippet?: { title?: string } }> };
  const channel = payload.items?.[0];
  if (!channel) throw new Error("لم يتم العثور على قناة YouTube");
  return { channelId: channel.id, channelTitle: channel.snippet?.title || "قناة YouTube" };
}
