import { randomUUID } from "node:crypto";
import { providerForModel } from "@/lib/commerce-image-config";
import type { CommerceImagePanel, CommerceImageTask, CommerceImageVersion } from "@/lib/commerce-image-types";
import { buildTypographyPlan } from "@/marketing/engine/typography";
import type { MarketingQaResult } from "@/marketing/engine/types";
import type {
  CreativeRecord,
  LearningAssetRef
} from "@/lib/marketing-learning/types";
import { trace } from "@/lib/perf-trace";
import { marketingLearningStore } from "@/lib/marketing-learning/store";

/**
 * 营销学习闭环 · 创意记录服务
 *
 * 营销引擎负责「怎么生成」；这里负责「把它是怎么生成的完整记下来」。
 * 每张最终图片（每个 version）一个 creativeId，绝不拿批次 ID 当 creativeId。
 */

const PRODUCT_ROLES_EXCLUDED = ["benchmark_reference", "reference_segment", "style_reference", "skill_reference"];

/** 为新生成的最终图片建立（或更新）CreativeRecord。 */
export async function recordCreativeForVersion(options: {
  task: CommerceImageTask;
  panel: CommerceImagePanel;
  version: CommerceImageVersion;
  setId: string;
}): Promise<CreativeRecord | null> {
  const record = buildCreativeRecord(options);
  if (!record) return null;
  const existing = await marketingLearningStore.findCreativeByVersion(options.task.id, options.version.id);
  if (existing) {
    return marketingLearningStore.updateCreative(existing.creativeId, { ...record, creativeId: existing.creativeId, createdAt: existing.createdAt });
  }
  return marketingLearningStore.saveCreative(record);
}

