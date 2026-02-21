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

function isInstagramUrl(url: string): boolean {
  return /instagram\.com/i.test(url) || /instagr\.am/i.test(url);
}

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url);
}

export async function getVideoMetadata(url: string): Promise<VideoMetadata> {
  const args = [
    "--dump-json",
    "--no-download",
    "--no-warnings",
    "--no-check-certificates",
  ];

  if (isInstagramUrl(url)) {
    args.push("--extractor-args", "instagram:api_type=graphql");
  }

  args.push(url);

  let data: any;
  try {
    const { stdout } = await runCommand("yt-dlp", args);
    data = JSON.parse(stdout);
  } catch (err: any) {
    if (isInstagramUrl(url) && (err.message.includes("429") || err.message.includes("login") || err.message.includes("csrf"))) {
      throw new Error(
        "Instagram requires authentication. Try with a YouTube link, or use the screenshot/carousel mode for Instagram content.",
      );
    }
    throw err;
  }

  let subtitles = "";
  if (isYouTubeUrl(url)) {
    const subLangs =
      data.subtitles || data.automatic_captions || {};
    const langKey =
      Object.keys(data.subtitles || {}).find((k) => k.startsWith("en")) ||
      Object.keys(data.automatic_captions || {}).find((k) => k.startsWith("en")) ||
      Object.keys(subLangs)[0];

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
          "--no-check-certificates",
          "-o",
          join(tmpDir, "sub"),
          url,
        ]);
        const files = await fs.readdir(tmpDir);
        const srtFile = files.find(
          (f) => f.endsWith(".srt") || f.endsWith(".vtt"),
        );
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

export async function downloadVideo(url: string): Promise<{
  videoPath: string;
  workDir: string;
  metadata: VideoMetadata;
}> {
  const workDir = join(tmpdir(), `video-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  const videoPath = join(workDir, "video.mp4");

  const dlArgs = [
    "-f", "worstvideo+worstaudio/worst/best[filesize<20M]/best",
    "--no-playlist",
    "--no-check-certificates",
    "--merge-output-format", "mp4",
    "--no-mtime",
    "--socket-timeout", "30",
    "-o", videoPath,
  ];

  if (isInstagramUrl(url)) {
    dlArgs.push("--extractor-args", "instagram:api_type=graphql");
  }

  dlArgs.push(url);

  try {
    await runCommand("yt-dlp", dlArgs, 180000);
  } catch (err: any) {
    await fs.rm(workDir, { recursive: true, force: true });
    if (isInstagramUrl(url) && (err.message.includes("429") || err.message.includes("login") || err.message.includes("csrf"))) {
      throw new Error(
        "Instagram requires authentication to download videos. Try with a YouTube link, or use the screenshot/carousel mode for Instagram content.",
      );
    }
    throw err;
  }

  const allFiles = await fs.readdir(workDir);
  const videoFile = allFiles.find(f => f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mkv"));
  const actualVideoPath = videoFile ? join(workDir, videoFile) : videoPath;

  if (!videoFile) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw new Error("Video download failed - no video file found");
  }

  let metadata: VideoMetadata;
  try {
    metadata = await getVideoMetadata(url);
  } catch {
    metadata = {
      title: "Downloaded Video",
      description: "",
      uploader: "",
      duration: 0,
      subtitles: "",
      thumbnailUrl: "",
    };
  }

  return { videoPath: actualVideoPath, workDir, metadata };
}

const MAX_CHUNK_SIZE = 7 * 1024 * 1024;

export async function prepareVideoForGemini(videoPath: string): Promise<{
  chunks: { data: string; mimeType: string }[];
  thumbnailBase64: string | null;
}> {
  const stat = await fs.stat(videoPath);
  const videoBuffer = await fs.readFile(videoPath);

  let thumbnailBase64: string | null = null;
  const thumbDir = join(tmpdir(), `thumb-${randomUUID()}`);
  try {
    await fs.mkdir(thumbDir, { recursive: true });
    const thumbPath = join(thumbDir, "thumb.jpg");
    await runCommand("ffmpeg", [
      "-i", videoPath,
      "-vf", "select=eq(n\\,0)",
      "-frames:v", "1",
      "-q:v", "5",
      thumbPath,
    ]);
    const thumbBuf = await fs.readFile(thumbPath);
    thumbnailBase64 = thumbBuf.toString("base64");
  } catch {
    console.log("Thumbnail extraction failed");
  } finally {
    await fs.rm(thumbDir, { recursive: true, force: true });
  }

  if (stat.size <= MAX_CHUNK_SIZE) {
    return {
      chunks: [{
        data: videoBuffer.toString("base64"),
        mimeType: "video/mp4",
      }],
      thumbnailBase64,
    };
  }

  const duration = await getVideoDuration(videoPath);
  const numChunks = Math.ceil(stat.size / MAX_CHUNK_SIZE);
  const chunkDuration = Math.max(5, Math.floor(duration / numChunks));

  const chunkDir = join(tmpdir(), `chunks-${randomUUID()}`);
  await fs.mkdir(chunkDir, { recursive: true });

  const chunks: { data: string; mimeType: string }[] = [];
  try {
    for (let i = 0; i < numChunks && i < 5; i++) {
      const startTime = i * chunkDuration;
      const chunkPath = join(chunkDir, `chunk_${i}.mp4`);

      await runCommand("ffmpeg", [
        "-i", videoPath,
        "-ss", String(startTime),
        "-t", String(chunkDuration),
        "-c:v", "libx264",
        "-crf", "35",
        "-preset", "ultrafast",
        "-vf", "scale='min(480,iw)':-2",
        "-c:a", "aac",
        "-b:a", "64k",
        "-y",
        chunkPath,
      ]);

      const chunkBuf = await fs.readFile(chunkPath);
      if (chunkBuf.length <= MAX_CHUNK_SIZE) {
        chunks.push({
          data: chunkBuf.toString("base64"),
          mimeType: "video/mp4",
        });
      }
    }
  } finally {
    await fs.rm(chunkDir, { recursive: true, force: true });
  }

  return { chunks, thumbnailBase64 };
}

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      videoPath,
    ]);
    return parseFloat(stdout.trim()) || 30;
  } catch {
    return 30;
  }
}

export async function getInstagramCaption(url: string): Promise<string> {
  try {
    const { stdout } = await runCommand("yt-dlp", [
      "--dump-json",
      "--no-download",
      "--no-warnings",
      "--no-check-certificates",
      "--extractor-args", "instagram:api_type=graphql",
      url,
    ]);
    const data = JSON.parse(stdout);
    return data.description || "";
  } catch {
    return "";
  }
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {}
}
