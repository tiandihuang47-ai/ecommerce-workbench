import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getReplicaConfig } from "@/lib/replica-config";
import { ownershipScope, ownershipStamp, recordBelongsToScope } from "@/lib/server/request-scope";
import type { ReplicaAnalysisProgress, ReplicaDialogueHandling, ReplicaTask, ReplicaTaskMessage, ReplicaVersion } from "@/lib/replica-types";

export type ReplicaTaskStatus = ReplicaTask["status"];

export interface ReplicaTaskAsset {
  assetId: string;
  name: string;
  size: number;
  type: string;
  path: string;
  hash: string;
}

export interface ReplicaVideoSourceInfo {
  sourceType?: "local" | "douyin";
  sourceUrl?: string;
  resolvedUrl?: string;
  authorName?: string;
  importedAt?: string;
}

export interface ReplicaTaskRecord {
  id: string;
  /** 归属账号 ID（网页端创建时打标；历史桌面数据没有此标记） */
  userId?: string;
  title: string;
  status: ReplicaTaskStatus;
  error: string;
  video: ReplicaTaskAsset & ReplicaVideoSourceInfo & { duration: number; cacheKey: string; thumbnailAssetId?: string; thumbnailPath?: string };
  products: Array<ReplicaTaskAsset>;
  productCacheKey: string;
  document: (ReplicaTaskAsset & { text?: string }) | null;
  requirements: string;
  referenceCopy: string;
  copyMode?: "source" | "custom";
  customCopy?: string;
  copyPromptRequested?: boolean;
  dialogueHandling?: ReplicaDialogueHandling;
  messages: ReplicaTaskMessage[];
  prompt: string;
  versions: ReplicaVersion[];
  selfCheck?: unknown;
  warnings: string[];
  promptRequested: boolean;
  productHashForAnalysis?: string;
  analysisProgress?: ReplicaAnalysisProgress;
  createdAt: string;
  updatedAt: string;
}

export async function replicaTaskRoot() {
  const root = path.join(getReplicaConfig().cacheRoot, "tasks");
  await mkdir(root, { recursive: true });
  return root;
}

