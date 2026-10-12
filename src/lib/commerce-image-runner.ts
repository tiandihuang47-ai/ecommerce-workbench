import { randomUUID } from "node:crypto";
import { findModel, resolveImageModelChain } from "@/lib/model-router";
import { readFile } from "node:fs/promises";
import { executeCommerceImageAnalysis, isCommerceImageAnalysisRunning } from "@/lib/commerce-image-analysis";
import { isCommerceChatGenerationRunning } from "@/lib/commerce-image-chat";
import { buildCommerceImagePlan, buildDirectCommerceImagePlan, compileCommerceImagePanel, isDirectCommerceKind } from "@/lib/commerce-image-plan";
import { CLEAN_BASE_IMAGE_RULE, detectCommerceImageTextRequirement } from "@/lib/commerce-image-marketing";
import { now, since, trace } from "@/lib/perf-trace";
import {
  commerceImageModelRegistry,
  matchesCommerceImageRatio,
  resolveCanonicalCommerceImageSize,
  resolveCommerceImageSize
} from "@/lib/commerce-image-models";
import sharp from "sharp";
import { inspectXiaohongshuPanel } from "@/lib/commerce-image-quality";
import { createMarketingVisionChecker } from "@/marketing/engine/bridge";
import { runMarketingQa } from "@/marketing/engine/qa";
import { recordCreativeForVersion, syncTaskCreatives } from "@/lib/marketing-learning";
import type { MarketingProductFidelityPlan, MarketingTypographyPlan } from "@/marketing/engine/types";
import { getResolvedProviderConfig, providerForModel } from "@/lib/commerce-image-config";
import { readImageMetadata } from "@/lib/commerce-image-file";
import {
  CommerceImageProviderError,
  generateCommerceImage,
  TRANSIENT_RETRY_DELAYS_MS,
  type CommerceImageReferenceInput
} from "@/lib/commerce-image-provider";
import {
  getCommerceImageTask,
  persistCommerceImageVersion,
  recordUsedProductReferences,
  saveCommerceImageTask
} from "@/lib/commerce-image-store";
import type {
  CommerceImageGenerationSet,
  CommerceImagePanel,
  CommerceImagePanelQuality,
  CommerceImagePromptSnapshot,
  CommerceImageStructuredError,
  CommerceImageTask,
  CommerceImageTaskKind,
  ResolvedCommerceImageModel
} from "@/lib/commerce-image-types";

type RunnerEntry = { controller: AbortController; promise: Promise<void> };

/** 后台质检需要的数据（图片已经落库之后才执行）。 */
type DeferredQualityCheck = {
  task: CommerceImageTask;
  panel: CommerceImagePanel;
  bytes: Uint8Array;
  mimeType: string;
  productReferences: CommerceImageReferenceInput[];
  seriesReferences: CommerceImageReferenceInput[];
  versionId: string;
  sizeNote: string;
  requiresInImageText: boolean;
  /** 营销引擎程序排版：底图干净，文字层按模板保留，不被视觉安全区覆盖。 */
  marketingOverlay: boolean;
  signal?: AbortSignal;
  baseTextLayers: CommerceImagePanel["textLayers"];
};

/** 后台质检算完的结果。 */
type DeferredQualityOutcome = {
  versionId: string;
  quality: CommerceImagePanelQuality;
  layoutGuide: CommerceImagePanel["layoutGuide"];
  textLayers: CommerceImagePanel["textLayers"];
};

/* 质检结论先记在内存里。出图后的收尾写盘（营销质检 applyMarketingQa 等）会带着旧快照
 * 重写整份 task.json，可能把后台质检刚写进去的结论覆盖掉；收尾时用这里再补回来，
 * 保证「质检不挡出图」的同时，质检结论也不会丢。 */
const deferredQualityOutcomes = new Map<string, Map<string, DeferredQualityOutcome>>();

function rememberDeferredQuality(taskId: string, panelId: string, outcome: DeferredQualityOutcome) {
  const panels = deferredQualityOutcomes.get(taskId) || new Map<string, DeferredQualityOutcome>();
  panels.set(panelId, outcome);
  deferredQualityOutcomes.set(taskId, panels);
  /* 本地工具、任务数量有限；兜底防止长期运行后无限增长。 */
  if (deferredQualityOutcomes.size > 200) {
    const oldest = deferredQualityOutcomes.keys().next().value;
    if (oldest) deferredQualityOutcomes.delete(oldest);
  }
}

function forgetDeferredQuality(taskId: string) {
  deferredQualityOutcomes.delete(taskId);
}

/** 同时最多几个画面在生成。上游偶发限流时会退避重试，先保守用 2。 */
const PANEL_CONCURRENCY = 2;

class PanelQualityError extends Error {
  constructor(readonly quality: CommerceImagePanelQuality) {
    super(`这张图重做一次后仍未通过画面检查：${quality.warnings.join("；")}。请调整本页画面后单独重做。`);
  }
}

export type CommerceImageRunOptions = {
  panelIds?: string[];
  setIds?: string[];
  oneClick?: boolean;
  instruction?: string;
};

const globalRunnerState = globalThis as typeof globalThis & {
  __commerceImageRunners?: Map<string, RunnerEntry>;
};
const runners = globalRunnerState.__commerceImageRunners || new Map<string, RunnerEntry>();
globalRunnerState.__commerceImageRunners = runners;

export function startCommerceImageTask(taskId: string, options: CommerceImageRunOptions = {}) {
  if (runners.has(taskId)) return false;
  const controller = new AbortController();
  const promise = executeCommerceImageTask(
    taskId,
    controller.signal,
    options.panelIds,
    options.setIds,
    options.oneClick,
    options.instruction
  )
    .catch((error) => markRunnerFailure(taskId, error))
    .finally(() => runners.delete(taskId));
  runners.set(taskId, { controller, promise });
  return true;
}

export function cancelCommerceImageTask(taskId: string) {
  const runner = runners.get(taskId);
  if (!runner) return false;
  runner.controller.abort();
  return true;
}

export function isCommerceImageTaskRunning(taskId: string) {
  return runners.has(taskId);
}

export async function recoverStalledCommerceImageTask(task: CommerceImageTask) {
  if (
    (task.status !== "planning" && task.status !== "queued" && task.status !== "generating") ||
    runners.has(task.id) ||
    isCommerceImageAnalysisRunning(task.id) ||
    isCommerceChatGenerationRunning(task.id)
  )
    return task;
  const hasCompletedImage = task.panels.some((panel) => panel.versions.length > 0);
  const message =
    task.status === "planning"
      ? "应用曾在 AI 理解素材时退出；请重新点击生成图片继续。"
      : "应用曾在生成过程中退出；已完成图片已保留，点击继续只会生成缺失项。";
  return saveCommerceImageTask({
    ...task,
    status: hasCompletedImage ? "partial" : "draft",
    error: "",
    lastError: undefined,
    generationSets: task.generationSets.map((set) =>
      set.status === "generating"
        ? {
            ...set,
            status: setHasAnyVersion(task, set.id) ? "partial" : "draft"
          }
        : set
    ),
    panels: task.panels.map((panel) =>
      panel.status === "queued" || panel.status === "generating"
        ? {
            ...panel,
            status: panel.versions.length ? "completed" : "draft",
            error: ""
          }
        : panel
    ),
    progress: {
      completed: task.panels.filter((panel) => panel.versions.length).length,
      total: task.panels.length * Math.max(1, task.generationSets.length),
      currentPanelId: "",
      message,
      updatedAt: new Date().toISOString()
    }
  });
}

