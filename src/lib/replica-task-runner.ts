import { readFile } from "node:fs/promises";
import { getReplicaConfig } from "@/lib/replica-config";
import { analyzeReplicaProduct, extractReplicaDocumentText } from "@/lib/replica-product-analysis";
import { analyzeReplicaVideo } from "@/lib/replica-video-analysis";
import { getCachedProductUnderstanding, getCachedVideoDNA, saveCachedProductUnderstanding, saveCachedVideoDNA } from "@/lib/replica-cache";
import { generateReplicaPrompt } from "@/lib/replica-prompt-generation";
import { getReplicaTaskRecord, listReplicaTaskRecords, patchReplicaTaskRecord, saveReplicaTaskRecord } from "@/lib/replica-task-store";
import { replicaSchemaVersion, replicaVideoSchemaVersion } from "@/lib/replica-types";
import type { ReplicaTaskRecord } from "@/lib/replica-task-store";
import type { ReplicaAnalysisProgress } from "@/lib/replica-types";

const activeTasks = new Set<string>();
const activeProgress = new Map<string, ReplicaAnalysisProgress>();

/** 重型视频/产品分析的服务器级并发上限（默认 1）：多用户同时提交不会耗尽机器 */
const MAX_CONCURRENT_ANALYSIS = Math.max(1, Number(process.env.DIRECTOR_REPLICA_ANALYSIS_CONCURRENCY || 1));
const analysisQueue: string[] = [];
const queuedTaskIds = new Set<string>();
let analysisRunning = 0;

const analysisStageOrder = ["VIDEO_READING", "SHOT_DETECTION", "FRAME_EXTRACTION", "AUDIO_EXTRACTION", "ASR", "AUDIO_ANALYSIS", "SHOT_ANALYSIS", "DNA_ASSEMBLY", "VALIDATION", "COMPLETED"];

function computeOverallPercent(progress: ReplicaAnalysisProgress) {
  if (progress.status === "completed" || progress.stage === "COMPLETED") return 100;
  const stageIndex = analysisStageOrder.indexOf(progress.stage);
  if (stageIndex < 0) return progress.percent;
  const stageFraction = progress.totalUnits && progress.completedUnits !== undefined
    ? Math.max(0, Math.min(1, progress.completedUnits / progress.totalUnits))
    : 0.05;
  return Math.round(((stageIndex + stageFraction) / analysisStageOrder.length) * 100);
}

async function saveAnalysisProgress(taskId: string, progress: Partial<ReplicaAnalysisProgress> & { stage: string; stageLabel: string }) {
  const now = new Date().toISOString();
  const previous = activeProgress.get(taskId);
  const stageChanged = previous?.stage !== progress.stage;
  const next: ReplicaAnalysisProgress = {
    status: "running",
    ...previous,
    ...progress,
    completedUnits: progress.completedUnits ?? (stageChanged ? undefined : previous?.completedUnits),
    totalUnits: progress.totalUnits ?? (stageChanged ? undefined : previous?.totalUnits),
    percent: progress.percent ?? (stageChanged ? undefined : previous?.percent),
    updatedAt: now,
    lastHeartbeatAt: now
  };
  next.overallPercent = computeOverallPercent(next);
  activeProgress.set(taskId, next);
  await patchReplicaTaskRecord(taskId, { analysisProgress: next });
}

export function startReplicaTask(taskId: string) {
  if (activeTasks.has(taskId)) return;
  activeTasks.add(taskId);
  queuedTaskIds.add(taskId);
  analysisQueue.push(taskId);
  pumpAnalysisQueue();
}

function pumpAnalysisQueue() {
  while (analysisRunning < MAX_CONCURRENT_ANALYSIS && analysisQueue.length > 0) {
    const taskId = analysisQueue.shift();
    if (!taskId) break;
    queuedTaskIds.delete(taskId);
    analysisRunning += 1;
    void runReplicaTask(taskId)
      .catch(() => undefined)
      .finally(() => {
        analysisRunning -= 1;
        activeTasks.delete(taskId);
        pumpAnalysisQueue();
      });
  }
}

