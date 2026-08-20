import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const content = JSON.parse(await fs.readFile("work/content.json", "utf8"));
const voice = process.env.TTS_VOICE || "ar-EG-ShakirNeural";
const python = process.env.PYTHON_BINARY || "python";

const run = async (command, args) =>
  exec(command, args, { maxBuffer: 16 * 1024 * 1024 });

const assEscape = (value) =>
  value.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");

const assTime = (seconds) => {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = (safe % 60).toFixed(2).padStart(5, "0");
  return `${hours}:${String(minutes).padStart(2, "0")}:${secs}`;
};

const wordsToCaptions = (text, duration) => {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks = [];
  for (let index = 0; index < words.length; index += 6) chunks.push(words.slice(index, index + 6).join(" "));
  const weights = chunks.map((chunk) => Math.max(1, chunk.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return chunks.map((chunk, index) => {
    const start = cursor;
    cursor += (duration * weights[index]) / totalWeight;
    return { start, end: index === chunks.length - 1 ? duration : cursor, text: chunk };
  });
};

await fs.mkdir("work", { recursive: true });
await fs.writeFile("work/title.txt", content.title);
await fs.writeFile("work/voice.txt", content.script);

await run(python, [
  "-m", "edge_tts",
  "--voice", voice,
  "--rate=-5%",
  "--text", content.script,
  "--write-media", "work/voice.mp3",
]);

const { stdout: probeOutput } = await run("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", "work/voice.mp3",
]);
const duration = Number.parseFloat(probeOutput.trim());
if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not detect narration duration");

const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Noto Sans Arabic,68,&H00FFFFFF,&H0000C2C7,&HCC07101F,&H88071120,-1,0,0,0,100,100,0,0,3,4,0,2,75,75,330,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
const captionEvents = wordsToCaptions(content.script, duration)
  .map(({ start, end, text }) => `Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${assEscape(text)}`)
  .join("\n");
await fs.writeFile("work/captions.ass", assHeader + captionEvents + "\n");

const { stdout: encoders } = await run("ffmpeg", ["-hide_banner", "-encoders"]);
const gpuAvailable = /h264_nvenc/.test(encoders) && process.env.USE_GPU === "1";
const videoCodec = gpuAvailable
  ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "21"]
  : ["-c:v", "libx264", "-preset", "fast", "-crf", "21"];

const titlePath = "work/title.txt";
const filter = [
  "[0:v]drawgrid=w=120:h=120:t=2:c=0x18314f@0.22",
  "drawbox=x='mod(t*95\\,1580)-500':y=230:w=500:h=500:c=0x00c2c7@0.13:t=fill",
  "drawbox=x='1080-mod(t*65\\,1480)':y=1080:w=400:h=400:c=0xffb703@0.10:t=fill",
  `drawtext=font='Noto Sans Arabic':textfile=${titlePath}:fontcolor=0x00e1e8:fontsize=58:x=(w-text_w)/2:y=150:box=1:boxcolor=0x07101f@0.82:boxborderw=28:text_shaping=1:enable='lt(t\\,4.5)'`,
  "subtitles=work/captions.ass[v]",
  "[1:a]asplit=2[awave][anorm]",
  "[awave]aformat=channel_layouts=mono,showwaves=s=900x150:mode=line:rate=30:colors=0x00e1e8@0.75,format=rgba[wave]",
  "[v][wave]overlay=x=(W-w)/2:y=1480:format=auto[outv]",
  "[anorm]loudnorm=I=-16:TP=-1.5:LRA=11[outa]",
].join(";");

await run("ffmpeg", [
  "-y",
  "-f", "lavfi", "-i", "color=c=0x07101f:s=1080x1920:r=30",
  "-i", "work/voice.mp3",
  "-filter_complex", filter,
  "-map", "[outv]", "-map", "[outa]",
  ...videoCodec,
  "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k",
  "-movflags", "+faststart",
  "-shortest", "work/video.mp4",
]);

console.log(`Rendered work/video.mp4 with ${voice} (${gpuAvailable ? "NVENC" : "CPU"}).`);