export async function executeCommerceImageTask(
  taskId: string,
  signal?: AbortSignal,
  panelIds?: string[],
  setIds?: string[],
  oneClick = false,
  instruction = ""
) {
  const runStartedAt = now();
  let task = await getCommerceImageTask(taskId);
  if (!task) throw new Error("生图任务不存在。");
  if (oneClick && instruction.trim()) task = await applyOneClickInstruction(task, instruction);
  const prepareStartedAt = now();
  if (oneClick) task = await prepareOneClickGeneration(task, Boolean(panelIds?.length));
  /* 复用旧方案（例如「重新生成这一张」）时，面板上可能还留着旧比例；
   * 任务比例才是用户当前的选择，先把它同步下去再出图。 */
  const taskRatio = task.ratio;
  if (taskRatio !== "original" && task.panels.some((panel) => panel.ratio !== taskRatio)) {
    const synced = await saveCommerceImageTask({
      ...task,
      panels: task.panels.map((panel) => (panel.ratio === taskRatio ? panel : { ...panel, ratio: taskRatio }))
    });
    task = synced;
    trace("ratio_sync", { kind: synced.kind, ratio: taskRatio, panels: synced.panels.length });
  }
  trace("context_prepare", {
    ms: Math.round(since(prepareStartedAt)),
    panels: task.panels.length,
    facts: task.productFacts.length,
    refs: task.sourceAssets.length
  });
  if (signal?.aborted) {
    await saveCommerceImageTask({
      ...task,
      status: "cancelled",
      error: "",
      progress: {
        completed: 0,
        total: 0,
        currentPanelId: "",
        message: "任务已停止",
        updatedAt: new Date().toISOString()
      }
    });
    return;
  }
  if (!task.approvedAt || task.approvedPlanRevision !== task.planRevision) {
    throw new Error("AI 尚未完成本次图片方案，请重新点击生成图片。");
  }
  /* 不再要求用户先确认故事线：未确认时后台照常完成内部规划并继续生成，
   * 规划失败会直接让任务进入失败态，而不是停在这里等确认。 */
  const productAssets = task.sourceAssets.filter((asset) => isProductReference(asset.role));
  if (!productAssets.length) throw new Error("请至少上传 1 张真实商品参考图后再生成。");

  if (!task.generationSets.length) {
    task = await saveCommerceImageTask({
      ...task,
      generationSets: createGenerationSets(task.generationSetCount),
      selectedSetId: ""
    });
    task = await saveCommerceImageTask({
      ...task,
      selectedSetId: task.generationSets[0]?.id || ""
    });
  }
  const resolvedModelId = await resolveTaskModel(task);
  const selectedSetId = task.selectedSetId;
  const requestedPanelIds = new Set(panelIds?.filter(Boolean) || []);
  const requestedSetIds = new Set(setIds?.filter(Boolean) || []);
  const targetPanels = requestedPanelIds.size
    ? task.panels.filter((panel) => requestedPanelIds.has(panel.id))
    : task.panels;
  const targetSets = requestedSetIds.size
    ? task.generationSets.filter((set) => requestedSetIds.has(set.id))
    : requestedPanelIds.size
      ? task.generationSets.filter((set) => set.id === selectedSetId)
      : task.kind === "xiaohongshu_post"
        ? task.generationSets.slice(-task.generationSetCount)
        : task.generationSets;
  if (!targetPanels.length || !targetSets.length) throw new Error("没有可生成的画面或方案。");

  const forceRegenerate = requestedPanelIds.size > 0;
  const jobs = targetSets.flatMap((set) =>
    targetPanels
      .filter((panel) => forceRegenerate || !panel.versions.some((version) => version.setId === set.id))
      .map((panel) => ({ setId: set.id, panelId: panel.id }))
  );
  if (!jobs.length) {
    await saveCommerceImageTask({
      ...task,
      status: "completed",
      error: "",
      lastError: undefined,
      generationSets: finalizeGenerationSets(
        task,
        targetSets.map((set) => set.id)
      ),
      progress: {
        completed: 0,
        total: 0,
        currentPanelId: "",
        message: "所选方案已经完整生成，无需重复调用模型",
        updatedAt: new Date().toISOString()
      }
    });
    return;
  }

  const targetPanelIdSet = new Set(targetPanels.map((panel) => panel.id));
  const targetSetIdSet = new Set(targetSets.map((set) => set.id));
  task = await saveCommerceImageTask({
    ...task,
    resolvedModelId,
    status: "queued",
    error: "",
    lastError: undefined,
    generationSets: task.generationSets.map((set) =>
      targetSetIdSet.has(set.id) ? { ...set, status: "generating" } : set
    ),
    panels: task.panels.map((panel) =>
      targetPanelIdSet.has(panel.id) ? { ...panel, status: "queued", error: "" } : panel
    ),
    progress: {
      completed: 0,
      total: jobs.length,
      currentPanelId: "",
      message: "任务已进入生成队列",
      updatedAt: new Date().toISOString()
    }
  });

  /* 用户这一步真正输入的原话：优先本次请求带来的 instruction，其次保留上一次快照，
   * 最后兜底到任务里的 brief.extra——旧任务也能看到「我当时说了什么」。 */
  const userInstruction = oneClick && instruction.trim()
    ? instruction.trim()
    : task.promptSnapshot?.userInstruction || task.brief.extra || "";
  const snapshotSource: CommerceImageTask = task;
  await recordPromptSnapshot(taskId, {
    userInstruction,
    model: snapshotSource.model,
    resolvedModelId,
    ratio: snapshotSource.ratio,
    quality: snapshotSource.quality || "high",
    count: snapshotSource.brief.cardCount,
    contentGoal: snapshotSource.brief.strategy,
    panels: targetPanels.map((panel) => {
      const compiled = compileCommerceImagePanel(snapshotSource, panel);
      const size = resolvePanelSize(snapshotSource, compiled);
      return {
        panelId: panel.id,
        title: compiled.title,
        compiledPrompt: compiled.prompt,
        size: `${size.width}×${size.height}`
      };
    })
  });

  /* 「用户选了什么、真正请求了什么」在发请求之前就落档 + 打点，出问题能一眼对上。 */
  const requestSpec = resolvePanelSize(task, targetPanels[0]);
  trace("ratio_request", {
    selectedRatio: task.ratio,
    selectedResolution: task.quality || "high",
    requestedWidth: requestSpec.width,
    requestedHeight: requestSpec.height,
    providerRequestSize: `${requestSpec.width}x${requestSpec.height}`
  });
  await updateGenerationSpec(taskId, {
    aspectRatio: task.ratio,
    resolution: task.quality || "high",
    requestedWidth: requestSpec.width,
    requestedHeight: requestSpec.height,
    providerRequestSize: `${requestSpec.width}x${requestSpec.height}`
  });

  let fatalError: CommerceImageStructuredError | undefined;
  const counters = { completed: 0, failed: 0 };
  const stopped = () => Boolean(signal?.aborted) || Boolean(fatalError);
  const progressFor = (message: string, currentPanelId: string): NonNullable<CommerceImageTask["progress"]> => ({
    completed: counters.completed,
    total: jobs.length,
    currentPanelId,
    message,
    updatedAt: new Date().toISOString()
  });

  const runJob = async (job: { setId: string; panelId: string }) => {
    if (stopped()) return;
    const snapshot = await getCommerceImageTask(taskId);
    if (!snapshot) return;
    const panel = snapshot.panels.find((item) => item.id === job.panelId);
    const set = snapshot.generationSets.find((item) => item.id === job.setId);
    if (!panel || !set) return;
    await mutateCommerceImagePanel(
      taskId,
      panel.id,
      () => ({ status: "generating", error: "" }),
      () => progressFor(`正在生成${set.label} · ${panel.title}`, panel.id)
    );
    try {
      const compiledPanel = compileCommerceImagePanel(snapshot, panel);
      const generated = await generatePanel(snapshot, compiledPanel, resolvedModelId, set.id, signal, (ids) => {
        if (ids.length) void recordUsedProductReferences(taskId, ids).catch(() => undefined);
      });
      const version = generated.version;
      await mutateCommerceImagePanel(
        taskId,
        panel.id,
        (fresh) => {
          counters.completed += 1;
          return {
            status: "completed",
            error: "",
            versions: [...fresh.versions, version],
            selectedVersionId: set.id === selectedSetId ? version.id : fresh.selectedVersionId,
            prompt: compiledPanel.prompt,
            description: compiledPanel.description
          };
        },
        () => progressFor(`${set.label} · ${panel.title}已完成`, panel.id)
      );
      /* 营销学习闭环：每张最终图片建立独立 creativeId 的创意记录（不阻塞出图）。 */
      await recordCreativeForVersion({ task: snapshot, panel, version, setId: set.id }).catch(() => undefined);
      /* 质检不挡出图：图片上一步已经落库、界面马上能看到，
       * 画面检查放到后台慢慢跑，跑完再把 quality / 安全区 / 文字层回填。 */
      for (const qualityCheck of generated.deferredQualityChecks || []) void runDeferredQualityCheck(qualityCheck);
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return;
      counters.failed += 1;
      const detail = structuredError(error, resolvedModelId);
      if (isFatalError(detail)) fatalError = detail;
      const quality = error instanceof PanelQualityError ? error.quality : undefined;
      await mutateCommerceImagePanel(
        taskId,
        panel.id,
        () => ({
          status: "failed",
          error: detail.message,
          ...(quality ? { quality } : {})
        }),
        () => progressFor(fatalError ? detail.message : `${set.label} · ${panel.title}生成失败，已继续下一张`, panel.id)
      );
    }
  };

  if (task.kind === "xiaohongshu_post" && jobs.length > 1) {
    // 小红书整组要保持同一套光线与色调：第一张先单独生成作为锚点，其余画面再并发生成。
    const anchoredSets = new Set<string>();
    const anchorJobs: Array<{ setId: string; panelId: string }> = [];
    const restJobs: Array<{ setId: string; panelId: string }> = [];
    for (const job of jobs) {
      if (anchoredSets.has(job.setId)) restJobs.push(job);
      else {
        anchoredSets.add(job.setId);
        anchorJobs.push(job);
      }
    }
    await runJobsWithConcurrency(anchorJobs, 1, runJob, stopped);
    await runJobsWithConcurrency(restJobs, PANEL_CONCURRENCY, runJob, stopped);
  } else {
    await runJobsWithConcurrency(jobs, PANEL_CONCURRENCY, runJob, stopped);
  }

  task = (await getCommerceImageTask(taskId)) || task;
  /* 生成成功不等于营销任务成功：出图后单独跑一次营销质检。
   * 仅当用户要求画面文字且既有质检没有文字结论时才补一次视觉调用，避免重复花费。 */
  task = await applyMarketingQa(task, signal);
  const cancelled = Boolean(signal?.aborted);
  const generationSets = finalizeGenerationSets(task, [...targetSetIdSet], fatalError);
  const panels = task.panels.map((panel) => {
    const selected = latestVersionForSet(panel, task.selectedSetId);
    if (!targetPanelIdSet.has(panel.id)) return panel;
    if (panel.status === "queued" || panel.status === "generating") {
      return {
        ...panel,
        status: selected ? ("completed" as const) : cancelled ? ("cancelled" as const) : ("draft" as const),
        error: cancelled ? "已取消" : ""
      };
    }
    return selected && panel.status !== "failed"
      ? {
          ...panel,
          status: "completed" as const,
          selectedVersionId: selected.id
        }
      : panel;
  });
  const hasAnyImage = panels.some((panel) => panel.versions.length > 0);
  const allTargetSetsComplete = generationSets
    .filter((set) => targetSetIdSet.has(set.id))
    .every((set) => set.status === "completed");
  const status = cancelled
    ? "cancelled"
    : fatalError
      ? hasAnyImage
        ? "partial"
        : "failed"
      : allTargetSetsComplete && counters.failed === 0
        ? "completed"
        : hasAnyImage
          ? "partial"
          : "failed";
  /* 给用户看的一句话说明：不把 provider 原始报文、HTTP 状态码或 JSON 抛到界面上。
   * 原始细节仍然完整保存在 lastError 里，供排查使用。 */
  const failureCount = panels.filter((panel) => targetPanelIdSet.has(panel.id) && panel.status === "failed").length;
  const userFacingError = cancelled
    ? ""
    : fatalError
      ? hasAnyImage
        ? `有 ${failureCount || 1} 张没有生成成功：${fatalError.message}`
        : fatalError.message
      : failureCount > 0
        ? hasAnyImage
          ? `有 ${failureCount} 张没有生成成功，可以点「重试」重新生成这些画面。`
          : "图片生成失败，请点「重试」重新生成。"
        : "";
  trace("task_done", {
    status,
    panels: panels.length,
    jobs: jobs.length,
    failed: counters.failed,
    totalMs: Math.round(since(runStartedAt))
  });
  await withCommerceImageTaskLock(taskId, async () => {
    /* 后台质检可能比这次收尾写盘更早完成；盘上的 quality / 安全区 / 文字层更新，要保留。 */
    const latestTask = await getCommerceImageTask(taskId);
    const remembered = deferredQualityOutcomes.get(taskId);
    const mergedPanels = panels.map((panel) => {
      const stored = latestTask?.panels.find((item) => item.id === panel.id);
      let next = panel;
      if (stored && (stored.quality || stored.layoutGuide)) {
        next = {
          ...next,
          quality: stored.quality || next.quality,
          layoutGuide: stored.layoutGuide || next.layoutGuide,
          textLayers: stored.quality ? stored.textLayers : next.textLayers
        };
      }
      /* 本轮后台质检可能比收尾更早跑完，结论先记在内存里，这里按版本号补回来。 */
      const outcome = remembered?.get(panel.id);
      if (outcome && (next.selectedVersionId === outcome.versionId || next.versions.at(-1)?.id === outcome.versionId)) {
        next = {
          ...next,
          quality: outcome.quality,
          layoutGuide: outcome.layoutGuide,
          textLayers: outcome.textLayers
        };
      }
      return next;
    });
    await saveCommerceImageTask({
      ...task,
      panels: mergedPanels,
      generationSets,
      status,
      error: userFacingError,
      lastError: fatalError,
      progress: {
        completed: counters.completed,
        total: jobs.length,
        currentPanelId: "",
        message: cancelled
          ? "任务已停止，已完成图片已保留"
          : fatalError
            ? fatalError.message
            : status === "completed"
              ? "全部图片已生成"
              : "部分图片已生成，可继续缺失项",
        updatedAt: new Date().toISOString()
      }
    });
    forgetDeferredQuality(taskId);
  });
}