/** 供同步分析路径（/api/replica/video）共用的受控槽位 */
export async function runReplicaAnalysisExclusive<T>(fn: () => Promise<T>): Promise<T> {
  while (analysisRunning >= MAX_CONCURRENT_ANALYSIS) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  analysisRunning += 1;
  try {
    return await fn();
  } finally {
    analysisRunning -= 1;
  }
}

export async function resumeActiveReplicaTasks() {
  const records = await listReplicaTaskRecords();
  records.filter((task) => task.status === "analyzing_video" || task.status === "analyzing_product" || task.status === "compiling_prompt")
    .forEach((task) => {
      if (task.analysisProgress?.status === "stalled") return;
      startReplicaTask(task.id);
    });
}

export async function markStalledReplicaTasks(stalledAfterMs = Number(process.env.REPLICA_STALLED_AFTER_MS || 420000)) {
  const records = await listReplicaTaskRecords();
  const now = Date.now();
  for (const task of records) {
    if (task.status !== "analyzing_video" && task.status !== "analyzing_product" && task.status !== "compiling_prompt") continue;
    // 还在受控队列里排队等待的任务没有心跳是正常的，不能误判为“卡死”
    if (queuedTaskIds.has(task.id)) continue;
    if (task.video.cacheKey) {
      const cachedDna = await getCachedVideoDNA(task.video.cacheKey);
      if (cachedDna && cachedDna.schemaVersion === replicaVideoSchemaVersion) {
        const recovered: ReplicaAnalysisProgress = {
          status: "completed",
          stage: "COMPLETED",
          stageLabel: "Video DNA 已完成",
          startedAt: task.analysisProgress?.startedAt || task.createdAt,
          stageStartedAt: task.analysisProgress?.stageStartedAt || cachedDna.analysisMeta.createdAt,
          updatedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
          detail: `${cachedDna.shots.length} 个镜头 · ${cachedDna.metadata.duration.toFixed(1)} 秒视频 · ${cachedDna.frameObservations.length} 条视觉观察`,
          timings: task.analysisProgress?.timings
        };
        await patchReplicaTaskRecord(task.id, {
          status: "draft",
          error: "",
          analysisProgress: recovered
        });
        continue;
      }
    }
    if (task.analysisProgress?.status === "stalled" || task.analysisProgress?.status === "failed") continue;
    const heartbeat = task.analysisProgress?.lastHeartbeatAt || task.updatedAt;
    const elapsed = now - new Date(heartbeat).getTime();
    if (Number.isFinite(elapsed) && elapsed < stalledAfterMs) continue;
    const next: ReplicaAnalysisProgress = {
      status: "stalled",
      stage: task.analysisProgress?.stage || "UNKNOWN",
      stageLabel: task.analysisProgress?.stageLabel || "分析似乎已暂停",
      completedUnits: task.analysisProgress?.completedUnits,
      totalUnits: task.analysisProgress?.totalUnits,
      percent: task.analysisProgress?.percent,
      startedAt: task.analysisProgress?.startedAt || task.createdAt,
      stageStartedAt: task.analysisProgress?.stageStartedAt || task.updatedAt,
      updatedAt: new Date().toISOString(),
      lastHeartbeatAt: task.analysisProgress?.lastHeartbeatAt || task.updatedAt,
      detail: task.analysisProgress?.detail || "",
      errorCode: "ANALYSIS_STALLED",
      errorMessage: "分析似乎已暂停，请继续分析。",
      timings: task.analysisProgress?.timings
    };
    await patchReplicaTaskRecord(task.id, {
      status: "failed",
      error: next.errorMessage,
      analysisProgress: next
    });
  }
}

