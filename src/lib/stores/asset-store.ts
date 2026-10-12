import { createId } from "@/lib/shared/id";
import { nowIso } from "@/lib/shared/time";
import { buildAssetsFromLegacyData, readLegacyChatSessions, readLegacyProducts } from "@/lib/stores/migrations";
import { storageGet, storageRemove, storageSet } from "@/lib/web-storage";

export const assetStorageKey = "CONTENT_CENTER_ASSETS_V1";
export const productStorageKey = "CONTENT_CENTER_PRODUCTS_V1";
export const settingsStorageKey = "CONTENT_CENTER_SETTINGS_V1";
export const chatSessionsStorageKey = "CONTENT_CENTER_CHAT_SESSIONS_V1";

export type ContentAssetType = "script" | "deconstruction" | "image_prompt" | "image_project" | "ai_chat" | "comment_insight" | "review" | "product";
export type ContentAssetSourceModule = "script" | "deconstruction" | "image" | "ai_chat" | "review" | "manual";
export type ContentAssetPlatform = "douyin" | "xiaohongshu" | "kuaishou" | "shipinhao" | "taobao" | "private" | "unknown";
export type ContentAssetStatus = "draft" | "completed" | "failed" | "archived";

export interface ContentAsset {
  id: string;
  type: ContentAssetType;
  title: string;
  summary: string;
  content: string;
  rawData: unknown;
  sourceModule: ContentAssetSourceModule;
  platform: ContentAssetPlatform;
  productId: string;
  productName: string;
  tags: string[];
  favorite: boolean;
  status: ContentAssetStatus;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  version: number;
  linkedRecordIds: string[];
}

export interface AssetSearchFilters {
  type?: ContentAssetType | "all";
  platform?: ContentAssetPlatform | "all";
  favorite?: boolean | "all";
  status?: ContentAssetStatus | "all";
  productId?: string;
}

export interface ContentCenterExport {
  exportedAt: string;
  assets: ContentAsset[];
  products: unknown[];
  chatSessions: unknown[];
  settings: Record<string, unknown>;
}

export function getAssets(): ContentAsset[] {
  ensureLegacyMigration();
  return readList<ContentAsset>(assetStorageKey).map(normalizeAsset).sort(sortByUpdatedAt);
}

export function getAssetById(id: string) {
  const asset = getAssets().find((item) => item.id === id) || null;
  if (asset) {
    updateAsset(id, { lastOpenedAt: nowIso() });
  }
  return asset;
}

export function createAsset(asset: Partial<ContentAsset>) {
  const now = nowIso();
  const next = normalizeAsset({
    id: asset.id || createId("asset"),
    type: asset.type || "script",
    title: asset.title || "未命名资产",
    summary: asset.summary || "",
    content: asset.content || "",
    rawData: asset.rawData ?? {},
    sourceModule: asset.sourceModule || "manual",
    platform: asset.platform || "unknown",
    productId: asset.productId || "",
    productName: asset.productName || "",
    tags: asset.tags || [],
    favorite: asset.favorite || false,
    status: asset.status || "completed",
    createdAt: asset.createdAt || now,
    updatedAt: asset.updatedAt || now,
    lastOpenedAt: asset.lastOpenedAt || now,
    version: asset.version || 1,
    linkedRecordIds: asset.linkedRecordIds || []
  });
  return upsertAsset(next);
}

export function updateAsset(id: string, patch: Partial<ContentAsset>) {
  const existing = getAssets().find((item) => item.id === id);
  if (!existing) return null;
  return upsertAsset(normalizeAsset({ ...existing, ...patch, id, updatedAt: patch.updatedAt || nowIso() }));
}

export function deleteAsset(id: string) {
  writeList(assetStorageKey, getAssets().filter((asset) => asset.id !== id));
}

export function archiveAsset(id: string) {
  return updateAsset(id, { status: "archived" });
}

export function restoreAsset(id: string) {
  return updateAsset(id, { status: "completed" });
}