async function prepareOneClickGeneration(task: CommerceImageTask, regenerateSinglePanel: boolean) {
  const canReuseCurrentPlan =
    task.panels.length > 0 &&
    (regenerateSinglePanel ||
      ((["partial", "failed", "cancelled", "draft", "completed"] as CommerceImageTask["status"][]).includes(
        task.status
      ) &&
        task.approvedPlanRevision === task.planRevision &&
        Boolean(task.approvedAt)));
  const resumeExistingSets = canReuseCurrentPlan && task.generationSets.length > 0;

  let prepared = task;
  if (!canReuseCurrentPlan) {
    if (task.kind === "retouch") {
      const plan = await buildCommerceImagePlan(task);
      prepared = await saveCommerceImageTask({
        ...task,
        ...plan,
        panels: plan.panels,
        planRevision: task.planRevision + 1,
        approvedPlanRevision: 0,
        approvedAt: "",
        generationSets: [],
        selectedSetId: "",
        status: "planning",
        error: "",
        progress: {
          completed: 1,
          total: 2,
          currentPanelId: "",
          message: "正在整理图片任务",
          updatedAt: new Date().toISOString()
        }
      });
    } else if (isDirectCommerceKind(task.kind)) {
      /* 直连模式：本地按张数生成画面方案（含卖点卡职责分配），不跑营销 Agent / 故事线 / 平台分流。 */
      const directStartedAt = now();
      const plan = await buildDirectCommerceImagePlan(task);
      trace("direct_plan", { kind: task.kind, panels: plan.panels.length, ms: Math.round(since(directStartedAt)) });
      prepared = await saveCommerceImageTask({
        ...task,
        ...plan,
        panels: plan.panels,
        planRevision: task.planRevision + 1,
        approvedPlanRevision: 0,
        approvedAt: "",
        generationSets: [],
        selectedSetId: "",
        status: "planning",
        error: "",
        progress: {
          completed: 1,
          total: 2,
          currentPanelId: "",
          message: "正在准备直连生图",
          updatedAt: new Date().toISOString()
        }
      });
    } else {
      await executeCommerceImageAnalysis(task.id, { autoGenerate: true });
      const analyzed = await getCommerceImageTask(task.id);
      if (!analyzed) throw new Error("AI 分析完成后未找到生图项目。");
      prepared = analyzed;
    }
  }

  if (!prepared.panels.length) throw new Error("AI 没有生成可用的画面方案，请补充需求后重试。");
  const generationSets =
    resumeExistingSets && prepared.generationSets.length ? prepared.generationSets : createGenerationSets(1);
  const selectedSetId = generationSets.some((set) => set.id === prepared.selectedSetId)
    ? prepared.selectedSetId
    : generationSets[0]?.id || "";
  return saveCommerceImageTask({
    ...prepared,
    generationSetCount: resumeExistingSets ? prepared.generationSetCount : 1,
    generationSets,
    selectedSetId,
    approvedAt: new Date().toISOString(),
    approvedPlanRevision: prepared.planRevision,
    status: "draft",
    error: "",
    lastError: undefined,
    progress: {
      completed: 0,
      total: prepared.panels.length,
      currentPanelId: "",
      message: "素材与需求已理解，正在开始生成图片",
      updatedAt: new Date().toISOString()
    }
  });
}

