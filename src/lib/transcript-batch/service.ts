import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { authRuntimeRoot, userScopedDataDir } from "@/lib/auth/runtime";
import { extractAudioFromVideo } from "@/lib/audio-extractor";
import { transcribeAudio } from "@/lib/doubao-asr";
import { DouyinImportError, importDouyinVideo } from "@/lib/video-import/douyin-import";
import { extractDouyinUrl, hasSpeechContent } from "@/lib/video-import/douyin-transcript";

/**
 * 批量逐字稿 · 服务端任务编排
 *
 * 设计要点（对应“批量逐字稿”任务要求）：
 * - 批次与每条状态持久化到磁盘：刷新/关弹窗/切页不丢；服务重启后结果仍在；
 * - 单服务器总并发默认 2（所有账号 + 手动重试共用），不因多人提交耗尽机器；
 * - 相同 requestId 幂等：重复提交只返回已创建的批次；同 requestId 不同内容 → 冲突；
 * - 状态区分：等待 / 处理中 / 完成 / 明确失败 / 结果未知（重启中断，不自动重跑收费请求）/ 已停止的待处理项；
 * - 停止只停止后续派发；已提交给外部 ASR 的请求无法真正取消，完成后仍会记录；
 * - 密钥失效、模型未开通等账号问题 → 暂停后续条目，避免整批重复失败；
 * - 单条重试只作用于该条；同批内识别到相同视频（awemeId）直接复用结果，不重复转写；
 * - 不绕过平台访问权限与风控；无界自动重试（本模块失败均为一次性处理，需手动重试）。
 */

export const BATCH_MAX_ITEMS = 30;

/** 单服务器批量任务总并发（所有账号共享） */
const GLOBAL_CONCURRENCY = Number(process.env.DIRECTOR_BATCH_CONCURRENCY || 2);

export type TranscriptBatchItemStatus =
  | "pending"      // 等待
  | "processing"   // 处理中
  | "completed"    // 完成
  | "failed"       // 明确失败
  | "unknown"      // 结果未知（服务重启中断；不自动重跑，需用户手动确认）
  | "stopped";     // 已停止的待处理项

export type TranscriptBatchStatus = "running" | "completed" | "stopped" | "paused";

export type TranscriptBatchItem = {
  id: string;
  input: string;
  link: string;
  status: TranscriptBatchItemStatus;
  title: string;
  authorName: string;
  transcript: string;
  awemeId: string;
  error: string;
  errorStage: string;
  retryable: boolean;
  /** 同批去重：与哪一条是同一个视频（复用其结果，未重复转写） */
  dedupOf?: string;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
};

export type TranscriptBatch = {
  batchId: string;
  requestId: string;
  inputHash: string;
  /** 创建者（网页模式下按账号隔离；桌面端没有标记） */
  userId?: string;
  createdAt: string;
  updatedAt: string;
  status: TranscriptBatchStatus;
  pausedReason: string;
  inputText: string;
  items: TranscriptBatchItem[];
};

export class BatchRequestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchRequestConflictError";
  }
}

/* ------------------------------------------------------------------ 存储 */

function batchDir(userScope: string) {
  return userScope === "desktop"
    ? path.join(authRuntimeRoot, "transcript-batches")
    : path.join(userScopedDataDir(userScope), "transcript-batches");
}

function batchFile(userScope: string, batchId: string) {
  return path.join(batchDir(userScope), `${batchId}.json`);
}

function sanitizeBatchId(batchId: string) {
  return /^[A-Za-z0-9_-]{6,80}$/.test(batchId) ? batchId : "";
}