export function buildCreativeRecord(options: {
  task: CommerceImageTask;
  panel: CommerceImagePanel;
  version: CommerceImageVersion;
  setId: string;
}): CreativeRecord | null {
  const { task, panel, version, setId } = options;
  const marketing = task.marketing;
  if (!marketing) {
    /* 直连模式没有营销链路，仍然记录创意，方便以后和营销模式一起比较。 */
    const productAssets: LearningAssetRef[] = task.sourceAssets
      .filter((asset) => !PRODUCT_ROLES_EXCLUDED.includes(asset.role))
      .map((asset) => ({ id: asset.id, role: asset.role, name: asset.name, url: assetUrl(task.id, asset.id) }));
    const referenceAssets: LearningAssetRef[] = task.sourceAssets
      .filter((asset) => PRODUCT_ROLES_EXCLUDED.includes(asset.role))
      .map((asset) => ({ id: asset.id, role: asset.role, name: asset.name, url: assetUrl(task.id, asset.id) }));
    const platform = kindToPlatform(task.kind);
    const now = new Date().toISOString();
    return {
      creativeId: "creative_" + randomUUID(),
      createdAt: now,
      updatedAt: now,
      sourceType: "own_generated",
      taskId: task.id,
      panelId: panel.id,
      versionId: version.id,
      setId,
      productId: task.productId || "",
      productName: task.productName || "",
      category: task.productAssetSnapshot?.category || task.productSnapshot?.category || "",
      platform,
      businessGoal: "direct",
      userRequest: task.brief.extra || "",
      consumerInsight: "",
      marketingStrategy: "直连模式",
      strategyKey: "direct",
      strategyVersion: "direct",
      skillsUsed: task.strategySnapshot ? [task.strategySnapshot.name] : [],
      primaryPainPoint: "",
      primarySellingPoint: "",
      secondarySellingPoints: [],
      headline: panel.overlay?.title || panel.title || "",
      subheadline: "",
      cta: panel.overlay?.body || "",
      creativePlan: null,
      layoutType: "direct",
      compiledPrompt: version.prompt || panel.prompt || "",
      engineVersion: "direct",
      strategyConfigHash: "",
      productTruthVersion: "direct",
      intentVersion: "direct",
      creativeVersion: "direct",
      promptCompilerVersion: "direct",
      productFidelityVersion: "direct",
      typographyVersion: "direct",
      copyRuleVersion: "direct",
      platformRuleVersion: "direct",
      qaVersion: "direct",
      provider: version.modelId ? providerForModel(version.modelId) : (task.resolvedModelId ? providerForModel(task.resolvedModelId) : ""),
      model: version.providerModelId || task.resolvedModelId || "",
      aspectRatio: task.ratio,
      generationCount: Math.max(1, panel.versions.length + 1),
      sourceProductAssets: productAssets,
      referenceAssets,
      outputImageAssetId: version.assetId,
      outputImagePath: version.storagePath || "",
      outputImageUrl: assetUrl(task.id, version.assetId),
      generationStatus: panel.status,
      qaResult: null,
      marketingTaskSuccess: null,
      tags: unique(["direct", platform, task.productName, "直连模式"]).slice(0, 12),
      accountBaseline: null,
      productTruth: null,
      intent: null,
      productFidelity: null,
      typography: null
    };
  }
  const index = Math.max(0, task.panels.findIndex((item) => item.id === panel.id));
  const creativePanel = marketing.creativePlan?.panels?.[Math.min(index, marketing.creativePlan.panels.length - 1)] || null;
  const typographyPlan = buildTypographyPlan({
    creativePlan: marketing.creativePlan,
    strategyId: marketing.strategy.id,
    intent: marketing.intent,
    panelIndex: index
  });
  const versions = marketing.versions;
  const productAssets: LearningAssetRef[] = task.sourceAssets
    .filter((asset) => !PRODUCT_ROLES_EXCLUDED.includes(asset.role))
    .map((asset) => ({ id: asset.id, role: asset.role, name: asset.name, url: assetUrl(task.id, asset.id) }));
  const referenceAssets: LearningAssetRef[] = task.sourceAssets
    .filter((asset) => PRODUCT_ROLES_EXCLUDED.includes(asset.role))
    .map((asset) => ({ id: asset.id, role: asset.role, name: asset.name, url: assetUrl(task.id, asset.id) }));

  const headline = creativePanel?.headline || "";
  const sellingPoints = creativePanel?.sellingPointLabels || [];
  const tags = unique([
    marketing.strategy.id,
    marketing.intent.platform,
    task.productName,
    marketing.strategy.primarySellingPoint,
    typographyPlan.template,
    ...(marketing.productTruth?.materials || []).slice(0, 2),
    ...sellingPoints.slice(0, 2)
  ]).slice(0, 12);

  const now = new Date().toISOString();
  return {
    creativeId: "creative_" + randomUUID(),
    createdAt: now,
    updatedAt: now,
    sourceType: "own_generated",
    taskId: task.id,
    panelId: panel.id,
    versionId: version.id,
    setId,
    productId: task.productId || "",
    productName: task.productName || "",
    category: task.productAssetSnapshot?.category || task.productSnapshot?.category || "",
    platform: marketing.intent.platform,
    businessGoal: marketing.intent.businessGoal,
    userRequest: task.brief.extra || "",
    consumerInsight: marketing.strategy.primaryPainPoint || "",
    marketingStrategy: marketing.strategy.label,
    strategyKey: marketing.strategy.id,
    strategyVersion: marketing.strategy.version,
    skillsUsed: task.strategySnapshot ? [task.strategySnapshot.name] : [],
    primaryPainPoint: marketing.strategy.primaryPainPoint,
    primarySellingPoint: marketing.strategy.primarySellingPoint,
    secondarySellingPoints: marketing.strategy.secondarySellingPoints || [],
    headline,
    subheadline: creativePanel?.subheadline || "",
    cta: creativePanel?.cta || "",
    creativePlan: marketing.creativePlan || null,
    layoutType: typographyPlan.template,
    compiledPrompt: version.prompt || marketing.promptPreview || "",
    engineVersion: versions.engine,
    strategyConfigHash: versions.strategyConfigHash,
    productTruthVersion: versions.productTruth,
    intentVersion: versions.intent,
    creativeVersion: versions.creative,
    promptCompilerVersion: versions.promptCompiler,
    productFidelityVersion: versions.productFidelity,
    typographyVersion: versions.typography,
    copyRuleVersion: versions.copy,
    platformRuleVersion: versions.platform,
    qaVersion: versions.qa,
    provider: version.modelId ? providerForModel(version.modelId) : (task.resolvedModelId ? providerForModel(task.resolvedModelId) : ""),
    model: version.providerModelId || task.resolvedModelId || "",
    aspectRatio: task.ratio,
    /* runJob 在写入新版本之前调用本函数，所以用 +1 表示包含这张。 */
    generationCount: Math.max(1, panel.versions.length + 1),
    sourceProductAssets: productAssets,
    referenceAssets,
    outputImageAssetId: version.assetId,
    outputImagePath: version.storagePath || "",
    outputImageUrl: assetUrl(task.id, version.assetId),
    generationStatus: panel.status,
    qaResult: marketing.qa || null,
    marketingTaskSuccess: marketing.qa?.marketingTaskSuccess ?? marketing.success?.marketingTask ?? null,
    tags,
    accountBaseline: null,
    productTruth: marketing.productTruth || null,
    intent: marketing.intent || null,
    productFidelity: marketing.productFidelity || null,
    typography: marketing.typography || null
  };
}

/**
 * 任务级质检完成后，回填该任务所有 creative 的质检结论与营销成功标记。
 * 质检结果显式传入，避免「重新读任务时被后台质检的旧快照覆盖」的竞态。
 */
export async function syncTaskCreatives(taskId: string, qa: MarketingQaResult | null, marketingTaskSuccess: boolean | null) {
  const creatives = await marketingLearningStore.queryCreatives({ taskId });
  trace("learning_sync", { taskId: taskId.slice(-12), creatives: creatives.length, qa: qa?.status || "none" });
  await Promise.all(creatives.map((creative) => marketingLearningStore.updateCreative(creative.creativeId, {
    qaResult: qa,
    marketingTaskSuccess,
    updatedAt: new Date().toISOString()
  })));
}

function kindToPlatform(kind: CommerceImageTask["kind"]) {
  if (kind === "xiaohongshu_post") return "xiaohongshu";
  if (kind === "douyin_post") return "douyin";
  if (kind === "detail_page") return "ecommerce-detail";
  if (kind === "retouch") return "retouch";
  return "generic";
}

function assetUrl(taskId: string, assetId: string) {
  return "/api/commerce-image/assets?taskId=" + encodeURIComponent(taskId) + "&assetId=" + encodeURIComponent(assetId);
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}