async function applyOneClickInstruction(task: CommerceImageTask, instruction: string) {
  const content = instruction.trim().slice(0, 4000);
  if (!content) return task;
  const now = new Date().toISOString();
  return saveCommerceImageTask({
    ...task,
    generationSetCount: 1,
    brief: { ...task.brief, extra: content },
    chatMessages: [
      ...task.chatMessages,
      {
        id: `commerce_image_message_${randomUUID()}`,
        role: "user",
        content,
        createdAt: now
      }
    ],
    approvedAt: "",
    approvedPlanRevision: 0,
    status: "draft",
    error: "",
    lastError: undefined,
    progress: {
      completed: 0,
      total: 3,
      currentPanelId: "",
      message: "AI 正在理解你刚刚提交的要求",
      updatedAt: now
    }
  });
}

/**
 * 生成参数快照：任务开始时写入「用户选择 + 请求尺寸」，出图后回填「上游返回 + 最终真实尺寸」。
 * 比例字段（aspectRatio）是唯一真源，历史任务重新打开时读它，不再推算。
 */
async function updateGenerationSpec(taskId: string, patch: Partial<NonNullable<CommerceImageTask["generationSpec"]>>) {
  return withCommerceImageTaskLock(taskId, async () => {
    const fresh = await getCommerceImageTask(taskId);
    if (!fresh) return undefined;
    const previous = fresh.generationSpec;
    const next: NonNullable<CommerceImageTask["generationSpec"]> = {
      aspectRatio: patch.aspectRatio || previous?.aspectRatio || (fresh.ratio === "original" ? "original" : fresh.ratio),
      resolution: patch.resolution || previous?.resolution || fresh.quality || "high",
      requestedWidth: patch.requestedWidth || previous?.requestedWidth || 0,
      requestedHeight: patch.requestedHeight || previous?.requestedHeight || 0,
      providerRequestSize: patch.providerRequestSize || previous?.providerRequestSize || "",
      providerReturnedWidth: patch.providerReturnedWidth ?? previous?.providerReturnedWidth,
      providerReturnedHeight: patch.providerReturnedHeight ?? previous?.providerReturnedHeight,
      actualWidth: patch.actualWidth ?? previous?.actualWidth,
      actualHeight: patch.actualHeight ?? previous?.actualHeight,
      actualAspectRatio: patch.actualAspectRatio ?? previous?.actualAspectRatio,
      ratioStatus: patch.ratioStatus || previous?.ratioStatus || "ok",
      recordedAt: new Date().toISOString()
    };
    return saveCommerceImageTask({ ...fresh, generationSpec: next });
  });
}

/**
 * 上游返回的图必须严格符合用户所选比例。
 * 不符合时只做「等比居中裁剪」（先取图内最大的、严格 a:b 的居中矩形），
 * 绝不拉伸、绝不放大小尺寸、也不会有损重编码（输入 PNG 输出 PNG）。
 */
async function enforceStrictRatio(bytes: Uint8Array, ratioLabel: string): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
  providerSize: { width: number; height: number };
  cropped: boolean;
}> {
  const original = readImageMetadata(bytes);
  const providerSize = { width: original.width, height: original.height };
  const parts = ratioLabel.split(":");
  if (ratioLabel === "original" || parts.length !== 2 || !original.width || !original.height) {
    return { bytes, width: original.width, height: original.height, mimeType: original.mimeType, providerSize, cropped: false };
  }
  if (matchesCommerceImageRatio(ratioLabel, original.width, original.height)) {
    return { bytes, width: original.width, height: original.height, mimeType: original.mimeType, providerSize, cropped: false };
  }
  const [a, b] = parts.map((part) => Number.parseInt(part, 10));
  const scale = a > 0 && b > 0 ? Math.floor(Math.min(original.width / a, original.height / b)) : 0;
  if (scale < 1) {
    /* 连一个最小比例矩形都放不下（理论上不会发生）：保留原图，交给上层告警。 */
    return { bytes, width: original.width, height: original.height, mimeType: original.mimeType, providerSize, cropped: false };
  }
  const width = a * scale;
  const height = b * scale;
  const croppedBytes = await sharp(Buffer.from(bytes))
    .extract({
      left: Math.max(0, Math.floor((original.width - width) / 2)),
      top: Math.max(0, Math.floor((original.height - height) / 2)),
      width,
      height
    })
    .png()
    .toBuffer();
  return {
    bytes: new Uint8Array(croppedBytes),
    width,
    height,
    mimeType: "image/png",
    providerSize,
    cropped: true
  };
}

/**
 * 这张画面这次要请求的尺寸。
 *
 * 关键：**以任务比例为唯一真源**（不是面板上可能过期的 ratio），并用严格比例表换算出精确像素，
 * 这样「用户选 9:16 就一定是 1152×2048」；只有商品修图（保持原尺寸）才按原图推算。
 */
