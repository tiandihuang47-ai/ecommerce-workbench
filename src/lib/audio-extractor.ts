import { execFile } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tempDir = process.env.TEMP_FILE_DIR || "/tmp/director-platform";
const asrAudioBitrate = process.env.ASR_AUDIO_BITRATE || "24k";

export interface AudioExtractResult {
  success: boolean;
  audioPath: string;
  message: string;
}

export async function extractAudioFromVideo(videoPath: string): Promise<AudioExtractResult> {
  if (!videoPath) {
    return { success: false, audioPath: "", message: "没有找到视频文件，无法提取音频。" };
  }

  await mkdir(tempDir, { recursive: true });
  const parsed = path.parse(videoPath);
  const audioPath = path.join(tempDir, `${parsed.name}_${Date.now()}.mp3`);

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        videoPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        asrAudioBitrate,
        audioPath
      ],
      {
        timeout: 1000 * 60 * 15,
        maxBuffer: 1024 * 1024 * 8
      }
    );

    return { success: true, audioPath, message: "音频提取成功。" };
  } catch (error) {
    return {
      success: false,
      audioPath: "",
      message: `音频提取失败：${error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "ffmpeg 执行失败"}`
    };
  }
}

export async function cleanupTempFiles(paths: string[]) {
  const results = await Promise.allSettled(
    paths.filter(Boolean).map((filePath) => unlink(filePath))
  );
  return {
    success: results.every((result) => result.status === "fulfilled"),
    message: results.some((result) => result.status === "rejected") ? "部分临时文件清理失败，不影响本次结果。" : "临时文件已清理。"
  };
}
