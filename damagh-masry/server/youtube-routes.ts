import type { Express } from "express";
import multer from "multer";
import { unlink } from "node:fs/promises";
import { createContext } from "./_core/context";
import { getYoutubeRedirectUri, createYoutubeState, buildYoutubeAuthUrl, verifyYoutubeState, exchangeYoutubeCode, getYoutubeChannel } from "./youtube";
import { saveYoutubeConnection, getYoutubeRefreshToken, getVideo } from "./db";
import { refreshYoutubeAccessToken, uploadYoutubeVideo } from "./youtube";

const upload = multer({ dest: "/tmp/damagh-masry-youtube", limits: { fileSize: 500 * 1024 * 1024 } });

export function registerYoutubeRoutes(app: Express) {
  app.get("/api/youtube/connect", async (req, res) => {
    const ctx = await createContext({ req, res } as any);
    if (!ctx.user) return res.redirect("/?youtube=login-required");
    const redirectUri = getYoutubeRedirectUri(req);
    const state = await createYoutubeState(ctx.user.id, redirectUri);
    return res.redirect(buildYoutubeAuthUrl(state, redirectUri));
  });

  app.post("/api/youtube/upload", upload.single("video"), async (req, res) => {
    let filePath: string | undefined;
    try {
      const ctx = await createContext({ req, res } as any);
      if (!ctx.user) return res.status(401).json({ error: "تسجيل الدخول مطلوب" });
      if (!req.file) return res.status(400).json({ error: "ارفع ملف فيديو أولًا" });
      filePath = req.file.path;
      const videoId = Number(req.body.videoId);
      const video = await getVideo(ctx.user.id, videoId);
      if (!video) return res.status(404).json({ error: "الفيديو غير موجود" });
      const refreshToken = await getYoutubeRefreshToken(ctx.user.id);
      if (!refreshToken) return res.status(400).json({ error: "اربط قناة YouTube أولًا" });
      const accessToken = await refreshYoutubeAccessToken(refreshToken);
      const result = await uploadYoutubeVideo({ accessToken, filePath, contentType: req.file.mimetype, title: video.title, description: video.description || "", keywords: video.keywords || "", privacyStatus: req.body.privacyStatus === "public" ? "public" : req.body.privacyStatus === "unlisted" ? "unlisted" : "private", publishAt: req.body.publishAt || undefined });
      return res.json({ success: true, youtubeVideoId: result.id, scheduled: Boolean(req.body.publishAt) });
    } catch (error) {
      console.error("[YouTube Upload]", error);
      return res.status(500).json({ error: "فشل رفع الفيديو إلى YouTube" });
    } finally {
      if (filePath) await unlink(filePath).catch(() => undefined);
    }
  });

  app.get("/api/youtube/callback", async (req, res) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !state) throw new Error("OAuth callback ناقص");
      const verified = await verifyYoutubeState(state);
      const tokens = await exchangeYoutubeCode(code, verified.redirectUri);
      if (!tokens.refresh_token) throw new Error("لم يصل refresh token من Google؛ أعد الموافقة مع prompt=consent");
      const channel = await getYoutubeChannel(tokens.access_token);
      await saveYoutubeConnection({ userId: verified.userId, ...channel, refreshToken: tokens.refresh_token });
      return res.redirect("/?youtube=connected");
    } catch (error) {
      console.error("[YouTube OAuth]", error);
      return res.redirect("/?youtube=error");
    }
  });
}