function reduceAspectRatio(width: number, height: number): string {
  if (!width || !height) return "";
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function resolvePanelSize(task: CommerceImageTask, panel: CommerceImagePanel) {
  if (task.ratio !== "original") {
    return resolveCanonicalCommerceImageSize(task.ratio, task.quality || "high");
  }
  const productAssets = task.sourceAssets.filter((asset) => isProductReference(asset.role));
  const originalAsset = productAssets[Math.max(0, task.panels.findIndex((item) => item.id === panel.id))] || productAssets[0];
  return resolveCommerceImageSize(
    "original",
    originalAsset?.width && originalAsset?.height ? { width: originalAsset.width, height: originalAsset.height } : undefined
  );
}

/**
 * 记录本次生成真正使用的提示词快照。
 * 关键点：在 Provider 请求发出之前就写盘，并且只在第一次写入时确定 userInstruction /
 * 参数，后续只补每张画面「实际发出去的那一句」——产品资料、Prompt Compiler 之后再变，
 * 历史任务里的快照也不会变。
 */
async function recordPromptSnapshot(taskId: string, options: {
  userInstruction?: string;
  model?: CommerceImageTask["model"];
  resolvedModelId?: CommerceImageTask["resolvedModelId"];
  ratio?: CommerceImageTask["ratio"];
  quality?: CommerceImageTask["quality"];
  count?: number;
  contentGoal?: string;
  panels?: Array<{ panelId: string; title: string; compiledPrompt: string; size?: string; model?: string }>;
}) {
  return withCommerceImageTaskLock(taskId, async () => {
    const fresh = await getCommerceImageTask(taskId);
    if (!fresh) return undefined;
    const previous = fresh.promptSnapshot;
    const stamp = new Date().toISOString();
    const panelsById = new Map((previous?.panels || []).map((panel) => [panel.panelId, panel]));
    for (const panel of options.panels || []) {
      const before = panelsById.get(panel.panelId);
      panelsById.set(panel.panelId, {
        panelId: panel.panelId,
        title: panel.title || before?.title || "",
        compiledPrompt: panel.compiledPrompt || before?.compiledPrompt || "",
        model: panel.model || before?.model || "",
        size: panel.size || before?.size || "",
        capturedAt: before?.capturedAt || stamp
      });
    }
    const panels = [...panelsById.values()];
    const snapshot: CommerceImagePromptSnapshot = {
      userInstruction: options.userInstruction !== undefined
        ? options.userInstruction
        : previous?.userInstruction || "",
      compiledPrompt: panels.at(-1)?.compiledPrompt || previous?.compiledPrompt || "",
      panels,
      model: options.model || previous?.model || fresh.model,
      resolvedModelId: options.resolvedModelId || previous?.resolvedModelId || fresh.resolvedModelId || "",
      ratio: options.ratio || previous?.ratio || fresh.ratio,
      quality: options.quality || previous?.quality || fresh.quality || "high",
      count: options.count || previous?.count || fresh.brief.cardCount,
      contentGoal: options.contentGoal || previous?.contentGoal || fresh.brief.strategy,
      capturedAt: previous?.capturedAt || stamp,
      updatedAt: stamp
    };
    return saveCommerceImageTask({ ...fresh, promptSnapshot: snapshot });
  });
}

async function generatePanel(
  task: CommerceImageTask,
  panel: CommerceImagePanel,
  modelId: ResolvedCommerceImageModel,
  setId: string,
  signal?: AbortSignal,
  onReferencesReady?: (assetIds: string[]) => void
) {
  const productAssets = task.sourceAssets.filter((asset) => isProductReference(asset.role));
  const originalAsset =
    task.kind === "retouch"
      ? productAssets[Math.max(0, task.panels.findIndex((item) => item.id === panel.id))] || productAssets[0]
      : productAssets[0];
  const size = resolvePanelSize(task, panel);
  const maxReferences = commerceImageModelRegistry[modelId].maxReferenceImages;
  // 并发下必须读盘上的最新状态，否则拿不到刚刚完成的系列锚点画面。
  const latest = (await getCommerceImageTask(task.id)) || task;
  const seriesReferences = await loadSeriesReferences(latest, panel, setId, modelId);
  const sourceAssets =
    task.kind === "retouch"
      ? [originalAsset].filter(Boolean)
      : prioritizeReferences(task, panel).slice(0, maxReferences - seriesReferences.length);
  /* 记下这次真正发往模型的参考图，任务里能事后核对。 */
  const usedAssetIds = sourceAssets.map((asset) => asset.id).filter(Boolean);
  onReferencesReady?.(usedAssetIds);
  const refReadStartedAt = now();
  const references: CommerceImageReferenceInput[] = [];
  for (const asset of sourceAssets) {
    if (!asset.storagePath) continue;
    references.push({
      bytes: new Uint8Array(await readFile(asset.storagePath)),
      mimeType: asset.mimeType,
      name: asset.name
    });
  }
  const refReadMs = since(refReadStartedAt);
  trace("input_ready", { kind: task.kind, refs: references.length, refReadMs, promptLen: panel.prompt.length });
  if (!references.length) throw new Error("参考图文件不可用，请重新上传。");
  const productReferences = references.filter((_, index) =>
    isProductReference(sourceAssets[index]?.role || "style_reference")
  );
  references.push(...seriesReferences);
  const transparent = task.kind === "retouch" && task.brief.retouchOperation === "transparent_background";
  const deferredQualityChecks: DeferredQualityCheck[] = [];
  let attempt = 0;
  /* 上游返回比例不符时：先按正确 size 重新请求一次（方案1），仍不符才本地等比裁剪（方案2）。 */
  let ratioRetryCount = 0;
  /* 提示词已经在 buildPanel 里按优先级装配好（用户原话 + 文字要求 + 产品资料 + 约束），
   * 这里只补系列参考说明。「干净底图」规则只在用户没有要求画面内文字时才追加，
   * 且不再重复第二遍——之前重复两遍会让模型收到自相矛盾的指令。 */
  /* 营销引擎默认程序排版：底图必须干净，中文由排版层叠加，不再要求模型写字。 */
  const marketingOverlay = Boolean(task.marketing && task.marketing.typography?.textMode === "overlay");
  const requiresInImageText = !marketingOverlay && detectCommerceImageTextRequirement(task.brief.extra) === "require";
  const needsCleanRule = !requiresInImageText && !panel.prompt.includes(CLEAN_BASE_IMAGE_RULE);
  const basePrompt = [
    panel.prompt,
    seriesReferences.length
      ? "最后附加的参考是已生成的同组摄影画面，仅沿用光线、配色和场景氛围。商品外观始终以最前面的用户原图为准；推进本页新的景别和内容，不能复制前页构图。"
      : "",
    needsCleanRule ? CLEAN_BASE_IMAGE_RULE : ""
  ]
    .filter(Boolean)
    .join("\n");
  let prompt = basePrompt;
  while (attempt < 4) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    try {
      /* 发请求之前先把这一张真正要用的提示词写进任务快照：
       * Provider 失败、超时或用户直接关页面，历史里都还能看到当时究竟发了什么。 */
      if (attempt === 0) {
        await recordPromptSnapshot(task.id, {
          panels: [{
            panelId: panel.id,
            title: panel.title,
            compiledPrompt: prompt,
            size: `${size.width}×${size.height}`,
            model: modelId
          }]
        }).catch(() => undefined);
      }
      const providerStartedAt = now();
      const result = await generateCommerceImage({
        modelId,
        prompt,
        size,
        /* 关键：清晰度必须传给 Provider。此前这里漏了 quality，
         * 所有适配器的「按清晰度换算分辨率」都被跳过，导致选了 4K 仍然请求 1536×2048。 */
        quality: task.quality || "high",
        references,
        transparent,
        signal,
        /* 4K 档请求的像素量是 2K 的 4 倍，实测上游明显更慢；给足够的超时预算，
         * 避免「慢但成功」的请求被判成超时（其它档位保持默认）。 */
        timeoutMs: task.quality === "ultra" ? 480_000 : undefined
      });
      const providerMs = since(providerStartedAt);
      /* 上游真实返回的尺寸先读出来做校验，绝不假设它符合请求。 */
      const returnedMeta = readImageMetadata(result.bytes);
      const ratioOk = task.ratio === "original" || matchesCommerceImageRatio(task.ratio, returnedMeta.width, returnedMeta.height);
      trace("ratio_validation", {
        panel: panel.title.slice(0, 8),
        selectedRatio: task.ratio,
        providerReturnedSize: `${returnedMeta.width}x${returnedMeta.height}`,
        ratioOk: ratioOk ? 1 : 0,
        action: ratioOk ? "pass" : ratioRetryCount < 1 ? "retry" : "crop"
      });
      if (!ratioOk && ratioRetryCount < 1) {
        ratioRetryCount += 1;
        await updateGenerationSpec(task.id, { ratioStatus: "retried" });
        await delay(1_000, signal);
        continue;
      }
      /* 落盘前做严格比例校验：上游偶尔会返回非目标比例（实测请求 9:16 回过 768×1344），
       * 这时只做等比居中裁剪，绝不拉伸；比例本来就正确时一个字节都不动（不重编码、不降质）。 */
      const enforced = await enforceStrictRatio(result.bytes, task.ratio);
      const bytes = enforced.bytes;
      const metadata = { ...readImageMetadata(bytes), width: enforced.width, height: enforced.height, mimeType: enforced.mimeType };
      const requestedSize = result.requestedSize || size;
      const sizeNote =
        enforced.providerSize.width !== requestedSize.width || enforced.providerSize.height !== requestedSize.height
          ? `上游实际输出 ${enforced.providerSize.width} × ${enforced.providerSize.height}，与本次请求的 ${requestedSize.width} × ${requestedSize.height} 不一致；已按实际尺寸保存。`
          : "";
      const ratioNote = enforced.cropped
        ? `上游返回的 ${enforced.providerSize.width} × ${enforced.providerSize.height} 不是严格 ${task.ratio}，已等比裁剪为 ${enforced.width} × ${enforced.height}（没有拉伸画面）。`
        : "";
      if (task.ratio !== "original" && !matchesCommerceImageRatio(task.ratio, metadata.width, metadata.height)) {
        /* 极端情况：连最小比例矩形都裁不出来。宁可让这一张失败并可重试，也不交付比例不对的图。 */
        throw new Error(`上游返回的图片无法校正为严格 ${task.ratio} 比例，请重试这一张。`);
      }
      trace("ratio_check", {
        panel: panel.title.slice(0, 8),
        target: task.ratio,
        requested: `${requestedSize.width}x${requestedSize.height}`,
        provider: `${enforced.providerSize.width}x${enforced.providerSize.height}`,
        final: `${metadata.width}x${metadata.height}`,
        cropped: enforced.cropped ? 1 : 0
      });
      trace("ratio_final", {
        selectedRatio: task.ratio,
        actualWidth: metadata.width,
        actualHeight: metadata.height,
        actualAspectRatio: reduceAspectRatio(metadata.width, metadata.height),
        ratioStatus: enforced.cropped ? "cropped" : ratioRetryCount > 0 ? "retried" : "ok"
      });
      await updateGenerationSpec(task.id, {
        providerReturnedWidth: enforced.providerSize.width,
        providerReturnedHeight: enforced.providerSize.height,
        actualWidth: metadata.width,
        actualHeight: metadata.height,
        actualAspectRatio: reduceAspectRatio(metadata.width, metadata.height),
        ratioStatus: enforced.cropped ? "cropped" : ratioRetryCount > 0 ? "retried" : "ok"
      });
      /* 画面质检不再挡在出图前面：模型一返回就把图片存下来、立刻能让用户看到，
       * 质检放到后台跑，跑完再回填 quality / 安全区 / 文字层。
       * 老的小红书故事线流程保持全量质检；直连画面只在绑定卖点卡时进入质检，
       * 用于检查「承诺的卖点是否真的呈现」。质检认为需要重做时只记录提示，
       * 不再自动再花一次钱重画——是否重做交给用户点「重新生成」决定。 */
      if ((task.kind === "xiaohongshu_post" && !isDirectCommerceKind(task.kind)) || (isDirectCommerceKind(task.kind) && Boolean(panel.sellingPoint))) {
        const version = await persistCommerceImageVersion({
          taskId: task.id,
          panelId: panel.id,
          bytes,
          modelId,
          providerModelId: result.providerModelId,
          prompt,
          setId,
          requestedSize,
          ratio: task.ratio,
          providerSize: enforced.providerSize
        });
        deferredQualityChecks.push({
          task,
          panel,
          bytes,
          mimeType: metadata.mimeType,
          productReferences,
          seriesReferences,
          versionId: version.id,
          sizeNote,
          requiresInImageText,
          marketingOverlay,
          signal,
          baseTextLayers: panel.textLayers
        });
        trace("panel_saved", {
          model: modelId,
          panel: panel.title.slice(0, 10),
          providerMs,
          quality: "deferred"
        });
        return { version, usedAssetIds, deferredQualityChecks };
      }
      trace("panel_size", {
        panel: panel.title.slice(0, 8),
        requested: `${requestedSize.width}x${requestedSize.height}`,
        actual: `${metadata.width}x${metadata.height}`,
        quality: task.quality || "high",
        model: modelId
      });
      const saveStartedAt = now();
      const version = await persistCommerceImageVersion({
        taskId: task.id,
        panelId: panel.id,
        bytes,
        modelId,
        providerModelId: result.providerModelId,
        prompt,
        setId,
        requestedSize,
        ratio: task.ratio,
        providerSize: enforced.providerSize
      });
      trace("panel", {
        model: modelId,
        panel: panel.title.slice(0, 10),
        refs: references.length,
        refReadMs,
        providerMs,
        saveMs: since(saveStartedAt),
        promptLen: prompt.length
      });
      return { version, usedAssetIds, deferredQualityChecks };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      const detail = structuredError(error, modelId);
      if (!detail.retryable || attempt >= TRANSIENT_RETRY_DELAYS_MS.length) throw error;
      await delay(TRANSIENT_RETRY_DELAYS_MS[attempt], signal);
      attempt += 1;
    }
  }
  throw new Error("图片生成失败。");
}