export async function listReplicaTaskRecords() {
  const scope = await ownershipScope();
  const root = await replicaTaskRoot();
  let files: string[] = [];
  try {
    files = (await readdir(root)).filter((item) => item.endsWith(".json"));
  } catch {
    return [];
  }
  const records = await Promise.all(files.map(async (file) => {
    try {
      return normalizeTaskRecord(JSON.parse(await readFile(path.join(root, file), "utf8")) as ReplicaTaskRecord);
    } catch {
      return null;
    }
  }));
  return records.filter((item): item is ReplicaTaskRecord => Boolean(item))
    .filter((item) => recordBelongsToScope(item.userId, scope))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getReplicaTaskRecord(taskId: string) {
  if (!/^replica_task_[\w-]+$/.test(taskId)) return null;
  const scope = await ownershipScope();
  try {
    const root = await replicaTaskRoot();
    const record = normalizeTaskRecord(JSON.parse(await readFile(path.join(root, `${taskId}.json`), "utf8")) as ReplicaTaskRecord);
    if (!recordBelongsToScope(record.userId, scope)) return null;
    return record;
  } catch {
    return null;
  }
}

export async function saveReplicaTaskRecord(task: ReplicaTaskRecord) {
  const next = normalizeTaskRecord({
    ...task,
    // 新建任务时按当前登录账号打归属标记；已有标记（更新/后台续跑）原样保留
    userId: task.userId ?? await ownershipStamp(),
    updatedAt: new Date().toISOString()
  });
  const root = await replicaTaskRoot();
  const target = path.join(root, `${next.id}.json`);
  const temp = `${target}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), "utf8");
  await rename(temp, target);
  return next;
}

export async function patchReplicaTaskRecord(taskId: string, patch: Partial<ReplicaTaskRecord>) {
  const task = await getReplicaTaskRecord(taskId);
  if (!task) return null;
  return saveReplicaTaskRecord({ ...task, ...patch });
}

export function toPublicReplicaTask(task: ReplicaTaskRecord): ReplicaTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    video: {
      assetId: task.video.assetId,
      name: task.video.name,
      size: task.video.size,
      duration: task.video.duration,
      cacheKey: task.video.cacheKey,
      thumbnailAssetId: task.video.thumbnailAssetId,
      sourceType: task.video.sourceType,
      sourceUrl: task.video.sourceUrl,
      resolvedUrl: task.video.resolvedUrl,
      authorName: task.video.authorName,
      importedAt: task.video.importedAt
    },
    products: task.products.map((item) => ({ assetId: item.assetId, name: item.name, size: item.size, type: item.type })),
    productCacheKey: task.productCacheKey,
    documentName: task.document?.name || "",
    documentAssetId: task.document?.assetId || "",
    requirements: task.requirements,
    referenceCopy: task.referenceCopy,
    copyMode: task.copyMode,
    customCopy: task.customCopy,
    copyPromptRequested: task.copyPromptRequested === true,
    dialogueHandling: task.dialogueHandling,
    messages: task.messages,
    prompt: task.prompt,
    versions: task.versions,
    selfCheck: task.selfCheck as ReplicaTask["selfCheck"],
    warnings: task.warnings,
    error: task.error,
    analysisProgress: task.analysisProgress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function normalizeTaskRecord(value: Partial<ReplicaTaskRecord>): ReplicaTaskRecord {
  const now = new Date().toISOString();
  const video = value.video;
  return {
    id: value.id || `replica_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: typeof value.userId === "string" && value.userId ? value.userId : undefined,
    title: value.title || "爆款复刻",
    status: normalizeStatus(value.status),
    error: value.error || "",
    video: {
      assetId: video?.assetId || "",
      name: video?.name || "",
      size: Number(video?.size || 0),
      type: video?.type || "",
      path: video?.path || "",
      hash: video?.hash || "",
      duration: Number(video?.duration || 0),
      cacheKey: video?.cacheKey || "",
      thumbnailAssetId: video?.thumbnailAssetId || (video?.assetId ? `${video.assetId}_thumbnail` : ""),
      thumbnailPath: video?.thumbnailPath || "",
      sourceType: video?.sourceType === "douyin" ? "douyin" : video?.sourceType === "local" || video?.assetId ? "local" : undefined,
      sourceUrl: video?.sourceUrl || "",
      resolvedUrl: video?.resolvedUrl || "",
      authorName: video?.authorName || "",
      importedAt: video?.importedAt || ""
    },
    products: Array.isArray(value.products) ? value.products.map((item) => ({
      assetId: item.assetId || "",
      name: item.name || "",
      size: Number(item.size || 0),
      type: item.type || "",
      path: item.path || "",
      hash: item.hash || ""
    })) : [],
    productCacheKey: value.productCacheKey || "",
    document: value.document ? {
      assetId: value.document.assetId || "",
      name: value.document.name || "",
      size: Number(value.document.size || 0),
      type: value.document.type || "",
      path: value.document.path || "",
      hash: value.document.hash || "",
      text: value.document.text || ""
    } : null,
    requirements: value.requirements || "",
    referenceCopy: value.referenceCopy || "",
    copyMode: value.copyMode === "source" || value.copyMode === "custom" ? value.copyMode : undefined,
    customCopy: value.customCopy || "",
    copyPromptRequested: value.copyPromptRequested === true,
    dialogueHandling: value.dialogueHandling && ["original", "custom", "none"].includes(value.dialogueHandling.mode) ? {
      mode: value.dialogueHandling.mode,
      instruction: value.dialogueHandling.instruction || "",
      requestedAt: value.dialogueHandling.requestedAt || now
    } : undefined,
    messages: Array.isArray(value.messages) ? value.messages.map((item, index) => ({
      id: item.id || `replica_message_${index}`,
      role: item.role === "assistant" ? "assistant" as const : "user" as const,
      content: item.content || "",
      createdAt: item.createdAt || now
    })) : [],
    prompt: value.prompt || "",
    versions: Array.isArray(value.versions) ? value.versions.map((item, index) => ({
      id: item.id || `replica_version_${index}`,
      version: Number(item.version || index + 1),
      prompt: item.prompt || "",
      note: item.note || "",
      createdAt: item.createdAt || now
    })) : [],
    selfCheck: value.selfCheck,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter(Boolean) : [],
    promptRequested: value.promptRequested === true,
    productHashForAnalysis: value.productHashForAnalysis || "",
    analysisProgress: normalizeProgress(value.analysisProgress),
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || value.createdAt || now
  };
}

function normalizeProgress(value: unknown): ReplicaAnalysisProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<ReplicaAnalysisProgress>;
  const now = new Date().toISOString();
  const status = ["queued", "running", "completed", "failed", "stalled"].includes(String(input.status))
    ? input.status as ReplicaAnalysisProgress["status"]
    : "running";
  if (!input.stage) return undefined;
  return {
    status,
    stage: String(input.stage),
    stageLabel: String(input.stageLabel || input.stage),
    completedUnits: Number.isFinite(Number(input.completedUnits)) ? Number(input.completedUnits) : undefined,
    totalUnits: Number.isFinite(Number(input.totalUnits)) ? Number(input.totalUnits) : undefined,
    percent: Number.isFinite(Number(input.percent)) ? Math.max(0, Math.min(100, Number(input.percent))) : undefined,
    startedAt: input.startedAt || now,
    stageStartedAt: input.stageStartedAt || now,
    updatedAt: input.updatedAt || now,
    lastHeartbeatAt: input.lastHeartbeatAt || now,
    detail: input.detail || "",
    errorCode: input.errorCode || "",
    errorMessage: input.errorMessage || "",
    errorStack: input.errorStack || "",
    timings: input.timings && typeof input.timings === "object" ? input.timings as Record<string, number> : undefined
  };
}

function normalizeStatus(value: unknown): ReplicaTaskStatus {
  const allowed: ReplicaTaskStatus[] = ["draft", "uploading", "analyzing_video", "analyzing_product", "compiling_prompt", "completed", "failed"];
  return allowed.includes(value as ReplicaTaskStatus) ? value as ReplicaTaskStatus : "draft";
}

export async function fileExists(filePath: string) {
  if (!filePath.startsWith(await replicaTaskRoot()) && !filePath.startsWith(getReplicaConfig().cacheRoot)) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
