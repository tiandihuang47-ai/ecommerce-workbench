import { imageRegistryKeyForAlias } from "@/lib/commerce-image-config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildLogoTextBlock, CLEAN_BASE_IMAGE_RULE, sanitizeCommerceImageGeneratorPrompt } from "@/lib/commerce-image-marketing";
import { commerceImageModelRegistry, resolveCommerceImageSize } from "@/lib/commerce-image-models";
import { resolveImageModelChain } from "@/lib/model-router";
import {
  generateCommerceImage,
  isTransientCommerceImageError,
  TRANSIENT_RETRY_DELAYS_MS,
  type CommerceImageReferenceInput
} from "@/lib/commerce-image-provider";
import { readImageMetadata } from "@/lib/commerce-image-file";
import {
  getCommerceImageTask,
  persistCommerceImageVersion,
  readCommerceImageAssetBytes,
  saveCommerceImageTask
} from "@/lib/commerce-image-store";
import type {
  CommerceImagePanel,
  CommerceImageTask,
  CommerceImageTextLayer,
  ResolvedCommerceImageModel
} from "@/lib/commerce-image-types";
import type {
  CommerceArtifactRevision,
  CommerceCompositionLayer,
  CommerceCreativePanel,
  CommerceCreativePlan
} from "@/lib/commerce-image-v4-types";
import {
  renderCompositionTextOverlay,
  renderCompositionShapeOverlay,
  getMissingGlyphs
} from "@/lib/commerce-image-v4-render";

/* ---------------------------------------------------------------------------
 * V4 execution runner: generates images from the latest plan, composites
 * text and shapes on top, and creates artifact revisions with complete
 * composition snapshots. Supports text-only revisions without image API calls.
 * ------------------------------------------------------------------------- */

type V4RunnerEntry = { controller: AbortController; promise: Promise<void> };
const globalRunnerState = globalThis as typeof globalThis & {
  __commerceImageV4Runners?: Map<string, V4RunnerEntry>;
};
const v4Runners = globalRunnerState.__commerceImageV4Runners || new Map<string, V4RunnerEntry>();
globalRunnerState.__commerceImageV4Runners = v4Runners;

export function isV4Running(taskId: string) { return v4Runners.has(taskId); }

export function cancelV4Run(taskId: string) {
  const runner = v4Runners.get(taskId);
  if (!runner) return false;
  runner.controller.abort();
  return true;
}

export function startV4Generation(taskId: string, options: {
  runId?: string;
  targetPanelIds?: string[];
} = {}) {
  if (v4Runners.has(taskId)) return false;
  const controller = new AbortController();
  const promise = executeV4Generation(taskId, controller.signal, options)
    .catch(() => {})
    .finally(() => v4Runners.delete(taskId));
  v4Runners.set(taskId, { controller, promise });
  return true;
}

function resolveModel(task: CommerceImageTask): ResolvedCommerceImageModel {
  if (task.model !== "auto" && commerceImageModelRegistry[task.model as ResolvedCommerceImageModel]) return task.model as ResolvedCommerceImageModel;
  /* 用户没手选模型时，用 config/model-routing.yaml 的 image_generation 默认链。 */
  const fromRoute = resolveImageModelChain(task.kind).modelAliasChain
    .map(imageRegistryKeyForAlias)
    .find((modelId) => Boolean(commerceImageModelRegistry[modelId as ResolvedCommerceImageModel]));
  if (fromRoute) return fromRoute as ResolvedCommerceImageModel;
  throw new Error("没有可用的图片生成模型，请在设置中选择生图 API。");
}