/**
 * 后台画面质检：图片已经保存、用户已经能看到之后才执行。
 * 只回填 quality / 安全区 / 文字层，不改任务状态，也不会自动再花钱重画；
 * 质检认为需要重做时只记一条提示，是否重做交给用户点「重新生成」决定。
 */
async function runDeferredQualityCheck(options: DeferredQualityCheck) {
  const { task, panel, versionId } = options;
  const label = panel.title.slice(0, 10);
  try {
    const qcStartedAt = now();
    const inspected = await inspectXiaohongshuPanel({
      task,
      panel,
      bytes: options.bytes,
      mimeType: options.mimeType,
      productReferences: options.productReferences,
      seriesReferences: options.seriesReferences,
      textMode: options.marketingOverlay ? "overlay" : "model",
      signal: options.signal
    });
    trace("quality_check", {
      panel: label,
      ms: Math.round(since(qcStartedAt)),
      status: inspected.quality.status,
      deferred: 1
    });
    if (options.signal?.aborted) return;
    const warnings = [...inspected.quality.warnings];
    if (options.sizeNote) warnings.unshift(options.sizeNote);
    if (inspected.shouldRetryGeneration) {
      warnings.unshift("自动质检建议重做这一张；点画面上的「重新生成」即可，不会自动扣费重画。");
    }
    const quality: CommerceImagePanelQuality = {
      ...inspected.quality,
      warnings
    };
    const textLayers = options.baseTextLayers.map((layer, index) => {
      // 程序排版：底图干净，文字层按模板保留，不被模型结果或视觉安全区覆盖。
      if (options.marketingOverlay) return layer;
      // 用户要求画面内文字时，文案由模型直接画在画面上，导出时不再叠加系统文字层，避免重复。
      if (options.requiresInImageText) return { ...layer, visible: false };
      const zone = inspected.layoutGuide.safeZones[index];
      return quality.textSafe && zone
        ? {
            ...layer,
            x: zone.x,
            y: zone.y,
            width: zone.width,
            height: zone.height
          }
        : { ...layer, visible: false };
    });
    await withCommerceImageTaskLock(task.id, async () => {
      const fresh = await getCommerceImageTask(task.id);
      const target = fresh?.panels.find((item) => item.id === panel.id);
      /* 质检期间用户可能已经换版本或重做过这一张，那就丢弃这次结论，不要覆盖新画面。 */
      if (!fresh || !target || (target.selectedVersionId !== versionId && target.versions.at(-1)?.id !== versionId)) {
        trace("quality_check", {
          panel: label,
          status: "skipped",
          deferred: 1
        });
        return undefined;
      }
      rememberDeferredQuality(task.id, panel.id, {
        versionId,
        quality,
        layoutGuide: inspected.layoutGuide,
        textLayers
      });
      return saveCommerceImageTask({
        ...fresh,
        panels: fresh.panels.map((item) =>
          item.id === panel.id
            ? {
                ...item,
                quality,
                layoutGuide: inspected.layoutGuide,
                textLayers
              }
            : item
        )
      });
    });
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) return;
    trace("quality_check", {
      panel: label,
      status: "error",
      message: String((error as Error)?.message || error).slice(0, 80),
      deferred: 1
    });
  }
}