async function persistBatch(batch: TranscriptBatch) {
  const dir = batchDir(batch.userId || "desktop");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  batch.updatedAt = new Date().toISOString();
  const target = batchFile(batch.userId || "desktop", batch.batchId);
  const temp = path.join(dir, `.${batch.batchId}.${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(batch, null, 2), "utf8");
  await rename(temp, target);
}

async function readBatch(userScope: string, batchId: string): Promise<TranscriptBatch | null> {
  const file = batchFile(userScope, sanitizeBatchId(batchId) || "__invalid__");
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as TranscriptBatch;
    if (!raw || typeof raw.batchId !== "string" || !Array.isArray(raw.items)) return null;
    return raw;
  } catch {
    return null;
  }
}

async function listBatches(userScope: string): Promise<TranscriptBatch[]> {
  const dir = batchDir(userScope);
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const batches = await Promise.all(
    names.map(async (name) => {
      try {
        return JSON.parse(await readFile(path.join(dir, name), "utf8")) as TranscriptBatch;
      } catch {
        return null;
      }
    })
  );
  return (batches.filter(Boolean) as TranscriptBatch[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ------------------------------------------------------------------ 全局运行队列 */

type QueueJob = { batchId: string; itemId: string; userScope: string };

type BatchRuntime = {
  queue: QueueJob[];
  workers: number;
  /** 重启恢复只执行一次的标记 */
  recovered: boolean;
};

const globalBatchRuntime = globalThis as typeof globalThis & {
  __directorTranscriptBatchRuntime?: BatchRuntime;
};

function runtime(): BatchRuntime {
  if (!globalBatchRuntime.__directorTranscriptBatchRuntime) {
    globalBatchRuntime.__directorTranscriptBatchRuntime = { queue: [], workers: 0, recovered: false };
  }
  return globalBatchRuntime.__directorTranscriptBatchRuntime;
}

function enqueueItem(userScope: string, batchId: string, itemId: string) {
  const rt = runtime();
  rt.queue.push({ userScope, batchId, itemId });
  ensureWorkers();
}

function ensureWorkers() {
  const rt = runtime();
  while (rt.workers < GLOBAL_CONCURRENCY && rt.queue.length > 0) {
    rt.workers += 1;
    void workerLoop();
  }
}

async function workerLoop() {
  const rt = runtime();
  for (;;) {
    const job = rt.queue.shift();
    if (!job) {
      rt.workers -= 1;
      return;
    }
    try {
      await processJob(job);
    } catch (error) {
      console.error("[TRANSCRIPT_BATCH] 任务处理异常:", error);
    }
  }
}

/* ------------------------------------------------------------------ 服务重启恢复 */

/** 服务重启后调用（每个进程一次）：处理中的条目标记为“结果未知”，不自动重跑收费请求 */
export async function recoverInterruptedBatches(): Promise<void> {
  const rt = runtime();
  if (rt.recovered) return;
  rt.recovered = true;

  const scopes: string[] = ["desktop"];
  const usersRoot = path.join(authRuntimeRoot, "users");
  try {
    const entries = await readdir(usersRoot);
    for (const entry of entries) scopes.push(entry);
  } catch {
    /* 没有 users 目录：网页版尚未初始化 */
  }

  for (const scope of scopes) {
    const batches = await listBatches(scope);
    for (const batch of batches) {
      let changed = false;
      for (const item of batch.items) {
        if (item.status === "processing") {
          item.status = "unknown";
          item.error = "服务重启时任务正在进行中，结果未知（为避免重复扣费，不会自动重跑）";
          item.errorStage = "INTERRUPTED";
          item.finishedAt = new Date().toISOString();
          changed = true;
        }
      }
      if (batch.status === "running") {
        const hasPending = batch.items.some((item) => item.status === "pending");
        batch.status = "stopped";
        batch.pausedReason = "服务重启中断了本批次" + (hasPending ? "，未处理的条目可以继续" : "。结果未知的条目需要手动重试");
        changed = true;
      }
      if (changed) await persistBatch(batch);
    }
  }
}

/* ------------------------------------------------------------------ 批次创建 / 查询 */

export function hashBatchInput(items: Array<{ link: string }>) {
  return createHash("sha256").update(items.map((item) => item.link).join("\n")).digest("hex").slice(0, 24);
}

export type CreateBatchInput = {
  requestId: string;
  links: string[];
  rawInput: string;
  userScope: string;
};

export type CreateBatchResult =
  | { kind: "created"; batch: TranscriptBatch; duplicatesRemoved: number }
  | { kind: "existing"; batch: TranscriptBatch };

export async function createBatch(input: CreateBatchInput): Promise<CreateBatchResult> {
  await recoverInterruptedBatches();

  const requestId = String(input.requestId || "").slice(0, 80);
  if (!requestId) throw new BatchRequestConflictError("缺少请求 ID（requestId）");

  // 幂等：同 scope 下同 requestId 的批次只创建一次（按原始提交内容做指纹）
  const existing = (await listBatches(input.userScope)).find((batch) => batch.requestId === requestId);
  if (existing) {
    const rawHash = createHash("sha256").update(input.links.join("\n")).digest("hex").slice(0, 24);
    const same = rawHash === existing.inputHash || hashBatchInput(input.links.map((link) => ({ link }))) === existing.inputHash;
    if (same) return { kind: "existing", batch: existing };
    throw new BatchRequestConflictError("相同的请求 ID 携带了不同的内容，请刷新后重新提交");
  }

  // 完全相同链接先去重（保持首次出现顺序）
  const seen = new Set<string>();
  const uniqueLinks: string[] = [];
  for (const link of input.links) {
    const key = link.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueLinks.push(key);
  }
  if (uniqueLinks.length > BATCH_MAX_ITEMS) {
    throw new BatchRequestConflictError(`一次最多处理 ${BATCH_MAX_ITEMS} 条链接，本次有 ${uniqueLinks.length} 条，请分批提交`);
  }

  const now = new Date().toISOString();
  const batch: TranscriptBatch = {
    batchId: `batch_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
    requestId,
    inputHash: createHash("sha256").update(input.links.join("\n")).digest("hex").slice(0, 24),
    userId: input.userScope === "desktop" ? undefined : input.userScope,
    createdAt: now,
    updatedAt: now,
    status: "running",
    pausedReason: "",
    inputText: String(input.rawInput || "").slice(0, 20000),
    items: []
  };

  for (const link of uniqueLinks) {
    const resolved = extractDouyinUrl(link);
    batch.items.push({
      id: `item_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      input: link.slice(0, 2000),
      link: resolved,
      status: resolved ? "pending" : "failed",
      title: "",
      authorName: "",
      transcript: "",
      awemeId: "",
      error: resolved ? "" : "不是有效的抖音链接或分享文案",
      errorStage: resolved ? "" : "INVALID_URL",
      retryable: false,
      attempts: 0
    });
  }

  await persistBatch(batch);
  const duplicatesRemoved = input.links.length - uniqueLinks.length;

  for (const item of batch.items) {
    if (item.status === "pending") enqueueItem(input.userScope, batch.batchId, item.id);
  }

  return { kind: "created", batch, duplicatesRemoved };
}

export async function getBatch(userScope: string, batchId: string): Promise<TranscriptBatch | null> {
  await recoverInterruptedBatches();
  return readBatch(userScope, batchId);
}

export async function listUserBatches(userScope: string, limit = 20): Promise<TranscriptBatch[]> {
  await recoverInterruptedBatches();
  return (await listBatches(userScope)).slice(0, limit);
}

/* ------------------------------------------------------------------ 批次操作 */

export type BatchAction =
  | { action: "stop" }
  | { action: "resume" }
  | { action: "retry-item"; itemId: string };

export async function applyBatchAction(userScope: string, batchId: string, action: BatchAction): Promise<TranscriptBatch | null> {
  return withBatchLock(batchId, () => applyBatchActionLocked(userScope, batchId, action));
}

async function applyBatchActionLocked(userScope: string, batchId: string, action: BatchAction): Promise<TranscriptBatch | null> {
  const batch = await readBatch(userScope, batchId);
  if (!batch) return null;

  if (action.action === "stop") {
    batch.status = "stopped";
    batch.pausedReason = "已手动停止。已提交给语音转写服务的条目仍可能完成或计费，完成后会正常记录。";
    for (const item of batch.items) {
      if (item.status === "pending") {
        item.status = "stopped";
        item.error = "已停止的待处理项";
        item.finishedAt = new Date().toISOString();
      }
    }
    await persistBatch(batch);
    return batch;
  }

  if (action.action === "resume") {
    batch.status = "running";
    batch.pausedReason = "";
    for (const item of batch.items) {
      if (item.status === "pending" || item.status === "stopped") {
        item.status = "pending";
        item.error = "";
        item.errorStage = "";
        enqueueItem(userScope, batch.batchId, item.id);
      }
    }
    await persistBatch(batch);
    return batch;
  }

  // retry-item：单条重试，只作用于该条；手动重试同样走全局队列
  const item = batch.items.find((candidate) => candidate.id === action.itemId);
  if (!item) return null;
  if (!["failed", "unknown", "stopped"].includes(item.status)) {
    return batch; // 成功/处理中的条目不重复处理
  }
  item.status = "pending";
  item.error = "";
  item.errorStage = "";
  item.attempts = 0;
  item.startedAt = undefined;
  item.finishedAt = undefined;
  item.dedupOf = undefined;
  if (batch.status !== "running") {
    batch.status = "running";
    batch.pausedReason = "";
  }
  await persistBatch(batch);
  enqueueItem(userScope, batch.batchId, item.id);
  return batch;
}

/* ------------------------------------------------------------------ 每批次串行锁 */

/** 同一批次的读-改-写串行化：两个 worker 同时处理同批不同条目时，避免整批覆盖丢状态 */
const batchLocks = new Map<string, Promise<unknown>>();

async function withBatchLock<T>(batchId: string, fn: () => Promise<T>): Promise<T> {
  const prev = batchLocks.get(batchId) || Promise.resolve();
  const next = prev.then(fn, fn);
  batchLocks.set(batchId, next.catch(() => undefined));
  return next;
}

/* ------------------------------------------------------------------ 单条处理 */

async function processJob(job: QueueJob) {
  await withBatchLock(job.batchId, () => runItem(job));
}

async function runItem(job: QueueJob) {
  const batch = await readBatch(job.userScope, job.batchId);
  if (!batch) return;
  const item = batch.items.find((candidate) => candidate.id === job.itemId);
  if (!item || item.status !== "pending") return;

  item.status = "processing";
  item.startedAt = new Date().toISOString();
  await persistBatch(batch);

  let audioTempPath = "";
  try {
    const url = extractDouyinUrl(item.input);
    if (!url) {
      failItem(item, "INVALID_URL", "不是有效的抖音链接或分享文案", false);
      return;
    }

    let imported;
    try {
      imported = await importDouyinVideo(url);
    } catch (error) {
      const stage = error instanceof DouyinImportError ? error.stage : "UNKNOWN";
      failItem(item, "VIDEO_IMPORT_FAILED", stage === "UNSUPPORTED_CONTENT" || stage === "AUTH_REQUIRED"
        ? "链接无法访问或内容不支持（图集/纯文本没有可转写的语音）"
        : "视频解析失败，请重试", true, stage);
      return;
    }
    item.awemeId = imported.source.awemeId || "";
    item.title = imported.source.title || "";
    item.authorName = imported.source.authorName || "";
    await persistBatch(batch);

    // 同批去重：同一个视频（awemeId）直接复用结果，不重复转写（不重复计费）
    const twin = batch.items.find(
      (candidate) => candidate.id !== item.id && candidate.status === "completed" && candidate.awemeId
        && candidate.awemeId === item.awemeId
    );
    if (twin) {
      item.status = "completed";
      item.transcript = twin.transcript;
      item.title = item.title || twin.title;
      item.authorName = item.authorName || twin.authorName;
      item.dedupOf = twin.id;
      item.error = "";
      item.errorStage = "";
      item.finishedAt = new Date().toISOString();
      await persistBatch(batch);
      return;
    }

    if (!imported.metadata.hasAudio) {
      failItem(item, "NO_SPEECH", "该视频没有语音内容（无音轨或纯画面），无法转写逐字稿", false);
      return;
    }

    const audio = await extractAudioFromVideo(imported.videoPath);
    if (!audio.success) {
      failItem(item, "AUDIO_EXTRACT_FAILED", "视频解析失败，请重试", true, audio.message.slice(0, 120));
      return;
    }
    audioTempPath = audio.audioPath;

    const asr = await transcribeAudio(audio.audioPath);
    const transcript = String(asr.transcript || "").replace(/\r\n/g, "\n").trim();
    if (asr.success && hasSpeechContent(transcript)) {
      item.status = "completed";
      item.transcript = transcript;
      item.error = "";
      item.errorStage = "";
      item.finishedAt = new Date().toISOString();
      return;
    }

    if (asr.code === "MODEL_NOT_OPEN" || asr.code === "AUTH") {
      // 账号问题：暂停后续条目，避免整批重复失败
      failItem(
        item,
        "ASR_ACCOUNT_ISSUE",
        asr.code === "MODEL_NOT_OPEN" ? "火山方舟语音转写模型未开通，请到方舟控制台开通后再试" : "火山方舟 API Key 无效，请检查配置后再试",
        false,
        asr.code
      );
      batch.status = "paused";
      batch.pausedReason = `账号问题导致本批次暂停（${item.error}）。处理账号后可继续。`;
      for (const candidate of batch.items) {
        if (candidate.status === "pending") {
          candidate.status = "stopped";
          candidate.error = "因账号问题暂停";
          candidate.finishedAt = new Date().toISOString();
        }
      }
      return;
    }

    if (/没有返回有效逐字稿|未识别|no valid|empty/i.test(asr.message || "")) {
      failItem(item, "NO_SPEECH", "未识别到有效语音", false, asr.message?.slice(0, 120));
      return;
    }
    failItem(item, "ASR_FAILED", "语音转写失败，请重试", true, asr.message?.slice(0, 120));
  } finally {
    if (audioTempPath) {
      void rm(audioTempPath, { force: true }).catch(() => undefined);
    }
    // 无论成功失败都落盘一次，然后检查批次是否全部终态
    await persistBatch(batch);
    const terminal = (status: TranscriptBatchItemStatus) => status !== "pending" && status !== "processing";
    if (batch.items.every((item) => terminal(item.status)) && batch.status === "running") {
      batch.status = "completed";
      await persistBatch(batch);
    }
  }
}

function failItem(item: TranscriptBatchItem, stage: string, message: string, retryable: boolean, detail = "") {
  item.status = "failed";
  item.error = message;
  item.errorStage = stage;
  item.retryable = retryable;
  item.finishedAt = new Date().toISOString();
  void detail;
}
