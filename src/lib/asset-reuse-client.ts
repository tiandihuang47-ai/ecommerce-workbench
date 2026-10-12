"use client";

import type { ProductReferenceSnapshot, SimpleDeconstructionRecord } from "@/lib/pipeline-types";
import type { ContentAsset, ContentAssetPlatform } from "@/lib/stores/asset-store";
import { storageSet } from "@/lib/web-storage";

export const scriptDraftStorageKey = "director-platform.scriptGeneratorDraft";
export const imagePromptDraftStorageKey = "director-platform.imageGeneratorDraft";
export const deconstructionReuseStorageKey = "director-platform.deconstructionReuseDraft";

export interface AssetReuseResult {
  success: boolean;
  href: string;
  message: string;
}

const scriptPlatforms = ["抖音", "小红书", "快手", "视频号", "淘宝内容", "朋友圈", "私域朋友圈"];
const scriptContentTypes = ["短视频口播", "电商带货", "老板 IP", "小红书图文", "评论回复", "直播切片", "竞品对比", "避坑科普", "产品卖点提炼", "脚本改写", "教知识", "晒过程", "聊观点", "讲故事", "带货转化"];
const scriptContentFormats = ["短视频口播", "电商带货", "小红书种草", "图文笔记", "直播切片", "评论回复", "老板 IP", "达人口播", "竞品对比", "避坑科普"];
const scriptMaterialSources = ["手动输入", "产品资料", "爆款拆解", "评论区"];
const scriptGoals = ["涨粉", "建信任", "引流", "成交", "直播间引流", "复购", "测试选题", "复盘测试"];

export function getAssetReuseLabel(asset: ContentAsset) {
  if (asset.type === "script") return "复用到脚本";
  if (asset.type === "deconstruction") {
    const raw = asRecord(asset.rawData);
    return asString(raw?.replicaTaskId) ? "继续复刻" : "复用到拆片";
  }
  if (asset.type === "image_prompt") return "复用到生图";
  if (asset.type === "image_project") return "继续生图项目";
  return "";
}

export function prepareAssetReuse(asset: ContentAsset): AssetReuseResult {
  if (typeof window === "undefined") {
    return { success: false, href: "", message: "当前环境无法恢复创作草稿。" };
  }

  try {
    if (asset.type === "script") {
      storageSet(scriptDraftStorageKey, JSON.stringify(buildScriptDraft(asset)));
      return {
        success: true,
        href: `/script-generator?reuseAsset=${encodeURIComponent(asset.id)}`,
        message: "已恢复产品资料和脚本创作简报。"
      };
    }

    if (asset.type === "image_prompt") {
      storageSet(imagePromptDraftStorageKey, JSON.stringify(buildImagePromptDraft(asset)));
      return {
        success: true,
        href: `/image-generator?reuseAsset=${encodeURIComponent(asset.id)}`,
        message: "已恢复产品资料和生图创作简报。"
      };
    }

    if (asset.type === "image_project") {
      const raw = asRecord(asset.rawData);
      const taskId = asString(raw?.taskId);
      if (!taskId) return { success: false, href: "", message: "这条生图项目索引缺少任务 ID，暂时无法打开。" };
      return {
        success: true,
        href: `/image-generator?task=${encodeURIComponent(taskId)}`,
        message: "已打开生图项目。"
      };
    }

    if (asset.type === "deconstruction") {
      const raw = asRecord(asset.rawData);
      const replicaTaskId = asString(raw?.replicaTaskId);
      if (replicaTaskId) {
        return {
          success: true,
          href: `/deconstruction?task=${encodeURIComponent(replicaTaskId)}`,
          message: "已打开爆款复刻任务。"
        };
      }
      if (!raw || !asString(raw.id)) {
        return { success: false, href: "", message: "这条旧拆片资产缺少原始记录，暂时无法一键复用。" };
      }
      window.sessionStorage.setItem(deconstructionReuseStorageKey, JSON.stringify(raw));
      return {
        success: true,
        href: `/deconstruction?reuseAsset=${encodeURIComponent(asset.id)}`,
        message: "已恢复原视频分析、产品资料和仿写简报。"
      };
    }
  } catch {
    return { success: false, href: "", message: "复用草稿保存失败，请检查本地存储空间。" };
  }

  return { success: false, href: "", message: "当前资产类型暂不支持一键复用。" };
}

