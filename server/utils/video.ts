import { spawn } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export interface VideoMetadata {
  title: string;
  description: string;
  uploader: string;
  duration: number;
  subtitles: string;
  thumbnailUrl: string;
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs = 120000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
    proc.on("error", reject);
  });
}

export async function getVideoMetadata(url: string): Promise<VideoMetadata> {
  const { stdout } = await runCommand("yt-dlp", [
    "--dump-json",
    "--no-download",
    "--no-warnings",
    url,
  ]);

  const data = JSON.parse(stdout);

  let subtitles = "";
  if (data.subtitles || data.automatic_captions) {
    const subLangs = data.subtitles || {};
    const autoCaptions = data.automatic_captions || {};
    const langKey =
      Object.keys(subLangs).find((k) => k.startsWith("en")) ||
      Object.keys(autoCaptions).find((k) => k.startsWith("en")) ||
      Object.keys(subLangs)[0] ||
      Object.keys(autoCaptions)[0];

    if (langKey) {
      try {
        const tmpDir = join(tmpdir(), `subs-${randomUUID()}`);
        await fs.mkdir(tmpDir, { recursive: true });
        await runCommand("yt-dlp", [
          "--skip-download",
          "--write-auto-sub",
          "--write-sub",
          "--sub-lang",
          langKey,
          "--sub-format",
          "vtt",
          "--convert-subs",
          "srt",
          "-o",
          join(tmpDir, "sub"),
          url,
        ]);
        const files = await fs.readdir(tmpDir);
        const srtFile = files.find((f) => f.endsWith(".srt") || f.endsWith(".vtt"));
        if (srtFile) {
          const rawSubs = await fs.readFile(join(tmpDir, srtFile), "utf-8");
          subtitles = rawSubs
            .replace(/\d+\n[\d:,\-\s>]+\n/g, "")
            .replace(/<[^>]+>/g, "")
            .replace(/\n{2,}/g, "\n")
            .trim();
        }
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (e) {
        console.error("Failed to get subtitles:", e);
      }
    }
  }

  return {
    title: data.title || "Untitled",
    description: data.description || "",
    uploader: data.uploader || data.channel || "",
    duration: data.duration || 0,
    subtitles,
    thumbnailUrl: data.thumbnail || "",
  };
}

export async function downloadAndExtractFrames(
  url: string,
  maxFrames = 6,
): Promise<{
  frames: string[];
  audioBuffer: Buffer | null;
  metadata: VideoMetadata;
}> {
  const workDir = join(tmpdir(), `video-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  const videoPath = join(workDir, "video.mp4");

  try {
    await runCommand("yt-dlp", [
      "-f",
      "worst[ext=mp4]/worst",
      "--no-playlist",
      "-o",
      videoPath,
      url,
    ]);

    const metadata = await getVideoMetadata(url);
    const duration = metadata.duration || 10;
    const interval = Math.max(1, Math.floor(duration / maxFrames));

    const framesDir = join(workDir, "frames");
    await fs.mkdir(framesDir, { recursive: true });

    await runCommand("ffmpeg", [
      "-i",
      videoPath,
      "-vf",
      `fps=1/${interval}`,
      "-frames:v",
      String(maxFrames),
      "-q:v",
      "5",
      join(framesDir, "frame_%03d.jpg"),
    ]);

    const frameFiles = (await fs.readdir(framesDir))
      .filter((f) => f.endsWith(".jpg"))
      .sort();

    const frames: string[] = [];
    for (const file of frameFiles) {
      const buf = await fs.readFile(join(framesDir, file));
      frames.push(buf.toString("base64"));
    }

    let audioBuffer: Buffer | null = null;
    const audioPath = join(workDir, "audio.wav");
    try {
      await runCommand("ffmpeg", [
        "-i",
        videoPath,
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-acodec",
        "pcm_s16le",
        "-t",
        "300",
        audioPath,
      ]);
      audioBuffer = await fs.readFile(audioPath);
    } catch {
      console.log("No audio track or extraction failed");
    }

    return { frames, audioBuffer, metadata };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export async function getInstagramCaption(url: string): Promise<string> {
  try {
    const { stdout } = await runCommand("yt-dlp", [
      "--dump-json",
      "--no-download",
      "--no-warnings",
      url,
    ]);
    const data = JSON.parse(stdout);
    return data.description || "";
  } catch {
    return "";
  }
}
