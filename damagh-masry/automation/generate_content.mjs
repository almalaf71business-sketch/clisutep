import fs from "node:fs/promises";

const topic = process.env.TOPIC?.trim();
const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

if (!topic) throw new Error("TOPIC is required");
if (!apiKey) throw new Error("GEMINI_API_KEY is required");

const prompt = `أنت كاتب محتوى لقناة «دماغ مصري» عن التكنولوجيا والذكاء الاصطناعي باللهجة المصرية.
اكتب فيديو قصير أصلي عن الموضوع التالي: ${topic}
أعد JSON فقط بدون Markdown وبالمفاتيح التالية:
{"title":"عنوان جذاب أقل من 90 حرفًا","script":"سكريبت مصري كامل من 90 إلى 150 كلمة مناسب لفيديو قصير","description":"وصف مصري مختصر مع دعوة للاشتراك","tags":["5 إلى 12 كلمة مفتاحية"]}
لا تختلق أرقامًا أو أخبارًا غير مؤكدة، ولا تستخدم ادعاءات مضمونة عن الربح أو الصحة أو الخصوصية.`;

const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
});
if (!response.ok) throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
const payload = await response.json();
const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
if (!text) throw new Error("Gemini returned no content");
const jsonText = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
const content = JSON.parse(jsonText);
if (!content.title || !content.script || !content.description || !Array.isArray(content.tags)) {
  throw new Error("Generated content is missing required fields");
}
await fs.mkdir("work", { recursive: true });
await fs.writeFile("work/content.json", JSON.stringify({ ...content, topic }, null, 2));
await fs.writeFile("work/title.txt", content.title);
await fs.writeFile("work/script.txt", content.script);
console.log(`Generated: ${content.title}`);
