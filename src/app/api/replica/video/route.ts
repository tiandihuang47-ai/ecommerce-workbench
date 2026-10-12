import { denyIfUnauthenticated } from "@/lib/auth/guard";
import path from "node:path";
import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { analyzeReplicaVideo } from "@/lib/replica-video-analysis";
import { getCachedVideoDNA, persistReplicaVideoFileSource, saveCachedVideoDNA } from "@/lib/replica-cache";
import { getReplicaConfig } from "@/lib/replica-config";
import { replicaVideoSchemaVersion } from "@/lib/replica-types";
import { runReplicaAnalysisExclusive } from "@/lib/replica-task-runner";
import { saveRawUploadToTemp, UploadTooLargeError } from "@/lib/server/upload-stream";

export const runtime = "nodejs";
export const maxDuration = 900;

const maxUploadBytes = 1024 * 1024 * 1024;
const allowedExtensions = new Set([".mp4", ".mov", ".m4v", ".webm"]);

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const contentType = request.headers.get("content-type") || "";

  // 流式路径：原始字节流边落盘边算哈希，1GB 文件不再整体驻留内存
  if (contentType.includes("application/octet-stream")) {
    let uploaded: Awaited<ReturnType<typeof saveRawUploadToTemp>>;
    try {
      uploaded = await saveRawUploadToTemp(request, {
        maxBytes: maxUploadBytes,
        allowedExtensions,
        tempDir: path.join(getReplicaConfig().cacheRoot, "uploads")
      });
    } catch (error) {
      if (error instanceof UploadTooLargeError) return failure("upload", error.message);
      return failure("upload", error instanceof Error ? error.message : "视频上传失败，请重试。");
    }

    try {
      const sourcePath = await persistReplicaVideoFileSource({
        sourcePath: uploaded.tempPath,
        hash: uploaded.hash,
        extension: uploaded.extension
      });
      const cached = await getCachedVideoDNA(uploaded.hash);
      if (cached && cached.schemaVersion === replicaVideoSchemaVersion && cached.analysisMeta.visionModel === getReplicaConfig().visionModel) {
        return NextResponse.json({ success: true, status: "ready", cacheKey: uploaded.hash, metadata: cached.metadata, message: "视频已准备" });
      }
      // 重型分析进受控槽位（与后台任务队列共享并发上限）
      const dna = await runReplicaAnalysisExclusive(() => analyzeReplicaVideo({
        videoPath: sourcePath,
        videoHash: uploaded.hash,
        sourceFileName: uploaded.fileName
      }));
      await saveCachedVideoDNA(uploaded.hash, dna);
      return NextResponse.json({ success: true, status: "ready", cacheKey: uploaded.hash, metadata: dna.metadata, message: "视频已准备" });
    } catch (error) {
      return failure("analysis", error instanceof Error ? error.message : "视频理解失败，请重试。", 502);
    } finally {
      void rm(uploaded.tempPath, { force: true }).catch(() => undefined);
    }
  }

  // 兼容旧 multipart 路径
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("upload", "上传请求格式不正确，请重新选择视频文件。");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return failure("upload", "请先选择爆款视频。");
  if (file.size > maxUploadBytes) return failure("upload", "视频文件超过 1GB，请压缩后再上传。");

  const extension = path.extname(file.name).toLowerCase();
  if (!allowedExtensions.has(extension)) return failure("upload", "暂只支持 MP4、MOV、M4V、WEBM 视频格式。");

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const { hashBytes, persistReplicaVideoSource } = await import("@/lib/replica-cache");
    const videoHash = hashBytes(buffer);
    const sourcePath = await persistReplicaVideoSource({ buffer, hash: videoHash, extension });
    const cached = await getCachedVideoDNA(videoHash);
    if (cached && cached.schemaVersion === replicaVideoSchemaVersion && cached.analysisMeta.visionModel === getReplicaConfig().visionModel) {
      return NextResponse.json({ success: true, status: "ready", cacheKey: videoHash, metadata: cached.metadata, message: "视频已准备" });
    }

    const dna = await runReplicaAnalysisExclusive(() => analyzeReplicaVideo({ videoPath: sourcePath, videoHash, sourceFileName: file.name }));
    await saveCachedVideoDNA(videoHash, dna);
    return NextResponse.json({ success: true, status: "ready", cacheKey: videoHash, metadata: dna.metadata, message: "视频已准备" });
  } catch (error) {
    return failure("analysis", error instanceof Error ? error.message : "视频理解失败，请重试。", 502);
  }
}

function failure(stage: string, message: string, status = 400) {
  return NextResponse.json({ success: false, stage, message, retryable: true }, { status });
}
