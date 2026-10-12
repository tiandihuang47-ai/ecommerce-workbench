import { createId } from "@/lib/shared/id";
import { nowIso } from "@/lib/shared/time";
import type { ContentAsset, ContentAssetPlatform, ContentAssetStatus, ContentAssetType } from "./asset-store";

const legacyKeys = {
  scripts: "director-platform.scriptRecords",
  deconstructions: "director-platform.simpleDeconstructionRecords",
  reviews: "director-platform.simpleReviewRecords",
  products: "director-platform.productRecords",
  commentInsights: "director-platform.commentInsightRecords",
  chatSessions: "director-platform.aiChatSessions",
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJsonArray<T = Record<string, unknown>>(key: string): T[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function maybeDate(value: unknown): string {
  const raw = text(value);
  if (!raw) return nowIso();
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? nowIso() : date.toISOString();
}

function mapPlatform(value: unknown): ContentAssetPlatform {
  const raw = text(value).toLowerCase();
  if (raw.includes("小红书") || raw.includes("xhs") || raw.includes("xiaohongshu")) return "xiaohongshu";
  if (raw.includes("快手") || raw.includes("kuaishou")) return "kuaishou";
  if (raw.includes("视频号") || raw.includes("shipinhao") || raw.includes("wechat")) return "shipinhao";
  if (raw.includes("淘宝") || raw.includes("taobao")) return "taobao";
  if (raw.includes("朋友圈") || raw.includes("私域") || raw.includes("private")) return "private";
  if (raw.includes("抖音") || raw.includes("douyin")) return "douyin";
  return "unknown";
}

function mapStatus(value: unknown, fallback: ContentAssetStatus = "completed"): ContentAssetStatus {
  const raw = text(value).toLowerCase();
  if (raw.includes("草稿") || raw.includes("draft")) return "draft";
  if (raw.includes("失败") || raw.includes("failed") || raw.includes("error")) return "failed";
  if (raw.includes("归档") || raw.includes("archived")) return "archived";
  if (raw.includes("完成") || raw.includes("已确认") || raw.includes("success") || raw.includes("completed")) return "completed";
  return fallback;
}

function buildAsset(input: Partial<ContentAsset> & { type: ContentAssetType; title: string }): ContentAsset {
  const createdAt = input.createdAt || nowIso();
  return {
    id: input.id || createId(`asset_${input.type}`),
    type: input.type,
    title: input.title || "未命名资产",
    summary: input.summary || "",
    content: input.content || "",
    rawData: input.rawData || {},
    sourceModule: input.sourceModule || "manual",
    platform: input.platform || "unknown",
    productId: input.productId || "",
    productName: input.productName || "",
    tags: input.tags || [],
    favorite: Boolean(input.favorite),
    status: input.status || "completed",
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    lastOpenedAt: input.lastOpenedAt || "",
    version: input.version || 1,
    linkedRecordIds: input.linkedRecordIds || [],
  };
}

function scriptsToAssets(): ContentAsset[] {
  return readJsonArray<Record<string, unknown>>(legacyKeys.scripts).map((record) => {
    const id = text(record.id) || createId("script");
    const title = text(record.title) || text(record.topic) || "历史脚本";
    const content = [
      text(record.hook) && `开头钩子：${text(record.hook)}`,
      text(record.scriptText) && `完整脚本：\n${text(record.scriptText)}`,
      text(record.storyboard) && `分镜建议：\n${text(record.storyboard)}`,
      text(record.overlaySuggestions) && `画中画建议：\n${text(record.overlaySuggestions)}`,
      text(record.shootingTips) && `拍摄提醒：\n${text(record.shootingTips)}`,
      text(record.endingCTA) && `结尾引导：${text(record.endingCTA)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return buildAsset({
      id: `asset_script_${id}`,
      type: "script",
      title,
      summary: text(record.hook) || text(record.scriptText).slice(0, 120),
      content,
      rawData: record,
      sourceModule: "script",
      platform: mapPlatform(record.platform),
      productId: text(record.productId),
      productName: text(record.productName) || text(record.product),
      tags: Array.isArray(record.tags) ? record.tags.map(text).filter(Boolean) : [],
      favorite: Boolean(record.favorite),
      status: mapStatus(record.status),
      createdAt: maybeDate(record.createdAt),
      updatedAt: maybeDate(record.updatedAt || record.createdAt),
      linkedRecordIds: [id],
    });
  });
}

function deconstructionsToAssets(): ContentAsset[] {
  return readJsonArray<Record<string, unknown>>(legacyKeys.deconstructions).map((record) => {
    const id = text(record.id) || createId("deconstruction");
    const title = text(record.sourceTitle) || text(record.title) || text(record.rewrittenTitle) || text(record.sourceUrl) || "历史拆片";
    const comments = Array.isArray(record.topComments)
      ? record.topComments.map((item) => text((item as Record<string, unknown>).content)).filter(Boolean).join("\n")
      : "";
    const content = [
      text(record.transcript) && `逐字稿：\n${text(record.transcript)}`,
      text(record.analysisResult) && `拆片结果：\n${text(record.analysisResult)}`,
      text(record.commentInsights) && `评论洞察：\n${text(record.commentInsights)}`,
      comments && `高赞评论：\n${comments}`,
      text(record.rewrittenScript) && `仿写脚本：\n${text(record.rewrittenScript)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return buildAsset({
      id: `asset_deconstruction_${id}`,
      type: "deconstruction",
      title,
      summary: text(record.hook) || text(record.coreTheme) || text(record.analysisResult).slice(0, 120),
      content,
      rawData: record,
      sourceModule: "deconstruction",
      platform: mapPlatform(record.platform),
      productName: text(record.targetProduct),
      tags: Array.isArray(record.tags) ? record.tags.map(text).filter(Boolean) : [],
      favorite: Boolean(record.favorite),
      status: mapStatus(record.status),
      createdAt: maybeDate(record.createdAt),
      updatedAt: maybeDate(record.updatedAt || record.createdAt),
      linkedRecordIds: [id],
    });
  });
}

function reviewsToAssets(): ContentAsset[] {
  return readJsonArray<Record<string, unknown>>(legacyKeys.reviews).map((record) => {
    const id = text(record.id) || createId("review");
    const title = text(record.title) || text(record.scriptTitle) || "历史复盘";
    const content = [
      text(record.aiConclusion) && `AI 复盘结论：\n${text(record.aiConclusion)}`,
      text(record.conclusion) && `复盘结论：\n${text(record.conclusion)}`,
      text(record.problemReason) && `问题归因：\n${text(record.problemReason)}`,
      text(record.nextOptimization) && `下次优化：\n${text(record.nextOptimization)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return buildAsset({
      id: `asset_review_${id}`,
      type: "review",
      title,
      summary: text(record.aiConclusion) || text(record.conclusion).slice(0, 120),
      content,
      rawData: record,
      sourceModule: "review",
      platform: mapPlatform(record.platform),
      productName: text(record.productName),
      status: "completed",
      createdAt: maybeDate(record.createdAt),
      updatedAt: maybeDate(record.updatedAt || record.createdAt),
      linkedRecordIds: [id],
    });
  });
}

function productsToAssets(): ContentAsset[] {
  return readLegacyProducts<Record<string, unknown>>().map((record) => {
    const id = text(record.id) || createId("product");
    const title = text(record.name) || text(record.productName) || "历史产品资料";
    const content = [
      text(record.coreSellingPoints) && `核心卖点：\n${text(record.coreSellingPoints)}`,
      text(record.secondarySellingPoints) && `次级卖点：\n${text(record.secondarySellingPoints)}`,
      text(record.targetAudience) && `目标人群：\n${text(record.targetAudience)}`,
      text(record.painPoints) && `用户痛点：\n${text(record.painPoints)}`,
      text(record.forbiddenWords) && `禁忌词：\n${text(record.forbiddenWords)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return buildAsset({
      id: `asset_product_${id}`,
      type: "product",
      title,
      summary: text(record.category) || text(record.coreSellingPoints).slice(0, 120),
      content,
      rawData: record,
      sourceModule: "manual",
      productId: id,
      productName: title,
      favorite: Boolean(record.favorite),
      status: "completed",
      createdAt: maybeDate(record.createdAt),
      updatedAt: maybeDate(record.updatedAt || record.createdAt),
      linkedRecordIds: [id],
    });
  });
}

function chatSessionsToAssets(): ContentAsset[] {
  return readLegacyChatSessions<Record<string, unknown>>().map((session) => {
    const id = text(session.id) || createId("chat");
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const content = messages
      .map((message) => {
        const item = message as Record<string, unknown>;
        const role = text(item.role) === "assistant" ? "AI 助手" : text(item.role) === "user" ? "用户" : "系统";
        return `${role}：${text(item.content)}`;
      })
      .filter(Boolean)
      .join("\n\n");
    const lastMessage = messages[messages.length - 1] as Record<string, unknown> | undefined;
    return buildAsset({
      id: `asset_ai_chat_${id}`,
      type: "ai_chat",
      title: text(session.title) || "历史 AI 对话",
      summary: text(lastMessage?.content).slice(0, 120),
      content,
      rawData: session,
      sourceModule: "ai_chat",
      status: messages.length ? "completed" : "draft",
      createdAt: maybeDate(session.createdAt),
      updatedAt: maybeDate(session.updatedAt || session.createdAt),
      linkedRecordIds: [id],
    });
  });
}

function commentInsightsToAssets(): ContentAsset[] {
  return readJsonArray<Record<string, unknown>>(legacyKeys.commentInsights).map((record) => {
    const id = text(record.id) || createId("comment_insight");
    const title = text(record.title) || "评论洞察";
    const content = [
      text(record.rawComments) && `原始评论：\n${text(record.rawComments)}`,
      text(record.painPoints) && `用户痛点：\n${text(record.painPoints)}`,
      text(record.objections) && `购买顾虑：\n${text(record.objections)}`,
      text(record.topicIdeas) && `选题方向：\n${text(record.topicIdeas)}`,
      text(record.replyScripts) && `评论回复话术：\n${text(record.replyScripts)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return buildAsset({
      id: `asset_comment_${id}`,
      type: "comment_insight",
      title,
      summary: text(record.painPoints) || text(record.topicIdeas).slice(0, 120),
      content,
      rawData: record,
      sourceModule: "deconstruction",
      status: "completed",
      createdAt: maybeDate(record.createdAt),
      updatedAt: maybeDate(record.updatedAt || record.createdAt),
      linkedRecordIds: [id],
    });
  });
}

export function buildAssetsFromLegacyData(): ContentAsset[] {
  const byId = new Map<string, ContentAsset>();
  [
    ...scriptsToAssets(),
    ...deconstructionsToAssets(),
    ...reviewsToAssets(),
    ...productsToAssets(),
    ...chatSessionsToAssets(),
    ...commentInsightsToAssets(),
  ].forEach((asset) => byId.set(asset.id, asset));
  return Array.from(byId.values());
}

export function readLegacyProducts<T = Record<string, unknown>>(): T[] {
  return readJsonArray<T>(legacyKeys.products);
}

export function readLegacyChatSessions<T = Record<string, unknown>>(): T[] {
  return readJsonArray<T>(legacyKeys.chatSessions);
}
