import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as context from "./_core/context";
import * as db from "./db";
import * as youtube from "./youtube";
import { registerYoutubeRoutes } from "./youtube-routes";

const userContext = { user: { id: 42 } as any, req: {} as any, res: {} as any };
function makeApp() {
  const app = express();
  app.use(express.json());
  registerYoutubeRoutes(app);
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe("YouTube route integration", () => {
  it("redirects an authenticated user to Google OAuth", async () => {
    vi.spyOn(context, "createContext").mockResolvedValue(userContext);
    const response = await request(makeApp()).get("/api/youtube/connect");
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(response.headers.location).toContain("youtube.upload");
    expect(response.headers.location).toContain(encodeURIComponent("/api/youtube/callback"));
  });

  it("redirects to an error state when OAuth callback exchange fails", async () => {
    const state = await youtube.createYoutubeState(42, "http://127.0.0.1/api/youtube/callback");
    vi.spyOn(youtube, "exchangeYoutubeCode").mockRejectedValue(new Error("exchange failed"));
    const response = await request(makeApp()).get(`/api/youtube/callback?code=bad&state=${encodeURIComponent(state)}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("youtube=error");
  });

  it("handles a successful OAuth callback and stores the channel", async () => {
    const state = await youtube.createYoutubeState(42, "http://127.0.0.1/api/youtube/callback");
    vi.spyOn(youtube, "exchangeYoutubeCode").mockResolvedValue({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    vi.spyOn(youtube, "getYoutubeChannel").mockResolvedValue({ channelId: "channel-1", channelTitle: "دماغ مصري" });
    const save = vi.spyOn(db, "saveYoutubeConnection").mockResolvedValue({ id: 1, channelId: "channel-1", channelTitle: "دماغ مصري", createdAt: new Date(), updatedAt: new Date() });
    const response = await request(makeApp()).get(`/api/youtube/callback?code=code-1&state=${encodeURIComponent(state)}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("youtube=connected");
    expect(save).toHaveBeenCalledWith({ userId: 42, channelId: "channel-1", channelTitle: "دماغ مصري", refreshToken: "refresh" });
  });

  it("rejects upload without login or file and handles a successful scheduled upload", async () => {
    vi.spyOn(context, "createContext").mockResolvedValue({ ...userContext, user: null });
    expect((await request(makeApp()).post("/api/youtube/upload")).status).toBe(401);

    vi.spyOn(context, "createContext").mockResolvedValue(userContext);
    expect((await request(makeApp()).post("/api/youtube/upload")).status).toBe(400);

    vi.spyOn(db, "getVideo").mockResolvedValue({ id: 7, userId: 42, title: "عنوان", description: "وصف", keywords: "أداة", status: "ready" } as any);
    vi.spyOn(db, "getYoutubeRefreshToken").mockResolvedValueOnce(undefined);
    const unlinked = await request(makeApp()).post("/api/youtube/upload").field("videoId", "7").attach("video", Buffer.from("fake-video"), { filename: "video.mp4", contentType: "video/mp4" });
    expect(unlinked.status).toBe(400);
    expect(unlinked.body.error).toBe("اربط قناة YouTube أولًا");
    vi.spyOn(db, "getYoutubeRefreshToken").mockResolvedValue("refresh");
    vi.spyOn(youtube, "refreshYoutubeAccessToken").mockResolvedValue("access");
    const upload = vi.spyOn(youtube, "uploadYoutubeVideo").mockResolvedValue({ id: "yt-1" });
    const response = await request(makeApp()).post("/api/youtube/upload").field("videoId", "7").field("privacyStatus", "private").field("publishAt", new Date(Date.now() + 3600000).toISOString()).attach("video", Buffer.from("fake-video"), { filename: "video.mp4", contentType: "video/mp4" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, youtubeVideoId: "yt-1", scheduled: true });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "access", contentType: "video/mp4", publishAt: expect.any(String), privacyStatus: "private" }));
  });
});