export function toggleFavoriteAsset(id: string) {
  const asset = getAssets().find((item) => item.id === id);
  if (!asset) return null;
  return updateAsset(id, { favorite: !asset.favorite });
}

export function searchAssets(query = "", filters: AssetSearchFilters = {}) {
  const keyword = query.trim().toLowerCase();
  return getAssets().filter((asset) => {
    const text = [asset.title, asset.summary, asset.content, asset.productName, asset.tags.join(" ")].join(" ").toLowerCase();
    return (
      (!keyword || text.includes(keyword)) &&
      (!filters.type || filters.type === "all" || asset.type === filters.type) &&
      (!filters.platform || filters.platform === "all" || asset.platform === filters.platform) &&
      (filters.favorite === undefined || filters.favorite === "all" || asset.favorite === filters.favorite) &&
      (!filters.status || filters.status === "all" || asset.status === filters.status) &&
      (!filters.productId || asset.productId === filters.productId)
    );
  });
}

export function getRecentAssets(limit = 5) {
  return getAssets().filter((item) => item.status !== "archived").slice(0, limit);
}

export function getAssetsByType(type: ContentAssetType) {
  return getAssets().filter((asset) => asset.type === type);
}

export function getAssetsByProduct(productId: string) {
  return getAssets().filter((asset) => asset.productId === productId);
}

export function exportAssets(): ContentCenterExport {
  return {
    exportedAt: nowIso(),
    assets: getAssets(),
    products: readList(productStorageKey).length ? readList(productStorageKey) : readLegacyProducts(),
    chatSessions: readList(chatSessionsStorageKey).length ? readList(chatSessionsStorageKey) : readLegacyChatSessions(),
    settings: readObject(settingsStorageKey)
  };
}

export function importAssets(data: unknown) {
  if (!data || typeof data !== "object") {
    throw new Error("导入数据必须是对象");
  }
  const record = data as Partial<ContentCenterExport>;
  if (Array.isArray(record.assets)) {
    mergeList(assetStorageKey, record.assets.map(normalizeAsset));
  }
  if (Array.isArray(record.products)) {
    mergeList(productStorageKey, record.products as Array<{ id: string }>);
  }
  if (Array.isArray(record.chatSessions)) {
    mergeList(chatSessionsStorageKey, record.chatSessions as Array<{ id: string }>);
  }
  if (record.settings && typeof record.settings === "object") {
    writeObject(settingsStorageKey, { ...readObject(settingsStorageKey), ...record.settings });
  }
}

export function clearArchivedAssets() {
  writeList(assetStorageKey, getAssets().filter((asset) => asset.status !== "archived"));
}

export function clearAllContentCenterData() {
  if (typeof window === "undefined") return;
  [assetStorageKey, productStorageKey, settingsStorageKey, chatSessionsStorageKey].forEach((key) => storageRemove(key));
}

export function assetFromScriptRecord(script: {
  id: string;
  title: string;
  productId?: string;
  productName?: string;
  platform?: string;
  contentType?: string;
  contentFormat?: string;
  hook?: string;
  scriptText?: string;
  shotSuggestions?: string;
  overlaySuggestions?: string;
  shootingTips?: string;
  endingCTA?: string;
  riskCheckResult?: unknown;
  status?: string;
  tags?: string;
  favorite?: boolean;
  createdAt?: string;
  updatedAt?: string;
}) {
  return createAsset({
    id: `asset_script_${script.id}`,
    type: "script",
    title: script.title || "未命名脚本",
    summary: script.hook || script.scriptText?.slice(0, 120) || "",
    content: [
      `标题：${script.title || ""}`,
      script.hook?.trim() ? `开头：${script.hook}` : "",
      `正文：\n${script.scriptText || ""}`,
      script.shotSuggestions?.trim() ? `分镜建议：\n${script.shotSuggestions}` : "",
      script.overlaySuggestions?.trim() ? `画中画建议：\n${script.overlaySuggestions}` : "",
      script.shootingTips?.trim() ? `拍摄提醒：\n${script.shootingTips}` : "",
      script.endingCTA?.trim() ? `结尾引导：${script.endingCTA}` : ""
    ].filter(Boolean).join("\n\n"),
    rawData: script,
    sourceModule: "script",
    platform: mapPlatform(script.platform),
    productId: script.productId || "",
    productName: script.productName || "",
    tags: [script.contentType || "", script.contentFormat || "", ...(script.tags ? script.tags.split(/[、,\s]+/) : [])].filter(Boolean),
    favorite: Boolean(script.favorite),
    status: script.status === "草稿" ? "draft" : "completed",
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
    linkedRecordIds: [script.id]
  });
}