function compileV4PanelPrompt(
  task: CommerceImageTask,
  plan: CommerceCreativePlan,
  panel: CommerceCreativePanel,
  hasTextLayers: boolean
): string {
  const parts: string[] = [];
  const productAssets = task.sourceAssets.filter((a) => !["style_reference", "skill_reference", "benchmark_reference", "reference_segment"].includes(a.role));
  /* 商品一致性优先于一切：放在最前面，权重高于视觉方向与营销要求。 */
  parts.push(productAssets.length
    ? [
      "【最高优先级 · 商品一致性】",
      "画面中的商品必须与用户上传的商品参考图完全一致：颜色与色相、版型、肩线与长度、连帽或立领结构、绗缝走向、袖口、口袋、拉链与五金、胸前标识的文字与图形、袖章、印花内容与位置，一律照参考图原样呈现。",
      "不得改变、简化、美化、替换或重新设计商品；不得凭空新增或删除结构、图案、五金与标识；不得为配合场景色调而降低商品颜色的饱和度、亮度或改变色相。",
      "场景、风格、光线、构图与营销诉求一律不得成为改变商品的理由；冲突时以商品参考图为准。"
    ].join("\n")
    : "没有商品参考图；不得虚构商品结构、功效、检测数据、价格、销量、品牌标识或认证。");
  parts.push(CLEAN_BASE_IMAGE_RULE);
  parts.push(`整组视觉方向：${plan.visualDirection.description}`);
  if (plan.visualDirection.palette.length) parts.push(`色板（仅用于场景氛围与文字排版）：${plan.visualDirection.palette.join("、")}`);
  parts.push(`本页目的：${panel.purpose}`);
  const logoTextBlock = buildLogoTextBlock(task);
  if (logoTextBlock) parts.push(logoTextBlock);
  if (panel.sellingPoint?.label) {
    parts.push([
      "【本张转化任务】",
      `这张画面要卖的是「${panel.sellingPoint.label}」。`,
      panel.sellingPoint.painPoint ? `痛点/动机：${panel.sellingPoint.painPoint}。` : "",
      panel.sellingPoint.evidence ? `画面必须真实拍到：${panel.sellingPoint.evidence}。` : "",
      "画面证据只能来自商品参考图与产品事实，不得编造价格、销量、认证、功效或检测报告。"
    ].filter(Boolean).join("\n"));
  }
  parts.push(`画面要求：${panel.visualBrief}`);
  if (panel.relationToPrevious) parts.push(`与前页关系：${panel.relationToPrevious}`);
  for (const rule of plan.visualDirection.continuityRules) parts.push(`系列规则：${rule}`);
  for (const constraint of plan.intent.explicitConstraints) parts.push(`必须遵守：${constraint}`);
  if (plan.intent.assumptions.length) parts.push(`合理推测（不写入商品声明）：${plan.intent.assumptions.join("；")}`);
  if (hasTextLayers) parts.push("文字将由系统在后期排版，底图不要包含任何文字或类似文字的纹理。");
  else parts.push("本页不需要文字层；底图也不要生成文字。");
  parts.push("人物与场景以用户需求和参考图为准：参考图中已有人物穿着该商品时，可按用户需求延续同一人物的身形、发型、穿着方式与所在场景；用户没有要求人物时不要额外添加无关人物。");
  parts.push(`输出比例：${plan.intent.ratio}。`);
  return sanitizeCommerceImageGeneratorPrompt(parts.join("\n"));
}

/** Convert V4 composition text layers to CommerceImageTextLayer for panel sync. */
function compositionTextToPanel(layer: Record<string, unknown>): CommerceImageTextLayer {
  return {
    id: String(layer.id || `commerce_image_text_${randomUUID()}`),
    name: "V4 文字",
    text: String(layer.text || ""),
    x: Number(layer.x || 0),
    y: Number(layer.y || 0),
    width: Number(layer.width || 0.5),
    height: Number(layer.height || 0.1),
    fontFamily: (["sans", "serif", "rounded"].includes(String(layer.fontFamily)) ? layer.fontFamily : "sans") as CommerceImageTextLayer["fontFamily"],
    fontSize: Number(layer.fontSize || 0.05),
    fontWeight: ([400, 500, 600, 700, 800, 900].includes(Number(layer.fontWeight)) ? Number(layer.fontWeight) : 700) as CommerceImageTextLayer["fontWeight"],
    lineHeight: Number(layer.lineHeight || 1.3),
    color: String(layer.color || "#ffffff"),
    backgroundColor: String(layer.backgroundColor || "#000000"),
    backgroundOpacity: Number(layer.backgroundOpacity || 0),
    align: (["left", "center", "right"].includes(String(layer.align)) ? layer.align : "left") as CommerceImageTextLayer["align"],
    visible: layer.visible !== false,
    locked: layer.locked === true
  };
}

/** Sync a V4 plan panel to the legacy panel format so existing rendering/export works. */
function syncV4PanelToTask(
  task: CommerceImageTask,
  ratio: CommerceImageTask["ratio"],
  panel: CommerceCreativePanel,
  versionAssetId: string,
  versionId: string,
  versionWidth: number,
  versionHeight: number,
  modelId: ResolvedCommerceImageModel,
  prompt: string,
  planId: string
): CommerceImagePanel {
  const textLayers = panel.composition.layers
    .filter((l) => l.type === "text" && l.visible !== false)
    .map((l) => compositionTextToPanel(l as unknown as Record<string, unknown>));
  return {
    id: panel.id,
    kind: "visual",
    title: panel.purpose.slice(0, 80),
    description: panel.visualBrief.slice(0, 2000),
    prompt,
    ratio,
    order: panel.order,
    status: "completed",
    error: "",
    overlay: { visible: false, title: "", body: "", textColor: "#ffffff", accentColor: "#7c3aed", position: "top", align: "left" },
    layoutGuide: { safeZones: [], source: "planned", checkedAt: new Date().toISOString() },
    quality: undefined,
    textLayers,
    imageFit: "cover" as const,
    versions: [{
      id: versionId,
      assetId: versionAssetId,
      modelId,
      providerModelId: modelId,
      width: versionWidth,
      height: versionHeight,
      mimeType: "image/png",
      prompt,
      setId: planId,
      createdAt: new Date().toISOString()
    }],
    selectedVersionId: versionId
  };
}

