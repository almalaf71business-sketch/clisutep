import fs from "node:fs/promises";

const required = ["GOOGLE_YOUTUBE_CLIENT_ID", "GOOGLE_YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);
const content = JSON.parse(await fs.readFile("work/content.json", "utf8"));
const video = await fs.readFile("work/video.mp4");

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_YOUTUBE_CLIENT_ID,
    client_secret: process.env.GOOGLE_YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  }),
});
if (!tokenResponse.ok) throw new Error(`OAuth refresh failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
const { access_token: accessToken } = await tokenResponse.json();

const metadata = {
  snippet: {
    title: content.title,
    description: content.description,
    tags: content.tags,
    categoryId: "28",
    defaultLanguage: "ar",
    defaultAudioLanguage: "ar-EG",
  },
  status: {
    privacyStatus: "private",
    selfDeclaredMadeForKids: false,
    madeForKids: false,
  },
};
const initResponse = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable", {
  method: "POST",
  headers: {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json; charset=UTF-8",
    "x-upload-content-length": String(video.byteLength),
    "x-upload-content-type": "video/mp4",
  },
  body: JSON.stringify(metadata),
});
if (!initResponse.ok) throw new Error(`YouTube upload initialization failed: ${initResponse.status} ${await initResponse.text()}`);
const uploadUrl = initResponse.headers.get("location");
if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL");

const uploadResponse = await fetch(uploadUrl, {
  method: "PUT",
  headers: { "content-type": "video/mp4", "content-length": String(video.byteLength) },
  body: video,
});
if (!uploadResponse.ok) throw new Error(`YouTube upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
const result = await uploadResponse.json();
await fs.writeFile("work/upload-result.json", JSON.stringify({ id: result.id, privacyStatus: result.status?.privacyStatus }, null, 2));
console.log(`Uploaded private video: ${result.id}`);