export function mapPlatform(platform?: string): ContentAssetPlatform {
  if (platform === "抖音" || platform === "douyin") return "douyin";
  if (platform === "小红书" || platform === "xiaohongshu") return "xiaohongshu";
  if (platform === "快手" || platform === "kuaishou") return "kuaishou";
  if (platform === "视频号" || platform === "wechat_channels") return "shipinhao";
  if (platform === "淘宝内容" || platform === "taobao") return "taobao";
  if (platform === "朋友圈" || platform === "私域朋友圈" || platform === "private") return "private";
  return "unknown";
}

function ensureLegacyMigration() {
  if (typeof window === "undefined") return;
  const flag = "CONTENT_CENTER_ASSETS_MIGRATED_V1";
  if (window.localStorage.getItem(flag) === "true") return;
  const migrated = buildAssetsFromLegacyData();
  if (migrated.length > 0) {
    mergeList(assetStorageKey, migrated.map(normalizeAsset));
  }
  window.localStorage.setItem(flag, "true");
}

function upsertAsset(asset: ContentAsset) {
  const items = readList<ContentAsset>(assetStorageKey).map(normalizeAsset);
  const index = items.findIndex((item) => item.id === asset.id);
  const next = index >= 0 ? items.map((item) => (item.id === asset.id ? asset : item)) : [asset, ...items];
  writeList(assetStorageKey, next);
  return asset;
}

function normalizeAsset(asset: Partial<ContentAsset>): ContentAsset {
  const now = nowIso();
  return {
    id: asset.id || createId("asset"),
    type: asset.type || "script",
    title: asset.title || "未命名资产",
    summary: asset.summary || "",
    content: asset.content || "",
    rawData: asset.rawData ?? {},
    sourceModule: asset.sourceModule || "manual",
    platform: asset.platform || "unknown",
    productId: asset.productId || "",
    productName: asset.productName || "",
    tags: Array.isArray(asset.tags) ? asset.tags.filter(Boolean) : [],
    favorite: Boolean(asset.favorite),
    status: asset.status || "completed",
    createdAt: asset.createdAt || now,
    updatedAt: asset.updatedAt || asset.createdAt || now,
    lastOpenedAt: asset.lastOpenedAt || asset.updatedAt || asset.createdAt || now,
    version: asset.version || 1,
    linkedRecordIds: Array.isArray(asset.linkedRecordIds) ? asset.linkedRecordIds.filter(Boolean) : []
  };
}

function sortByUpdatedAt(a: ContentAsset, b: ContentAsset) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function readList<T>(key: string): T[] {
  const raw = storageGet(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, items: T[]) {
  storageSet(key, JSON.stringify(items));
}

function mergeList<T extends { id: string }>(key: string, incoming: T[]) {
  const existing = readList<T>(key);
  const byId = new Map(existing.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, { ...(byId.get(item.id) || {}), ...item }));
  writeList(key, Array.from(byId.values()));
}

function readObject(key: string): Record<string, unknown> {
  const raw = storageGet(key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function writeObject(key: string, value: Record<string, unknown>) {
  storageSet(key, JSON.stringify(value));
}
