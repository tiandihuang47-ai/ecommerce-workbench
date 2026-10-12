import { denyIfUnauthenticated } from "@/lib/auth/guard";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { extractAudioFromVideo } from "@/lib/audio-extractor";
import { transcribeAudio } from "@/lib/doubao-asr";
import { checkFfmpegInstalled } from "@/lib/system-check";
import { saveRawUploadToTemp, UploadTooLargeError } from "@/lib/server/upload-stream";

export const runtime = "nodejs";
export const maxDuration = 600;

const tempDir = process.env.TEMP_FILE_DIR || "/tmp/director-platform";
const maxUploadBytes = 1024 * 1024 * 1024;
const allowedExtensions = new Set([".mp4", ".mov", ".m4v", ".webm"]);

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const contentType = request.headers.get("content-type") || "";
  let videoPath = "";
  let uploadFileName = "video.mp4";

  const ffmpeg = await checkFfmpegInstalled();
  if (!ffmpeg.installed) {
    return NextResponse.json({
      success: false,
      stage: "system_check",
      message: ffmpeg.message,
      fallbackRequired: true
    }, { status: 500 });
  }

  if (contentType.includes("application/octet-stream")) {
    // 流式路径：边落盘边算校验，1GB 文件不再整体读进内存
    try {
      const uploaded = await saveRawUploadToTemp(request, {
        maxBytes: maxUploadBytes,
        allowedExtensions,
        tempDir
      });
      videoPath = uploaded.tempPath;
      uploadFileName = uploaded.fileName;
    } catch (error) {
      if (error instanceof UploadTooLargeError) return failure("upload", error.message);
      return failure("upload", error instanceof Error ? error.message : "视频上传失败，请重试。");
    }
  } else {
    // 兼容旧 multipart 路径
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return failure("upload", "上传请求格式不正确，请重新选择视频文件。");
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return failure("upload", "请先选择要上传的视频文件。");
    }
    if (file.size > maxUploadBytes) {
      return failure("upload", "视频文件超过 1GB，请压缩后再上传，或改用手动输入逐字稿。");
    }
    const extension = path.extname(file.name).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return failure("upload", "暂只支持 mp4、mov、m4v、webm 格式，请转换格式后再上传。");
    }

    await mkdir(tempDir, { recursive: true });
    const safeName = file.name.replace(/[^\w.-]+/g, "_");
    videoPath = path.join(tempDir, `upload_${Date.now()}_${safeName}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await mkdir(tempDir, { recursive: true });
    await import("node:fs/promises").then((fs) => fs.writeFile(videoPath, buffer));
    uploadFileName = file.name;
  }

  const audio = await extractAudioFromVideo(videoPath);
  if (!audio.success) {
    return NextResponse.json({
      success: false,
      stage: "audio_extract",
      videoPath,
      message: audio.message,
      fallbackRequired: true
    }, { status: 500 });
  }

  try {
    const asr = await transcribeAudio(audio.audioPath);
    if (!asr.success) {
      return NextResponse.json({
        success: false,
        stage: "asr",
        videoPath,
        audioPath: audio.audioPath,
        message: asr.message,
        fallbackRequired: true
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      platform: "unknown",
      title: uploadFileName,
      videoPath,
      audioPath: audio.audioPath,
      transcript: asr.transcript,
      segments: asr.segments,
      message: "上传视频转写成功"
    });
  } finally {
    // 语音已转写完成（或失败）：中间音频文件不再被引用，立即清理，避免 /tmp 无限堆积
    if (audio.audioPath) {
      void rm(audio.audioPath, { force: true }).catch(() => undefined);
    }
  }
}

function failure(stage: "upload" | "system_check" | "audio_extract" | "asr", message: string, status = 400) {
  return NextResponse.json({
    success: false,
    stage,
    message,
    fallbackRequired: true
  }, { status });
}
