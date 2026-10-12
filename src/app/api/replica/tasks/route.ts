import { denyIfUnauthenticated } from "@/lib/auth/guard";
import path from "node:path";
import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { generateReplicaVideoThumbnail, hashBytes, persistReplicaVideoSource, persistReplicaVideoFileSource } from "@/lib/replica-cache";
import { getReplicaConfig } from "@/lib/replica-config";
import { saveReplicaTaskRecord, getReplicaTaskRecord, listReplicaTaskRecords, toPublicReplicaTask } from "@/lib/replica-task-store";
import { startReplicaTask, resumeActiveReplicaTasks, markStalledReplicaTasks } from "@/lib/replica-task-runner";
import { saveRawUploadToTemp, UploadTooLargeError } from "@/lib/server/upload-stream";

export const runtime = "nodejs";

const maxVideoBytes = 1024 * 1024 * 1024;
const allowedVideoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm"]);

export async function GET(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");
  await markStalledReplicaTasks();
  await resumeActiveReplicaTasks();
  if (taskId) {
    const task = await getReplicaTaskRecord(taskId);
    if (!task) return NextResponse.json({ success: false, message: "任务不存在。" }, { status: 404 });
    return NextResponse.json({ success: true, task: toPublicReplicaTask(task) });
  }
  const tasks = await listReplicaTaskRecords();
  return NextResponse.json({ success: true, tasks: tasks.map(toPublicReplicaTask) });
}

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const contentType = request.headers.get("content-type") || "";

  // 流式路径（新版前端）：原始字节流边落盘边算哈希，不再把整份视频读进内存
  if (contentType.includes("application/octet-stream")) {
    const taskIdHeader = /^replica_task_[\w-]+$/.test(request.headers.get("x-task-id") || "")
      ? String(request.headers.get("x-task-id"))
      : `replica_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let meta: { referenceCopy?: string; messages?: unknown } = {};
    try {
      meta = JSON.parse(decodeURIComponent(request.headers.get("x-replica-meta") || "{}"));
    } catch { /* 可选元数据，解析失败按空处理 */ }

    let uploaded: Awaited<ReturnType<typeof saveRawUploadToTemp>>;
    try {
      uploaded = await saveRawUploadToTemp(request, {
        maxBytes: maxVideoBytes,
        allowedExtensions: allowedVideoExtensions,
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
      const thumbnailPath = await generateReplicaVideoThumbnail({ videoPath: sourcePath, hash: uploaded.hash });
      const task = await saveReplicaTaskRecord({
        id: taskIdHeader,
        title: `${uploaded.fileName || "爆款视频"} · 复刻`,
        status: "analyzing_video",
        error: "",
        video: {
          assetId: `replica_video_${uploaded.hash}`,
          name: uploaded.fileName,
          size: uploaded.size,
          type: "video/mp4",
          path: sourcePath,
          hash: uploaded.hash,
          duration: 0,
          cacheKey: "",
          thumbnailAssetId: `replica_video_thumbnail_${uploaded.hash}`,
          thumbnailPath
        },
        products: [],
        productCacheKey: "",
        document: null,
        requirements: "",
        referenceCopy: typeof meta.referenceCopy === "string" ? meta.referenceCopy : "",
        messages: Array.isArray(meta.messages)
          ? (meta.messages as Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>)
          : [],
        prompt: "",
        versions: [],
        warnings: [],
        promptRequested: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      startReplicaTask(task.id);
      return NextResponse.json({ success: true, task: toPublicReplicaTask(task), message: "视频已开始后台理解" });
    } catch (error) {
      return failure("analysis", error instanceof Error ? error.message : "视频上传失败，请重试。", 502);
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

  const file = formData.get("video");
  if (!(file instanceof File)) return failure("upload", "请先选择爆款视频。");
  const taskId = typeof formData.get("taskId") === "string" && /^replica_task_[\w-]+$/.test(String(formData.get("taskId")))
    ? String(formData.get("taskId"))
    : `replica_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const extension = path.extname(file.name).toLowerCase();
  if (!allowedVideoExtensions.has(extension)) return failure("upload", "暂只支持 MP4、MOV、M4V、WEBM 视频格式。");
  if (file.size > maxVideoBytes) return failure("upload", "视频文件超过 1GB，请压缩后再上传。");

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const videoHash = hashBytes(buffer);
    const sourcePath = await persistReplicaVideoSource({ buffer, hash: videoHash, extension });
    const thumbnailPath = await generateReplicaVideoThumbnail({ videoPath: sourcePath, hash: videoHash });
    const referenceCopy = stringValue(formData.get("referenceCopy"));
    const requirements = stringValue(formData.get("requirements"));
    let messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }> = [];
    try {
      const parsed = JSON.parse(String(formData.get("messages") || "[]"));
      if (Array.isArray(parsed)) messages = parsed;
    } catch { /* 忽略可选对话 */ }

    const task = await saveReplicaTaskRecord({
      id: taskId,
      title: `${file.name || "爆款视频"} · 复刻`,
      status: "analyzing_video",
      error: "",
      video: {
        assetId: `replica_video_${videoHash}`,
        name: file.name,
        size: file.size,
        type: file.type,
        path: sourcePath,
        hash: videoHash,
        duration: 0,
        cacheKey: "",
        thumbnailAssetId: `replica_video_thumbnail_${videoHash}`,
        thumbnailPath
      },
      products: [],
      productCacheKey: "",
      document: null,
      requirements,
      referenceCopy,
      messages,
      prompt: "",
      versions: [],
      warnings: [],
      promptRequested: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    startReplicaTask(task.id);
    return NextResponse.json({ success: true, task: toPublicReplicaTask(task), message: "视频已开始后台理解" });
  } catch (error) {
    return failure("analysis", error instanceof Error ? error.message : "视频上传失败，请重试。", 502);
  }
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function failure(stage: string, message: string, status = 400) {
  return NextResponse.json({ success: false, stage, message, retryable: true }, { status });
}
