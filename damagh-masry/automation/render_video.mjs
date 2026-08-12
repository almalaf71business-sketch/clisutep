import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const content = JSON.parse(await fs.readFile("work/content.json", "utf8"));
const fontBold = "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf";
const fontRegular = "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf";
const voice = process.env.TTS_VOICE || "ar-EG-ShakirNeural";

const clean = (value) => value.replace(/\s+/g, " ").trim();
const wrap = (value, width = 23) => {
  const words = clean(value).split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).join("\\n");
};

const splitScenes = (script) => {
  const sentences = clean(script).split(/(?<=[.!؟،؛])/u).map(clean).filter(Boolean);
  const scenes = [];
  for (const sentence of sentences) {
    const words = sentence.split(" ");
    while (words.length) scenes.push(words.splice(0, 10).join(" "));
  }
  return scenes.length ? scenes : [clean(script)];
};

await fs.mkdir("work/scenes", { recursive: true });
await fs.writeFile("work/voice.txt", clean(content.script));
await exec("edge-tts", ["--voice", voice, "--rate=-4%", "--pitch=-2Hz", "--text-file", "work/voice.txt", "--write-media", "work/voice.mp3"]);

const probe = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "work/voice.mp3"]);
const duration = Math.max(1, Number.parseFloat(probe.stdout.trim()));
const scenes = splitScenes(content.script);
const totalWeight = scenes.reduce((sum, scene) => sum + scene.length, 0);
let cursor = 0;
const timings = [];

for (let index = 0; index < scenes.length; index += 1) {
  const sceneDuration = index === scenes.length - 1 ? duration - cursor : duration * scenes[index].length / totalWeight;
  const start = cursor;
  const end = Math.min(duration, cursor + Math.max(1.2, sceneDuration));
  const path = `work/scenes/scene-${String(index).padStart(2, "0")}.txt`;
  await fs.writeFile(path, wrap(scenes[index]));
  timings.push({ path, start, end });
  cursor = end;
}

await fs.writeFile("work/title.txt", wrap(content.title, 28));
const escapePath = (value) => value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
const filters = [
  "drawbox=x='mod(t*85,1380)-300':y=180:w=520:h=520:color=0x00c2c7@0.12:t=fill",
  "drawbox=x='1080-mod(t*60,1380)':y=1180:w=460:h=460:color=0xffb703@0.10:t=fill",
  `drawtext=fontfile=${fontBold}:textfile=${escapePath("work/title.txt")}:fontcolor=0x00E5EA:fontsize=58:x=(w-text_w)/2:y=150:line_spacing=16:box=1:boxcolor=0x071426@0.72:boxborderw=28:text_shaping=1`,
  ...timings.map(({ path, start, end }) =>
    `drawtext=fontfile=${fontRegular}:textfile=${escapePath(path)}:fontcolor=white:fontsize=66:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=24:box=1:boxcolor=0x071426@0.82:boxborderw=42:text_shaping=1:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`
  ),
  "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='DAMAGH MASRY':fontcolor=white@0.45:fontsize=24:x=(w-text_w)/2:y=h-100",
  "fade=t=in:st=0:d=0.35",
  `fade=t=out:st=${Math.max(0, duration - 0.45).toFixed(2)}:d=0.45`,
  "format=yuv420p",
].join(",");

await exec("ffmpeg", [
  "-y", "-f", "lavfi", "-i", `color=c=0x071426:s=1080x1920:r=30:d=${duration.toFixed(3)}`,
  "-i", "work/voice.mp3",
  "-vf", filters,
  "-af", "highpass=f=75,lowpass=f=12000,loudnorm=I=-16:TP=-1.5:LRA=9",
  "-c:v", "libx264", "-preset", "medium", "-crf", "19",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
  "-shortest", "work/video.mp4",
]);

await fs.writeFile("work/render-info.json", JSON.stringify({ voice, duration, scenes: timings.length }, null, 2));
console.log(`Rendered polished Shorts video with ${voice}, ${timings.length} timed scenes, ${duration.toFixed(1)}s.`);
