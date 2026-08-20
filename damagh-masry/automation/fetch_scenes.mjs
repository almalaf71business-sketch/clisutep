import fs from "node:fs/promises";

const content = JSON.parse(await fs.readFile("work/content.json", "utf8"));
const queries = Array.isArray(content.visualQueries) && content.visualQueries.length
  ? content.visualQueries.slice(0, 7)
  : ["artificial intelligence computer", "student studying laptop", "smartphone technology", "modern computer workspace", "digital assistant"];

await fs.mkdir("work/scenes", { recursive: true });
const scenes = [];

for (const [index, query] of queries.entries()) {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata",
    iiurlwidth: "1400",
    format: "json",
    origin: "*",
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { "user-agent": "DamaghMasryVideoBot/1.0 (educational YouTube automation)" },
  });
  if (!response.ok) continue;
  const payload = await response.json();
  const candidates = Object.values(payload.query?.pages || {})
    .map((page) => ({ page, info: page.imageinfo?.[0] }))
    .filter(({ info }) => info && ["image/jpeg", "image/png", "image/webp"].includes(info.mime) && info.width >= 900 && info.height >= 700)
    .sort((a, b) => (b.info.width * b.info.height) - (a.info.width * a.info.height));
  const selected = candidates[0];
  if (!selected) continue;
  const imageResponse = await fetch(selected.info.thumburl || selected.info.url, {
    headers: { "user-agent": "DamaghMasryVideoBot/1.0 (educational YouTube automation)" },
  });
  if (!imageResponse.ok) continue;
  const extension = selected.info.mime === "image/png" ? "png" : selected.info.mime === "image/webp" ? "webp" : "jpg";
  const path = `work/scenes/scene-${String(index).padStart(2, "0")}.${extension}`;
  await fs.writeFile(path, Buffer.from(await imageResponse.arrayBuffer()));
  const metadata = selected.info.extmetadata || {};
  scenes.push({
    path,
    query,
    title: selected.page.title,
    source: selected.info.descriptionurl,
    artist: metadata.Artist?.value || "Wikimedia Commons contributor",
    license: metadata.LicenseShortName?.value || "See source page",
  });
}

if (scenes.length < 3) throw new Error(`Only ${scenes.length} usable Commons scenes were found`);
await fs.writeFile("work/scenes.json", JSON.stringify({ scenes }, null, 2));
await fs.writeFile("work/visual-sources.txt", scenes.map((scene, index) => `${index + 1}. ${scene.title} — ${scene.license} — ${scene.source}`).join("\n"));
console.log(`Downloaded ${scenes.length} real visual scenes from Wikimedia Commons.`);
