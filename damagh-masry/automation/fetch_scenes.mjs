import fs from "node:fs/promises";

const content = JSON.parse(await fs.readFile("work/content.json", "utf8"));
const requestedQueries = Array.isArray(content.visualQueries) ? content.visualQueries : [];
const queries = [...requestedQueries, "student using laptop", "smartphone in hand", "modern computer workspace", "classroom presentation", "person reading documents", "technology office", "computer screen close up"];
const fallbackScenes = [
  ["https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1080&q=85", "Laptop workspace", "1516321318423-f06f85e504b3"],
  ["https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=1080&q=85", "Modern laptop", "1531297484001-80022131f5a1"],
  ["https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=1080&q=85", "Computer technology", "1488590528505-98d2b5aba04b"],
  ["https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1080&q=85", "Developer workspace", "1498050108023-c5249f4df085"],
  ["https://images.unsplash.com/photo-1518770660439-4636190af475?w=1080&q=85", "Technology close-up", "1518770660439-4636190af475"],
  ["https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1080&q=85", "Digital devices", "1550745165-9bc0b252726f"],
];

await fs.mkdir("work/scenes", { recursive: true });
const scenes = [];
const selectedKeys = new Set();

for (const [index, query] of queries.entries()) {
  const response = await fetch(`https://commons.wikimedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=15&thumbnail_width=1080`, {
    headers: { "user-agent": "DamaghMasryVideoBot/1.0 (educational YouTube automation)" },
  });
  if (response.status === 429) break;
  if (!response.ok) continue;
  const payload = await response.json();
  const candidates = (payload.pages || [])
    .filter((page) => page.thumbnail?.url && page.thumbnail.width >= 600 && page.thumbnail.height >= 400)
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

for (const [imageUrl, title, photoId] of fallbackScenes) {
  if (scenes.length >= 6) break;
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) continue;
  const path = `work/scenes/scene-fallback-${String(scenes.length).padStart(2, "0")}.jpg`;
  await fs.writeFile(path, Buffer.from(await imageResponse.arrayBuffer()));
  scenes.push({
    path,
    query: "technology workspace",
    title,
    source: `https://unsplash.com/photos/${photoId}`,
    artist: "Unsplash contributor",
    license: "Unsplash License",
  });
}

if (scenes.length < 4) throw new Error(`Only ${scenes.length} usable Commons scenes were found`);
await fs.writeFile("work/scenes.json", JSON.stringify({ scenes }, null, 2));
await fs.writeFile("work/visual-sources.txt", scenes.map((scene, index) => `${index + 1}. ${scene.title} — ${scene.license} — ${scene.source}`).join("\n"));
console.log(`Downloaded ${scenes.length} real visual scenes from Wikimedia Commons.`);