async function runReplicaTask(taskId: string) {
  const initial = await getReplicaTaskRecord(taskId);
  if (!initial || initial.status === "completed") return;
  let task: ReplicaTaskRecord = initial;
  const heartbeat = setInterval(() => {
    const progress = activeProgress.get(taskId);
    if (!progress || progress.status !== "running") return;
    void patchReplicaTaskRecord(taskId, {
      analysisProgress: { ...progress, lastHeartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    });
  }, 5000);
  try {
    if (task.video.path && !task.video.cacheKey) {
      task = await update(taskId, { status: "analyzing_video", error: "" });
      const cachedDna = await getCachedVideoDNA(task.video.hash);
      const dna = cachedDna && cachedDna.schemaVersion === replicaVideoSchemaVersion && cachedDna.analysisMeta.visionModel === getReplicaConfig().visionModel
        ? cachedDna
        : await analyzeReplicaVideo({
          videoPath: task.video.path,
          videoHash: task.video.hash,
          sourceFileName: task.video.name,
          onProgress: (progress) => saveAnalysisProgress(taskId, progress)
        });
      await saveCachedVideoDNA(task.video.hash, dna);
      task = await update(taskId, {
        video: { ...task.video, duration: dna.metadata.duration, cacheKey: task.video.hash },
        title: task.title === "爆款复刻" ? `${task.video.name || "爆款视频"} · 复刻` : task.title
      });
      await saveAnalysisProgress(taskId, {
        status: "completed",
        stage: "COMPLETED",
        stageLabel: "Video DNA 已完成",
        detail: `${dna.shots.length} 个镜头 · ${dna.frameObservations.length} 个关键帧观察`,
        updatedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString()
      });
    }

    if (task.products.length && !task.productCacheKey) {
      task = await update(taskId, { status: "analyzing_product", error: "" });
      const images = await Promise.all(task.products.map(async (item) => ({
        name: item.name,
        type: item.type,
        buffer: new Uint8Array(await readFile(item.path))
      })));
      const documentText = task.document?.text || (task.document?.path ? await extractReplicaDocumentText({
        name: task.document.name,
        type: task.document.type,
        buffer: new Uint8Array(await readFile(task.document.path))
      }) : "");
      const productHash = task.productHashForAnalysis || task.products[0].hash || "";
      const cachedProduct = await getCachedProductUnderstanding(productHash);
      const understanding = cachedProduct?.schemaVersion === replicaSchemaVersion
        ? cachedProduct
        : await analyzeReplicaProduct({ images, documentText });
      await saveCachedProductUnderstanding(productHash, understanding);
      task = await update(taskId, { productCacheKey: productHash });
    }

    task = await getReplicaTaskRecord(taskId) || task;
    if (task.promptRequested && task.video.cacheKey && task.productCacheKey) {
      task = await update(taskId, { status: "compiling_prompt", error: "" });
      const dna = await getCachedVideoDNA(task.video.cacheKey);
      const product = await getCachedProductUnderstanding(task.productCacheKey);
      if (!dna || !product) throw new Error("理解结果缓存已失效，请重试。");
      const generated = await generateReplicaPrompt({
        dna,
        product,
        productReferences: task.products.map((item) => ({ assetId: item.assetId, name: item.name })),
        requirements: task.requirements,
        referenceCopy: task.referenceCopy,
        copyMode: task.copyMode === "custom" ? "custom" : "source",
        customCopy: task.customCopy || ""
      });
      const nextVersion = {
        id: `replica_version_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        version: task.versions.length + 1,
        prompt: generated.prompt,
        note: task.prompt ? "重新生成" : "首次生成",
        createdAt: new Date().toISOString()
      };
      await saveReplicaTaskRecord({
        ...task,
        title: generated.title,
        prompt: generated.prompt,
        versions: [...task.versions, nextVersion],
        selfCheck: generated.selfCheck,
        warnings: generated.warnings,
        status: "completed",
        error: ""
      });
      return;
    }

    if (task.video.cacheKey && (!task.products.length || task.productCacheKey)) {
      await update(taskId, { status: "draft", error: "" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析失败，请重试。";
    const progress = activeProgress.get(taskId);
    await patchReplicaTaskRecord(taskId, {
      status: "failed",
      error: message,
      analysisProgress: progress ? {
        ...progress,
        status: "failed",
        errorCode: "ANALYSIS_FAILED",
        errorMessage: message,
        updatedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString()
      } : undefined
    });
  } finally {
    clearInterval(heartbeat);
  }
}

async function update(taskId: string, patch: Partial<ReplicaTaskRecord>) {
  const updated = await patchReplicaTaskRecord(taskId, patch);
  if (!updated) throw new Error("复刻任务不存在。");
  return updated;
}