async function loadSeriesReferences(
  task: CommerceImageTask,
  panel: CommerceImagePanel,
  setId: string,
  modelId: ResolvedCommerceImageModel
): Promise<CommerceImageReferenceInput[]> {
  if (task.kind !== "xiaohongshu_post") return [];
  const index = task.panels.findIndex((item) => item.id === panel.id);
  /* 质检改成后台异步后，锚点画面在后续画面开始时往往还没有质检结论；
   * 只要已经有画面、且质检没有判定重做，就拿它当系列风格参考，保证整组光线色调一致。 */
  const previous = task.panels
    .slice(0, index)
    .filter((item) => item.versions.length > 0 && item.quality?.status !== "needs_regeneration");
  const anchorPanels = [
    ...new Set([previous[0], previous.at(-1)].filter((item): item is CommerceImagePanel => Boolean(item)))
  ];
  const results: CommerceImageReferenceInput[] = [];
  // Keep at least two reference slots for the user's real product.
  const limit = Math.max(0, commerceImageModelRegistry[modelId].maxReferenceImages - 2);
  for (const anchor of anchorPanels.slice(0, Math.min(2, limit))) {
    const version = [...anchor.versions].reverse().find((item) => item.setId === setId);
    if (!version?.storagePath) continue;
    results.push({
      bytes: new Uint8Array(await readFile(version.storagePath)),
      mimeType: version.mimeType,
      name: "series-reference.png"
    });
  }
  return results;
}

async function resolveTaskModel(task: CommerceImageTask): Promise<ResolvedCommerceImageModel> {
  if (task.model !== "auto") {
    const config = await getResolvedProviderConfig(providerForModel(task.model));
    if (!config.apiKey) throw configurationError(task.model);
    return task.model;
  }
  const configured: Array<{
    modelId: ResolvedCommerceImageModel;
    verified: boolean;
  }> = [];
  for (const modelId of preferredModels(task.kind)) {
    const config = await getResolvedProviderConfig(providerForModel(modelId));
    if (config.apiKey) configured.push({ modelId, verified: config.verifiedForCurrentConfig });
  }
  const resolved = configured.find((item) => item.verified) || configured[0];
  if (resolved) return resolved.modelId;
  throw new CommerceImageProviderError({
    code: "PROVIDER_NOT_CONFIGURED",
    category: "configuration",
    message: "尚未配置任何生图模型，请先到系统设置添加 API Key。",
    retryable: false
  });
}

function preferredModels(kind: CommerceImageTaskKind): ResolvedCommerceImageModel[] {
  /* 自动推荐顺序来自 config/model-routing.yaml 的 image_generation（retouch 用 retouch_models）。 */
  const chain = resolveImageModelChain(kind).modelAliasChain
    .map((alias) => findModel(alias).modelId)
    .filter((modelId) => Boolean(commerceImageModelRegistry[modelId as ResolvedCommerceImageModel]));
  return chain as ResolvedCommerceImageModel[];
}

function prioritizeReferences(task: CommerceImageTask, panel: CommerceImagePanel) {
  const segmentAssetId = task.referenceAnalysis.segments.find(
    (segment) => segment.id === panel.referenceSegmentId
  )?.assetId;
  const priority = [
    "front",
    "side",
    "back",
    "detail",
    "package",
    "logo",
    "on_body",
    "skill_reference",
    "style_reference",
    "other"
  ];
  /* 用户在产品资产里手动勾选的图片顺序优先：
   * 「用户明确指定 > 系统自动推荐」，不会再往前面塞其它图片。 */
  const selection = task.productImageSelection;
  const manualIndex = new Map(
    (selection?.mode === "selected" ? selection.attachedAssetIds : []).map((id, index) => [id, index])
  );
  return [...task.sourceAssets]
    .filter(
      (asset) =>
        (asset.role !== "benchmark_reference" && asset.role !== "reference_segment") || asset.id === segmentAssetId
    )
    .sort((a, b) => {
      if (a.id === segmentAssetId) return -1;
      if (b.id === segmentAssetId) return 1;
      const aManual = manualIndex.has(a.id) ? manualIndex.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bManual = manualIndex.has(b.id) ? manualIndex.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (aManual !== bManual) return aManual - bManual;
      return priority.indexOf(a.role) - priority.indexOf(b.role);
    });
}

/* 并发生成时多个画面会同时完成。每个画面完成都要重写整份 task.json，
 * 如果各自基于自己那份旧快照写回，就会互相覆盖、丢画面。
 * 这里用一把按 taskId 的串行锁：排队 → 重新读盘 → 只改自己那一格 → 写回。 */
const taskWriteChains = new Map<string, Promise<unknown>>();

function withCommerceImageTaskLock<T>(taskId: string, work: () => Promise<T>): Promise<T> {
  const previous = taskWriteChains.get(taskId) || Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.then(
    () => undefined,
    () => undefined
  );
  taskWriteChains.set(taskId, settled);
  void settled.then(() => {
    if (taskWriteChains.get(taskId) === settled) taskWriteChains.delete(taskId);
  });
  return next;
}

async function mutateCommerceImagePanel(
  taskId: string,
  panelId: string,
  mutate: (panel: CommerceImagePanel, task: CommerceImageTask) => Partial<CommerceImagePanel>,
  progress: (task: CommerceImageTask) => NonNullable<CommerceImageTask["progress"]>
) {
  return withCommerceImageTaskLock(taskId, async () => {
    const fresh = await getCommerceImageTask(taskId);
    if (!fresh) throw new Error("生图任务不存在。");
    return saveCommerceImageTask({
      ...fresh,
      status: "generating",
      panels: fresh.panels.map((panel) =>
        panel.id === panelId ? { ...panel, ...mutate(panel, fresh), id: panel.id } : panel
      ),
      progress: progress(fresh)
    });
  });
}