export function consumeDeconstructionReuseDraft(): SimpleDeconstructionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.sessionStorage.getItem(deconstructionReuseStorageKey);
    if (!saved) return null;
    window.sessionStorage.removeItem(deconstructionReuseStorageKey);
    const parsed = JSON.parse(saved) as Partial<SimpleDeconstructionRecord>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") return null;
    return parsed as SimpleDeconstructionRecord;
  } catch {
    window.sessionStorage.removeItem(deconstructionReuseStorageKey);
    return null;
  }
}

export function extractProductSnapshot(rawData: unknown): ProductReferenceSnapshot | undefined {
  const record = asRecord(rawData);
  if (!record) return undefined;
  const form = asRecord(record.form);
  const candidate = record.productSnapshot || form?.productSnapshot;
  const snapshot = asRecord(candidate);
  if (!snapshot || !asString(snapshot.id) || !asString(snapshot.name)) return undefined;
  return snapshot as unknown as ProductReferenceSnapshot;
}

function buildScriptDraft(asset: ContentAsset) {
  const raw = asRecord(asset.rawData) || {};
  const productSnapshot = extractProductSnapshot(asset.rawData);
  const contentType = pickOption(asString(raw.contentType), scriptContentTypes, "短视频口播");
  return {
    productName: asString(raw.productName) || productSnapshot?.name || asset.productName || "",
    productId: asString(raw.productId) || productSnapshot?.id || asset.productId || "",
    productSnapshot,
    platform: pickOption(asString(raw.platform), scriptPlatforms, platformFromAsset(asset.platform)),
    contentFormat: pickOption(asString(raw.contentFormat), scriptContentFormats, contentFormatFromType(contentType)),
    materialSource: pickOption(asString(raw.materialSource), scriptMaterialSources, productSnapshot ? "产品资料" : "手动输入"),
    targetAudience: asString(raw.targetAudience) || productSnapshot?.targetAudience || "",
    painPoint: asString(raw.painPoint) || productSnapshot?.painPoints || "",
    sellingPoint: asString(raw.sellingPoint) || productSnapshot?.coreSellingPoints || "",
    contentType,
    videoGoal: pickOption(asString(raw.videoGoal), scriptGoals, "成交"),
    extra: "基于历史资产继续创作，保留原产品事实与平台方向。",
    duration: "30秒",
    speakingStyle: "真实口语",
    scene: productSnapshot?.useScenarios || "室内口播",
    needShotList: true,
    needOverlay: true,
    needTitle: true,
    needNote: contentType === "小红书图文",
    productForbiddenWords: productSnapshot?.forbiddenWords || "",
    productForbiddenClaims: productSnapshot?.forbiddenClaims || "",
    comments: asString(raw.comments),
    liveTranscript: "",
    originalScript: asString(raw.scriptText),
    rewriteGoal: "更犀利",
    includeRiskCheck: true,
    includeCoverTitle: true
  };
}

function buildImagePromptDraft(asset: ContentAsset) {
  const raw = asRecord(asset.rawData) || {};
  const savedForm = asRecord(raw.form) || {};
  const productSnapshot = extractProductSnapshot(asset.rawData);
  return {
    purpose: asString(savedForm.purpose) || "短视频封面",
    productId: asString(savedForm.productId) || productSnapshot?.id || asset.productId || "",
    productSnapshot,
    product: asString(savedForm.product) || productSnapshot?.name || asset.productName || "",
    audience: asString(savedForm.audience) || productSnapshot?.targetAudience || "",
    sellingPoint: asString(savedForm.sellingPoint) || productSnapshot?.coreSellingPoints || "",
    scene: asString(savedForm.scene) || productSnapshot?.useScenarios || "",
    style: asString(savedForm.style) || "干净高级",
    ratio: asString(savedForm.ratio) || "3:4",
    extra: asString(savedForm.extra)
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function pickOption(value: string, options: string[], fallback: string) {
  return options.includes(value) ? value : fallback;
}

function platformFromAsset(platform: ContentAssetPlatform) {
  if (platform === "xiaohongshu") return "小红书";
  if (platform === "kuaishou") return "快手";
  if (platform === "shipinhao") return "视频号";
  if (platform === "taobao") return "淘宝内容";
  if (platform === "private") return "朋友圈";
  return "抖音";
}

function contentFormatFromType(contentType: string) {
  if (contentType === "小红书图文") return "图文笔记";
  if (contentType === "直播切片") return "直播切片";
  if (contentType === "评论回复") return "评论回复";
  if (contentType === "老板 IP") return "老板 IP";
  if (contentType === "竞品对比") return "竞品对比";
  if (contentType === "避坑科普") return "避坑科普";
  if (contentType === "电商带货" || contentType === "带货转化") return "电商带货";
  return "短视频口播";
}
