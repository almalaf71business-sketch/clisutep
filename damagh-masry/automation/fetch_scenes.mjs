import fs from "node:fs/promises";

const content = JSON.parse(await fs.readFile("work/content.json", "utf8"));
const queries = Array.isArray(content.visualQueries) && content.visualQueries.length
  ? content.visualQueries.slice(0, 7)
  : ["artificial intelligence computer", "student studying laptop", "smartphone technology", "modern computer workspace", "digital assistant"];

await fs.mkdir("work/scenes", { recursive: true });
const scenes = [];

for (const [index, query] of queries.entries()) {
  const response = await fetch(`https://commons.wikimedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=15`, {
    headers: { "user-agent": "DamaghMasryVideoBot/1.0 (educational YouTube automation)" },
  });
  if (!response.ok) continue;
  const payload = await response.json();
  const candidates = (payload.pages || [])
    .filter((page) => page.thumbnail?.url && ["image/jpeg", "image/png", "image/webp"].includes(page.thumbnail.mimetype))
    .sort((a, b) => (b.thumbnail.width * b.thumbnail.height) - (a.thumbnail.width * a.thumbnail.height));
  const selected = candidates[0];
  if (!selected) continue;
  const imageUrl = selected.thumbnail.url.startsWith("//") ? `https:${selected.thumbnail.url}` : selected.thumbnail.url;
  const imageResponse = await fetch(imageUrl, {
    headers: { "user-agent": "DamaghMasryVideoBot/1.0 (educational YouTube automation)" },
  });
  if (!imageResponse.ok) continue;
  const extension = selected.thumbnail.mimetype === "image/png" ? "png" : selected.thumbnail.mimetype === "image/webp" ? "webp" : "jpg";
  const path = `work/scenes/scene-${String(index).padStart(2, "0")}.${extension}`;
  await fs.writeFile(path, Buffer.from(await imageResponse.arrayBuffer()));
  const source = `https://commons.wikimedia.org/wiki/${encodeURIComponent(selected.key)}`;
  scenes.push({
    path,
    query,
    title: selected.title,
    source,
    artist: "Wikimedia Commons contributor",
    license: "See source page",
  });
}

if (scenes.length < 3) throw new Error(`Only ${scenes.length} usable Commons scenes were found`);
await fs.writeFile("work/scenes.json", JSON.stringify({ scenes }, null, 2));
await fs.writeFile("work/visual-sources.txt", scenes.map((scene, index) => `${index + 1}. ${scene.title} — ${scene.license} — ${scene.source}`).join("\n"));
console.log(`Downloaded ${scenes.length} real visual scenes from Wikimedia Commons.`);