async function executeV4Generation(taskId: string, signal: AbortSignal, options: { runId?: string; targetPanelIds?: string[] }) {
  let task = await getCommerceImageTask(taskId);
  if (!task?.creative) throw new Error("V4 项目不存在或未初始化。");
  const creative = { ...task.creative };
  const plan = creative.plans.find((p) => p.id === creative.activePlanId) || creative.plans[creative.plans.length - 1];
  if (!plan) throw new Error("没有可执行的创作方案。");
  const run = creative.runs.find((r) => r.id === options.runId) || creative.runs[creative.runs.length - 1];
  if (!run) throw new Error("没有执行记录。");
  if (run.status === "completed") return;

  const model = resolveModel(task);
  const ratio = plan.intent.ratio;
  const size = resolveCommerceImageSize(ratio);
  const targetIds = options.targetPanelIds?.length
    ? plan.panels.filter((p) => options.targetPanelIds!.includes(p.id))
    : plan.panels;

  // Update run to running
  creative.runs = creative.runs.map((r) => r.id === run.id
    ? { ...r, status: "running" as const, phase: "generating" as const, updatedAt: new Date().toISOString() }
    : r);
  task = await saveCommerceImageTask({ ...task, creative, status: "generating" });

  const completedPanels: string[] = [];
  const errors: string[] = [];
  const newArtifactIds: string[] = [];

  // Load existing panels (by stable ID) - preserve panels not in this plan
  const existingPanelMap = new Map(task.panels.map((p) => [p.id, p]));
  const updatedPanels = new Map<string, CommerceImagePanel>();

  for (const panel of targetIds) {
    if (signal.aborted) break;
    // Restart recovery: skip already-completed panels
    if (run.completedPanelIds.includes(panel.id)) { completedPanels.push(panel.id); continue; }

    // Check if this is a text-only revision (has existing image for same panel + plan)
    const existingPanel = existingPanelMap.get(panel.id);
    const existingVersion = existingPanel?.versions.find((v) => v.setId === plan.id);
    const hasTextLayers = panel.composition.layers.some((l) => l.type === "text" && l.visible !== false);

    let versionAssetId = "";
    let versionId = "";
    let versionWidth = size.width;
    let versionHeight = size.height;
    let prompt = "";

    if (existingVersion) {
      // Text-only revision: reuse existing image, don't call image API
      versionAssetId = existingVersion.assetId;
      versionId = existingVersion.id;
      versionWidth = existingVersion.width;
      versionHeight = existingVersion.height;
      prompt = existingVersion.prompt;
      completedPanels.push(panel.id);
    } else {
      // Need to generate new image
      prompt = compileV4PanelPrompt(task, plan, panel, hasTextLayers);
      const refs: CommerceImageReferenceInput[] = [];
      for (const asset of task.sourceAssets.filter((a) => !["style_reference", "skill_reference", "benchmark_reference", "reference_segment"].includes(a.role)).slice(0, 3)) {
        if (!asset.storagePath) continue;
        try {
          const bytes = await readFile(asset.storagePath);
          refs.push({ bytes: new Uint8Array(bytes), mimeType: asset.mimeType, name: asset.name });
        } catch { continue; }
      }

      let success = false;
      let lastError = "";
      for (let attempt = 1; attempt <= 4 && !success && !signal.aborted; attempt++) {
        try {
          const result = await generateCommerceImage({ modelId: model, prompt, size, quality: task.quality, references: refs, signal });
          const meta = readImageMetadata(result.bytes);
          if (model !== "gpt-image-2.5") {
            // Strict dimension check only for first-party models that support size
            if (meta.width !== size.width || meta.height !== size.height) {
              if (attempt === 1) continue;
              lastError = `返回尺寸 ${meta.width}×${meta.height} 与预期 ${size.width}×${size.height} 不符。`;
              break;
            }
          }
          // For gpt-image-2.5 (third-party proxy): accept any returned size
          const version = await persistCommerceImageVersion({
            taskId,
            panelId: panel.id,
            bytes: result.bytes,
            modelId: model,
            providerModelId: result.providerModelId || "",
            prompt,
            setId: plan.id
          });
          versionAssetId = version.assetId;
          versionId = version.id;
          versionWidth = version.width;
          versionHeight = version.height;
          success = true;
        } catch (error) {
          if (signal.aborted) break;
          lastError = error instanceof Error ? error.message : String(error);
          // 中转站上游偶发 500/429：按 2s/8s/20s 退避重试；不可重试的错误立即放弃。
          if (isTransientCommerceImageError(error) && attempt < 4) {
            await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS_MS[attempt - 1]));
            continue;
          }
          break;
        }
      }
      if (!success) {
        errors.push(`画面 ${panel.order + 1}：${lastError}`);
        continue;
      }
      completedPanels.push(panel.id);
    }

    // Create artifact revision with complete composition snapshot
    const artifactId = `commerce_image_v4_artifact_${randomUUID().slice(0, 12)}`;
    const artifact: CommerceArtifactRevision = {
      id: artifactId,
      panelId: panel.id,
      planRevision: plan.revision,
      sourceMessageIds: plan.sourceMessageIds,
      imageVersionIds: [versionId],
      composition: structuredClone(panel.composition),
      qualityReportId: "",
      createdAt: new Date().toISOString(),
      textSnapshotSource: "authored"
    };
    newArtifactIds.push(artifactId);

    // Sync to legacy panel format for rendering/export
    updatedPanels.set(panel.id, syncV4PanelToTask(
      task, plan.intent.ratio, panel, versionAssetId, versionId, versionWidth, versionHeight, model, prompt, plan.id
    ));
  }

  // Merge updated panels back (preserve order and panels not touched)
  const allPanelIds = new Set([...updatedPanels.keys()]);
  const finalPanels = [...task.panels];
  for (const panel of targetIds) {
    const updated = updatedPanels.get(panel.id);
    if (!updated) continue;
    const index = finalPanels.findIndex((p) => p.id === panel.id);
    if (index >= 0) finalPanels[index] = updated;
    else finalPanels.push(updated);
  }
  finalPanels.sort((a, b) => (a.order || 0) - (b.order || 0));
  // Renumber orders
  finalPanels.forEach((p, i) => { p.order = i; });

  // Update creative state
  const finalCreative = { ...creative };
  const runIndex = finalCreative.runs.findIndex((r) => r.id === run.id);
  if (runIndex >= 0) {
    finalCreative.runs = [...finalCreative.runs];
    finalCreative.runs[runIndex] = {
      ...finalCreative.runs[runIndex],
      status: signal.aborted ? "cancelled" as const : errors.length && errors.length < targetIds.length ? "completed" as const : errors.length ? "failed" as const : "completed" as const,
      phase: "completed" as const,
      completedPanelIds: completedPanels,
      artifactRevisionIds: [...(finalCreative.runs[runIndex].artifactRevisionIds || []), ...newArtifactIds],
      error: errors.join("；"),
      updatedAt: new Date().toISOString()
    };
    finalCreative.activeRunId = null;
    finalCreative.artifacts = [...finalCreative.artifacts, ...newArtifactIds.map((id) => {
      const panel = plan.panels.find((p) => targetIds.some((t) => t.id === p.id));
      const panelId = finalPanels.find((p) => plan.panels.some((pp) => pp.id === p.id))?.id || "";
      return {
        id,
        panelId: panelId || "",
        planRevision: plan.revision,
        sourceMessageIds: plan.sourceMessageIds,
        imageVersionIds: [],
        composition: panel?.composition || { background: "#ffffff", layers: [] },
        qualityReportId: "",
        createdAt: new Date().toISOString(),
        textSnapshotSource: "authored" as const
      };
    })];
  }

  const allDone = errors.length === 0 && completedPanels.length === targetIds.length;
  const hasImages = finalPanels.some((p) => p.versions.length > 0);
  await saveCommerceImageTask({
    ...task,
    panels: finalPanels,
    creative: finalCreative,
    status: signal.aborted ? "cancelled" : errors.length && !allDone ? "partial" : allDone ? "completed" : hasImages ? "partial" : "failed",
    error: errors.join("；"),
    progress: {
      completed: completedPanels.length,
      total: targetIds.length,
      currentPanelId: "",
      message: signal.aborted ? "已停止" : allDone ? "生成完成" : errors.length ? `${completedPanels.length}/${targetIds.length} 完成，${errors.length} 个失败` : "生成完成",
      updatedAt: new Date().toISOString()
    }
  });
}
