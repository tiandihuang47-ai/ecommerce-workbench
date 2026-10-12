"use client";

import type { AIChatContextRef, AIChatContextSource } from "@/lib/ai-chat-types";
import { getAssets } from "@/lib/stores/asset-store";
import { getDeconstructionRecords } from "@/lib/deconstruction-store";
import { getProductRecords, getScriptRecords, getScriptTranscriptRecords, getSimpleReviewRecords } from "@/lib/pipeline-storage";
import type { ProductRecord, ScriptRecord, SimpleDeconstructionRecord, SimpleReviewRecord, SimpleTranscriptRecord } from "@/lib/pipeline-types";

/** 引用上限：只发用户显式点选的资料，禁止把全部资产塞给 AI。 */
export const maxContextRefs = 3;
export const maxContextRefChars = 4000;
export const maxContextRefsTotalChars = 9000;

export const contextSourceOptions: Array<{ value: AIChatContextSource; label: string }> = [
  { value: "product", label: "产品资料" },
  { value: "script", label: "脚本" },
  { value: "transcript", label: "逐字稿" },
  { value: "deconstruction", label: "拆片记录" },
  { value: "review", label: "数据复盘" },
  { value: "asset", label: "资产库" }
];

export function contextSourceLabel(source: AIChatContextSource) {
  if (source === "none") return "不使用引用";
  return contextSourceOptions.find((item) => item.value === source)?.label || "资料";
}

export interface ContextOption {
  value: string;
  label: string;
  hint?: string;
}

/** 列出某个来源下可引用的条目，供选择弹层使用。 */
export function listContextOptions(source: AIChatContextSource, keyword = ""): ContextOption[] {
  const search = keyword.trim().toLowerCase();
  const match = (option: ContextOption) => !search || `${option.label} ${option.hint || ""}`.toLowerCase().includes(search);

  let options: ContextOption[] = [];

  if (source === "product") {
    options = getProductRecords().map((item) => ({
      value: item.id,
      label: item.name || "未命名产品",
      hint: [item.category, item.targetAudience].filter(Boolean).join(" · ")
    }));
  } else if (source === "script") {
    options = getScriptRecords().map((item) => ({
      value: item.id,
      label: item.title || "未命名脚本",
      hint: [item.productName, item.platform].filter(Boolean).join(" · ")
    }));
  } else if (source === "transcript") {
    options = getScriptTranscriptRecords().map((item) => ({
      value: item.id,
      label: item.title || item.link || "未命名逐字稿",
      hint: [item.authorName, item.updatedAt.slice(0, 10)].filter(Boolean).join(" · ")
    }));
  } else if (source === "deconstruction") {
    options = getDeconstructionRecords().map((item) => ({
      value: item.id,
      label: item.sourceTitle || item.rewrittenTitle || item.sourceUrl || "未命名拆片",
      hint: item.platform || ""
    }));
  } else if (source === "review") {
    options = getSimpleReviewRecords().map((item) => ({
      value: item.id,
      label: item.conclusion || item.aiConclusion || "未命名复盘",
      hint: [item.platform || "未标平台", item.performanceLevel || "未评级"].join(" · ")
    }));
  } else if (source === "asset") {
    options = getAssets().map((item) => ({
      value: item.id,
      label: item.title || "未命名资产",
      hint: assetTypeLabel(item.type)
    }));
  }

  return options.filter(match);
}

export function assetTypeLabel(type: string) {
  const labels: Record<string, string> = {
    script: "脚本",
    deconstruction: "拆片",
    image_prompt: "生图提示词",
    image_project: "生图项目",
    ai_chat: "AI 对话",
    comment_insight: "评论洞察",
    review: "复盘",
    product: "产品资料"
  };
  return labels[type] || "内容";
}

