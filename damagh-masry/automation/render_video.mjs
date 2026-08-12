import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const content = JSON.parse(await fs.readFile("work/content.json", "utf8"));
const wrap = (value, width = 34) => {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.join("\\n");
};

await fs.mkdir("work", { recursive: true });
await fs.writeFile("work/title.txt", content.title);
await fs.writeFile("work/script.txt", wrap(content.script));
await fs.writeFile("work/voice.txt", content.script);

const filter = [
  "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=work/title.txt:fontcolor=00c2c7:fontsize=52:x=(w-text_w)/2:y=120:box=1:boxcolor=0b1220@0.75:boxborderw=24:text_shaping=1",
  "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile=work/script.txt:fontcolor=ffffff:fontsize=40:line_spacing=18:x=80:y=420:box=1:boxcolor=111c33@0.92:boxborderw=35:text_shaping=1",
  "format=yuv420p",
].join(",");

await exec("espeak-ng", ["-v", process.env.TTS_VOICE || "ar", "-s", "145", "-f", "work/voice.txt", "-w", "work/voice.wav"]);
await exec("ffmpeg", [
  "-y", "-f", "lavfi", "-i", "color=c=0b1220:s=1080x1920:r=30",
  "-i", "work/voice.wav", "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
  "-c:a", "aac", "-b:a", "128k", "-shortest", "work/video.mp4",
]);
console.log("Rendered work/video.mp4 with Arabic voiceover.");
