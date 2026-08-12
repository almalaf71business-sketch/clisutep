import { describe, expect, it, vi } from "vitest";
import { buildYoutubeAuthUrl, buildYoutubeVideoMetadata, createYoutubeState, decryptRefreshToken, encryptRefreshToken, SUPPORTED_VIDEO_MIME_TYPES, toYoutubePublicConnection, uploadYoutubeVideo, verifyYoutubeState } from "./youtube";
import { appRouter } from "./routers";
import * as db from "./db";

describe("YouTube OAuth configuration", () => {
  it("encrypts refresh tokens so the stored value is not plaintext", () => {
    const original = "refresh-token-example";
    const encrypted = encryptRefreshToken(original);
    expect(encrypted).not.toBe(original);
    expect(decryptRefreshToken(encrypted)).toBe(original);
    expect(encrypted.split(".")).toHaveLength(3);
  });
  it("strips refreshToken from the public connection response", () => {
    const publicConnection = toYoutubePublicConnection({ id: 1, channelId: "channel-1", channelTitle: "دماغ مصري", createdAt: new Date(), updatedAt: new Date() });
    expect(publicConnection).not.toHaveProperty("refreshToken");
    expect(publicConnection).not.toHaveProperty("clientSecret");
  });

  it("returns null through youtube.status when no connection exists", async () => {
    const empty = await appRouter.createCaller({ user: { id: 999998 } as any, req: {} as any, res: {} as any }).youtube.status();
    expect(empty).toBeNull();
  });

  it("does not expose secrets through the actual youtube.status procedure", async () => {
    const mockedConnection = { id: 7, channelId: "channel-1", channelTitle: "دماغ مصري", createdAt: new Date(), updatedAt: new Date() };
    const spy = vi.spyOn(db, "getYoutubeConnection").mockResolvedValue(mockedConnection);
    const result = await appRouter.createCaller({ user: { id: 999999 } as any, req: {} as any, res: {} as any }).youtube.status();
    expect(result).toEqual(mockedConnection);
    expect(result).not.toHaveProperty("refreshToken");
    expect(result).not.toHaveProperty("clientSecret");
    expect(spy).toHaveBeenCalledWith(999999);
    spy.mockRestore();
  });

  it("builds and verifies OAuth consent state", async () => {
    const redirectUri = "https://example.test/api/youtube/callback";
    const state = await createYoutubeState(42, redirectUri);
    const verified = await verifyYoutubeState(state);
    expect(verified).toEqual({ userId: 42, redirectUri });
    const authUrl = buildYoutubeAuthUrl(state, redirectUri);
    expect(authUrl).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl).toContain("youtube.upload");
  });

  it("builds private scheduled upload metadata correctly", () => {
    const metadata = buildYoutubeVideoMetadata({ title: "عنوان", description: "وصف", keywords: "ذكاء اصطناعي, أدوات", privacyStatus: "private", publishAt: "2026-08-20T12:00:00.000Z" });
    expect(metadata.status).toEqual({ privacyStatus: "private", publishAt: "2026-08-20T12:00:00.000Z" });
    expect(metadata.snippet.tags).toEqual(["ذكاء اصطناعي", "أدوات"]);
  });

  it("rejects unsupported video types and invalid scheduling", async () => {
    expect(SUPPORTED_VIDEO_MIME_TYPES).toEqual(["video/mp4", "video/webm", "video/quicktime"]);
    await expect(uploadYoutubeVideo({ accessToken: "test", filePath: "/tmp/no-file", contentType: "video/avi", title: "عنوان", description: "", privacyStatus: "private" })).rejects.toThrow("صيغة الفيديو غير مدعومة");
    await expect(uploadYoutubeVideo({ accessToken: "test", filePath: "/tmp/no-file", contentType: "video/mp4", title: "عنوان", description: "", privacyStatus: "public", publishAt: new Date(Date.now() + 60_000).toISOString() })).rejects.toThrow("خاص");
    await expect(uploadYoutubeVideo({ accessToken: "test", filePath: "/tmp/no-file", contentType: "video/mp4", title: "عنوان", description: "", privacyStatus: "private", publishAt: new Date(Date.now() - 60_000).toISOString() })).rejects.toThrow("المستقبل");
  });

  it("accepts the configured Google OAuth client credentials", async () => {
    const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_YOUTUBE_CLIENT_SECRET;
    expect(clientId).toBeTruthy();
    expect(clientSecret).toBeTruthy();

    const body = new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: "authorization_code",
      code: "validation-only-invalid-code",
    });
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const payload = await response.json() as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).not.toBe("invalid_client");
  }, 15000);
});
