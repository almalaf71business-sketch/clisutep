import fs from "node:fs/promises";

const content = JSON.parse(await fs.readFile("work/content.json", "utf8"));
const requestedQueries = Array.isArray(content.visualQueries) ? content.visualQueries : [];
const queries = [...requestedQueries, "student using laptop", "smartphone in hand", "modern computer workspace", "classroom presentation", "person reading documents", "technology office", "computer screen close up"];

await fs.mkdir("work/scenes", { recursive: true });
const scenes = [];
const selectedKeys = new Set();

for (const [index, query] of queries.entries()) {
  const response = await fetch(`https://commons.wikimedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=15`, {
    headers: { "user-agent": "DamaghMasryVideoBot/1.0 (educational YouTube automation)" },
  });
  if (!response.ok) throw new Error(`Commons search failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  const candidates = (payload.pages || [])
    .filter((page) => page.thumbnail?.url)
    .sort((a, b) => (b.thumbnail.width * b.thumbnail.height) - (a.thumbnail.width * a.thumbnail.height));
  const selected = candidates.find((candidate) => !selectedKeys.has(candidate.key));
  if (!selected) continue;
  selectedKeys.add(selected.key);
  const imageUrl = selected.thumbnail.url.startsWith("//") ? `https:${selected.thumbnail.url}` : selected.thumbnail.url;
  const imageResponse = await fetch(imageUrl, {
    headers: { "user-agent": "DamaghMasryVideoBot/1.0 (educational YouTube automation)" },
  });
  if (!imageResponse.ok) continue;
  const mime = imageResponse.headers.get("content-type") || selected.thumbnail.mimetype || "image/jpeg";
  const extension = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
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
  if (scenes.length >= 6) break;
}

if (scenes.length < 4) throw new Error(`Only ${scenes.length} usable Commons scenes were found`);
await fs.writeFile("work/scenes.json", JSON.stringify({ scenes }, null, 2));
await fs.writeFile("work/visual-sources.txt", scenes.map((scene, index) => `${index + 1}. ${scene.title} — ${scene.license} — ${scene.source}`).join("\n"));
console.log(`Downloaded ${scenes.length} real visual scenes from Wikimedia Commons.`);