/** 受控并发：同时最多 limit 个画面在跑，stop() 为真时不再领取新任务。 */
async function runJobsWithConcurrency<T>(
  jobs: T[],
  limit: number,
  worker: (job: T) => Promise<void>,
  stop: () => boolean
) {
  const queue = [...jobs];
  const lanes = Math.max(1, Math.min(limit, queue.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (!stop()) {
        const job = queue.shift();
        if (job === undefined) return;
        await worker(job);
      }
    })
  );
}

/* 旧任务（营销引擎早期版本）没有这两层，给一个不误判的降级结构。 */
function fallbackFidelity(): MarketingProductFidelityPlan {
  return {
    version: "0",
    criticalFeatures: [],
    mustPreserve: ["商品与参考图保持一致"],
    mustNotInvent: [],
    logoRules: [],
    textOnProductRules: [],
    colorRules: [],
    shapeRules: [],
    hardConstraints: ["商品必须与用户参考图保持一致"],
    confidence: "derived"
  };
}

function fallbackTypography(record: NonNullable<CommerceImageTask["marketing"]>): MarketingTypographyPlan {
  return {
    version: "0",
    template: "detail_benefit",
    textMode: "model",
    textRequired: record.intent.textRequired,
    layers: [],
    plannedText: [],
    warnings: ["旧任务没有排版方案"]
  };
}

/** 出图后的营销质检。失败只记录，绝不影响已生成图片与任务状态。 */
async function applyMarketingQa(task: CommerceImageTask, signal?: AbortSignal): Promise<CommerceImageTask> {
  const record = task.marketing;
  if (!record?.creativePlan?.panels?.length) return task;
  const panel = task.panels.find((item) => item.versions.length > 0);
  if (!panel) return task;
  const version =
    panel.versions.find((item) => item.setId === task.selectedSetId) || panel.versions[panel.versions.length - 1];
  if (!version?.storagePath) return task;
  try {
    const index = Math.max(
      0,
      task.panels.findIndex((item) => item.id === panel.id)
    );
    const creativePanel = record.creativePlan.panels[Math.min(index, record.creativePlan.panels.length - 1)];
    const overlay = record.typography?.textMode === "overlay";
    const hasPanelQuality = Boolean(panel.quality && typeof panel.quality.productFidelity === "boolean");
    /* 质检看「干净底图」：程序排版模式下，画面里任何文字都只可能是模型自己生成的，
     * 必须当成底图污染抓出来；商品保真与通用图也在这张底图上判断。
     * 既有画面质检已覆盖时不再多花一次视觉调用。 */
    const useVision = !hasPanelQuality;
    const bytes = useVision ? new Uint8Array(await readFile(version.storagePath)) : undefined;
    const qa = await runMarketingQa({
      source: {
        productTruth: record.productTruth,
        intent: record.intent,
        strategy: record.strategy,
        creativePlan: record.creativePlan,
        productFidelity: record.productFidelity || fallbackFidelity(),
        typography: record.typography || fallbackTypography(record)
      },
      panel: creativePanel,
      bytes,
      mimeType: version.mimeType,
      panelQuality: panel.quality,
      baseImage: overlay,
      vision: useVision ? createMarketingVisionChecker() : undefined,
      signal
    });
    const imageGeneration = task.panels.some((item) => item.versions.length > 0);
    const marketingTask = qa.status === "PASS";
    const warnings =
      qa.status === "PASS"
        ? task.warnings
        : [...new Set([...task.warnings, "营销质检（" + qa.status + "）：" + qa.summary])];
    const saved = await saveCommerceImageTask({
      ...task,
      warnings,
      marketing: { ...record, qa, success: { imageGeneration, marketingTask } }
    });
    /* 质检结论回填到本次任务的所有创意记录。 */
    void syncTaskCreatives(task.id, qa, marketingTask).catch(() => undefined);
    return saved;
  } catch (error) {
    trace("marketing_qa", { failed: 1, reason: error instanceof Error ? error.message.slice(0, 140) : "unknown" });
    return task;
  }
}

function finalizeGenerationSets(
  task: CommerceImageTask,
  targetSetIds: string[],
  fatalError?: CommerceImageStructuredError
) {
  const target = new Set(targetSetIds);
  return task.generationSets.map((set) => {
    if (!target.has(set.id)) return set;
    const completed = task.panels.filter((panel) => panel.versions.some((version) => version.setId === set.id)).length;
    const status: CommerceImageGenerationSet["status"] =
      completed === task.panels.length ? "completed" : completed > 0 ? "partial" : fatalError ? "failed" : "draft";
    return { ...set, status };
  });
}

function createGenerationSets(count: 1 | 2 | 4): CommerceImageGenerationSet[] {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, index) => ({
    id: `commerce_image_set_${randomUUID()}`,
    index,
    label: `方案 ${String.fromCharCode(65 + index)}`,
    status: "draft",
    createdAt: now
  }));
}

function latestVersionForSet(panel: CommerceImagePanel, setId: string) {
  return [...panel.versions].reverse().find((version) => version.setId === setId);
}

function setHasAnyVersion(task: CommerceImageTask, setId: string) {
  return task.panels.some((panel) => panel.versions.some((version) => version.setId === setId));
}

function isProductReference(role: string) {
  return !["benchmark_reference", "reference_segment", "style_reference", "skill_reference"].includes(role);
}

function structuredError(error: unknown, modelId?: ResolvedCommerceImageModel): CommerceImageStructuredError {
  if (error instanceof CommerceImageProviderError) return error.detail;
  const message = error instanceof Error ? error.message : "图片生成失败。";
  const timeout = /timeout|timed out|超时/i.test(message);
  return {
    code: timeout ? "REQUEST_TIMEOUT" : "GENERATION_FAILED",
    category: "unknown",
    message: timeout ? "模型请求超时。该请求可能已经计费，系统不会自动重复请求；请先检查服务商任务记录。" : message,
    retryable: false,
    provider: modelId ? providerForModel(modelId) : undefined
  };
}

function configurationError(modelId: ResolvedCommerceImageModel) {
  return new CommerceImageProviderError({
    code: "PROVIDER_NOT_CONFIGURED",
    category: "configuration",
    message: `${commerceImageModelRegistry[modelId].label}尚未配置 API Key，请先到系统设置完成配置。`,
    retryable: false,
    provider: providerForModel(modelId)
  });
}

function isFatalError(error: CommerceImageStructuredError) {
  return ["configuration", "authorization", "model_access", "quota", "validation"].includes(error.category);
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /abort|取消/i.test(error.message));
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("已取消", "AbortError"));
      },
      { once: true }
    );
  });
}

async function markRunnerFailure(taskId: string, error: unknown) {
  const task = await getCommerceImageTask(taskId);
  if (!task || task.status === "completed" || task.status === "partial" || task.status === "cancelled") return;
  const detail = structuredError(error, task.resolvedModelId || undefined);
  await saveCommerceImageTask({
    ...task,
    status: task.panels.some((panel) => panel.versions.length) ? "partial" : "failed",
    error: detail.message,
    lastError: detail,
    generationSets: task.generationSets.map((set) =>
      set.status === "generating"
        ? {
            ...set,
            status: setHasAnyVersion(task, set.id) ? "partial" : "failed"
          }
        : set
    ),
    panels: task.panels.map((panel) =>
      panel.status === "queued" || panel.status === "generating"
        ? {
            ...panel,
            status: panel.versions.length ? "completed" : "failed",
            error: detail.message
          }
        : panel
    ),
    progress: {
      completed: task.panels.filter((panel) => panel.versions.length).length,
      total: task.panels.length * Math.max(1, task.generationSets.length),
      currentPanelId: "",
      message: detail.message,
      updatedAt: new Date().toISOString()
    }
  });
}
