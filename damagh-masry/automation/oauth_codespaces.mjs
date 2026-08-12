import fs from "node:fs/promises";
import http from "node:http";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { URL } from "node:url";

const clientFile = process.env.YOUTUBE_OAUTH_CLIENT_FILE || "youtube-oauth-web-client.json";
const port = Number(process.env.PORT || 3000);
const redirectUri = process.env.OAUTH_REDIRECT_URI?.trim();
const scope = "https://www.googleapis.com/auth/youtube.upload";
const manual = process.env.OAUTH_MANUAL === "1";

if (!redirectUri) {
  throw new Error("OAUTH_REDIRECT_URI is required.");
}

const raw = await fs.readFile(clientFile, "utf8");
const config = JSON.parse(raw);
const web = config.web;
if (!web?.client_id || !web?.client_secret) {
  throw new Error("The JSON must contain web.client_id and web.client_secret");
}

const authUrl = new URL(web.auth_uri || "https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: web.client_id,
  redirect_uri: redirectUri,
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  scope,
}).toString();

async function exchangeCode(code) {
  const tokenResponse = await fetch(web.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: web.client_id,
      client_secret: web.client_secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenPayload.refresh_token) {
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${JSON.stringify(tokenPayload)}`);
  }
  console.log("\nOAuth succeeded. Add this value to GitHub Secret YOUTUBE_REFRESH_TOKEN:");
  console.log(tokenPayload.refresh_token);
  console.log("\nDo not commit or share this value.");
}

if (manual) {
  console.log("Open this URL in your browser:");
  console.log(authUrl.toString());
  console.log("\nAfter approval, copy the full browser URL and paste it below.");
  const rl = createInterface({ input, output });
  const pasted = (await rl.question("Callback URL or code: ")).trim();
  rl.close();

  let error = null;
  let code = null;
  if (pasted.startsWith("http://") || pasted.startsWith("https://")) {
    const parsed = new URL(pasted);
    error = parsed.searchParams.get("error");
    code = parsed.searchParams.get("code");
  } else if (pasted.includes("code=")) {
    const query = pasted.slice(pasted.indexOf("code=") + "code=".length);
    code = decodeURIComponent(query.split("&")[0]);
  } else {
    code = pasted.split("&")[0];
  }

  if (error || !code) throw new Error(`Google authorization failed: ${error || "missing code"}`);
  await exchangeCode(code);
  process.exit(0);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", redirectUri);
  console.log(`Incoming OAuth callback: ${requestUrl.pathname}`);
  const error = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  if (error || !code) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("OAuth server is running. Open the Google authorization URL printed in the terminal.");
    return;
  }
  try {
    await exchangeCode(code);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<h1>تم الربط بنجاح</h1><p>يمكنك إغلاق النافذة والعودة إلى Codespaces.</p>");
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Token exchange failed. Check the terminal.");
    console.error(error);
  } finally {
    server.close();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`OAuth callback server listening on port ${port}`);
  console.log("Open this URL in your browser:");
  console.log(authUrl.toString());
  console.log("\nAfter approval, Google will return to:");
  console.log(redirectUri);
});

process.on("SIGINT", () => server.close(() => process.exit(130)));
