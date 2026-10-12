import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { DouyinImportError, importDouyinVideo } from "@/lib/video-import/douyin-import";
import { fileExists, getReplicaTaskRecord, patchReplicaTaskRecord, saveReplicaTaskRecord, toPublicReplicaTask } from "@/lib/replica-task-store";
import { startReplicaTask } from "@/lib/replica-task-runner";
import type { ReplicaTaskRecord } from "@/lib/replica-task-store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: { taskId?: unknown; input?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return failure("input", "导入请求格式不正确，请重试。");
  }

  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) return failure("input", "请先粘贴抖音视频链接或整段分享文本。");

  const taskId = typeof body.taskId === "string" && /^replica_task_[\w-]+$/.test(body.taskId) ? body.taskId : "";
  let existingTask: ReplicaTaskRecord | null = null;
  if (taskId) {
    existingTask = await getReplicaTaskRecord(taskId);
    if (!existingTask) return failure("input", "复刻任务不存在，请新建复刻后再导入。", 404);
    if (existingTask.video.path && existingTask.video.sourceUrl && existingTask.video.sourceUrl === input && await fileExists(existingTask.video.path)) {
      return NextResponse.json({ success: true, task: toPublicReplicaTask(existingTask), reused: true });
    }
    if (existingTask.video.path && existingTask.video.hash && body.force !== true) {
      return failure("input", "当前复刻已有视频。请使用新建复刻，或先删除当前视频后再导入。");
    }
    const previousStatus = existingTask.status;
    await patchReplicaTaskRecord(taskId, { status: "uploading", error: "" });
    try {
      return await importAndSaveTask({ input, existingTask: await getReplicaTaskRecord(taskId), previousStatus });
    } catch (error) {
      const message = friendlyImportError(error);
      await patchReplicaTaskRecord(taskId, { status: previousStatus, error: message });
      return failure(error instanceof DouyinImportError ? error.stage : "metadata", message, 502);
    }
  }

  try {
    return await importAndSaveTask({ input });
  } catch (error) {
    return failure(error instanceof DouyinImportError ? error.stage : "metadata", friendlyImportError(error));
  }
}

async function importAndSaveTask(options: { input: string; existingTask?: ReplicaTaskRecord | null; previousStatus?: ReplicaTaskRecord["status"] }) {
  const imported = await importDouyinVideo(options.input);
  const videoName = `${sanitizeFileName(imported.source.title)}.mp4`;
  const task: ReplicaTaskRecord = {
    id: options.existingTask?.id || `replica_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: `${imported.source.title} · 复刻`,
    status: "analyzing_video",
    error: "",
    video: {
      assetId: `replica_video_${imported.videoHash}`,
      name: videoName,
      size: imported.metadata.fileSize,
      type: "video/mp4",
      path: imported.videoPath,
      hash: imported.videoHash,
      duration: imported.metadata.duration,
      cacheKey: "",
      thumbnailAssetId: `replica_video_thumbnail_${imported.videoHash}`,
      thumbnailPath: imported.thumbnailPath,
      sourceType: "douyin",
      sourceUrl: imported.source.sourceUrl,
      resolvedUrl: imported.source.resolvedUrl,
      authorName: imported.source.authorName,
      importedAt: imported.source.importedAt
    },
    products: options.existingTask?.products || [],
    productCacheKey: options.existingTask?.productCacheKey || "",
    document: options.existingTask?.document || null,
    requirements: options.existingTask?.requirements || "",
    referenceCopy: options.existingTask?.referenceCopy || "",
    copyMode: options.existingTask?.copyMode,
    customCopy: options.existingTask?.customCopy,
    copyPromptRequested: options.existingTask?.copyPromptRequested,
    dialogueHandling: options.existingTask?.dialogueHandling,
    messages: options.existingTask?.messages || [],
    prompt: options.existingTask?.prompt || "",
    versions: options.existingTask?.versions || [],
    selfCheck: options.existingTask?.selfCheck,
    warnings: options.existingTask?.warnings || [],
    promptRequested: options.existingTask?.promptRequested || false,
    productHashForAnalysis: options.existingTask?.productHashForAnalysis || "",
    createdAt: options.existingTask?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const saved = await saveReplicaTaskRecord(task);
  console.info(`[DOUYIN_IMPORT] TASK_UPDATED SUCCESS taskId=${saved.id}, sourceVideoAssetId=${saved.video.assetId}, thumbnailAssetId=${saved.video.thumbnailAssetId}`);
  startReplicaTask(saved.id);
  return NextResponse.json({ success: true, task: toPublicReplicaTask(saved), message: "视频导入成功，已开始后台理解" });
}

function friendlyImportError(error: unknown) {
  if (error instanceof DouyinImportError) return error.message;
  return "视频导入失败，请稍后重试。";
}

function sanitizeFileName(value: string) {
  const clean = value.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "抖音视频").slice(0, 80);
}

function failure(stage: string, message: string, status = 400) {
  return NextResponse.json({ success: false, stage, message, retryable: true }, { status });
}