/** 把一条引用解析成可发送的正文。找不到资料时 content 为空。 */
export function resolveContextRef(ref: Pick<AIChatContextRef, "source" | "refId">): { label: string; content: string } {
  if (ref.source === "none" || !ref.refId) {
    return { label: "不使用引用", content: "" };
  }

  if (ref.source === "product") {
    const item = getProductRecords().find((record) => record.id === ref.refId);
    return { label: item?.name || "产品资料", content: item ? productSummary(item) : "" };
  }
  if (ref.source === "script") {
    const item = getScriptRecords().find((record) => record.id === ref.refId);
    return { label: item?.title || "脚本", content: item ? scriptSummary(item) : "" };
  }
  if (ref.source === "transcript") {
    const item = getScriptTranscriptRecords().find((record) => record.id === ref.refId);
    return { label: item?.title || "逐字稿", content: item ? transcriptSummary(item) : "" };
  }
  if (ref.source === "deconstruction") {
    const item = getDeconstructionRecords().find((record) => record.id === ref.refId);
    return { label: item?.sourceTitle || item?.rewrittenTitle || "拆片记录", content: item ? deconstructionSummary(item) : "" };
  }
  if (ref.source === "review") {
    const item = getSimpleReviewRecords().find((record) => record.id === ref.refId);
    return { label: item?.conclusion || "数据复盘", content: item ? reviewSummary(item) : "" };
  }
  if (ref.source === "asset") {
    const item = getAssets().find((record) => record.id === ref.refId);
    if (!item) return { label: "资产", content: "" };
    return { label: item.title || "资产", content: assetSummary(item) };
  }

  return { label: "不使用引用", content: "" };
}

/** 兜底：旧版单引用字段 -> 新版引用数组。 */
export function legacyRefToRefs(source?: AIChatContextSource, refId?: string): AIChatContextRef[] {
  if (!source || source === "none" || !refId) return [];
  const { label } = resolveContextRef({ source, refId });
  return [{
    id: `ref_${source}_${refId}`,
    source,
    refId,
    label,
    createdAt: new Date().toISOString()
  }];
}

export function truncateRefContent(content: string) {
  const text = (content || "").trim();
  if (text.length <= maxContextRefChars) return text;
  return `${text.slice(0, maxContextRefChars)}\n…（内容过长已截断）`;
}

function assetSummary(item: ReturnType<typeof getAssets>[number]) {
  return [
    `资产类型：${assetTypeLabel(item.type)}`,
    `标题：${item.title}`,
    item.productName ? `关联产品：${item.productName}` : "",
    item.summary ? `摘要：${item.summary}` : "",
    "正文：",
    item.content
  ].filter(Boolean).join("\n");
}

function productSummary(item: ProductRecord) {
  return [
    `产品名称：${item.name}`,
    `品类：${item.category}`,
    `价格区间：${item.priceRange}`,
    `核心卖点：${item.coreSellingPoints}`,
    `目标人群：${item.targetAudience}`,
    `用户痛点：${item.painPoints}`,
    `用户顾虑：${item.objections}`,
    `竞品对比：${item.competitorComparison}`,
    `买家反馈：${item.buyerFeedback}`,
    `禁忌词：${item.forbiddenWords}`,
    `不能承诺：${item.forbiddenClaims}`
  ].join("\n");
}

function scriptSummary(item: ScriptRecord) {
  return [
    `标题：${item.title}`,
    `产品：${item.productName}`,
    `平台：${item.platform || "未填"}`,
    `内容形式：${item.contentFormat || item.contentType}`,
    `目的：${item.videoGoal}`,
    `开头钩子：${item.hook}`,
    `脚本正文：${item.scriptText}`,
    `画中画建议：${item.overlaySuggestions}`,
    `拍摄提醒：${item.shootingTips}`,
    `复盘表现：${item.performanceLevel || "未复盘"}`
  ].join("\n");
}

function transcriptSummary(item: SimpleTranscriptRecord) {
  return [
    `视频标题：${item.title || "未命名"}`,
    item.authorName ? `作者：${item.authorName}` : "",
    `来源：${item.link || "抖音"}`,
    "逐字稿：",
    item.transcript
  ].filter(Boolean).join("\n");
}

function deconstructionSummary(item: SimpleDeconstructionRecord) {
  return [
    `原视频标题：${item.sourceTitle || item.title}`,
    `平台：${item.platform}`,
    `逐字稿：${item.transcript}`,
    `核心主题：${item.coreTheme}`,
    `开头钩子：${item.hook}`,
    `爆款元素：${item.viralElements}`,
    `可复用结构：${item.reusableStructure}`,
    `仿写标题：${item.rewrittenTitle}`,
    `仿写脚本：${item.rewrittenScript}`
  ].join("\n");
}

function reviewSummary(item: SimpleReviewRecord) {
  return [
    `平台：${item.platform || "未填"}`,
    `播放量：${item.views}`,
    `完播率：${item.completionRate}`,
    `点赞：${item.likeRate}`,
    `评论：${item.commentRate}`,
    `收藏：${item.saveRate}`,
    `转化数据：${item.conversionData}`,
    `表现：${item.performanceLevel || "未评级"}`,
    `问题归因：${item.problemReason}`,
    `复盘结论：${item.aiConclusion || item.conclusion}`,
    `下次优化：${item.nextOptimization}`
  ].join("\n");
}
