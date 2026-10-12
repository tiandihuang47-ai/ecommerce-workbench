import { randomUUID } from "node:crypto";
import { marketingLearningStore } from "@/lib/marketing-learning/store";
import {
  EMPTY_METRICS,
  normalizeMetrics,
  parseNumber,
  performanceFingerprint
} from "@/lib/marketing-learning/metrics";
import type { PerformanceMetrics, PerformanceRecord, PerformanceSource } from "@/lib/marketing-learning/types";

/**
 * 营销学习闭环 · 表现数据回流
 *
 * 支持手工录入与 CSV 导入；与 CreativeRecord 解耦，可后补。
 * 缺失指标一律保持 null，绝不算假数据。
 * 同一口径指纹（同作品+同采集时间+同数据）重复导入不新增记录。
 */

export interface ManualPerformanceInput {
  creativeId: string;
  platform?: string;
  postId?: string;
  postUrl?: string;
  publishedAt?: string;
  dataCapturedAt?: string;
  metrics?: Partial<Record<keyof PerformanceMetrics, unknown>>;
  rawMetrics?: Record<string, number | string>;
  source?: PerformanceSource;
  sourceType?: "own" | "competitor" | "reference";
  notes?: string;
  /** 数据口径：累计快照（默认）或区间增量 */
  metricType?: "cumulative" | "increment";
  periodStart?: string;
  periodEnd?: string;
  contentAccount?: string;
  trafficType?: "natural" | "paid" | "mixed";
  observationWindowDays?: number;
}

export async function createPerformanceRecord(input: ManualPerformanceInput): Promise<PerformanceRecord> {
  const creative = await marketingLearningStore.getCreative(input.creativeId);
  if (!creative) throw new Error("没有找到对应的创意记录，无法关联数据。");
  const now = new Date().toISOString();
  const record: PerformanceRecord = {
    performanceId: "performance_" + randomUUID(),
    creativeId: creative.creativeId,
    sourceType: input.sourceType || "own",
    platform: input.platform || creative.platform,
    postId: input.postId || "",
    postUrl: input.postUrl || "",
    publishedAt: input.publishedAt || "",
    dataCapturedAt: input.dataCapturedAt || now,
    metrics: normalizeMetrics(input.metrics),
    rawMetrics: input.rawMetrics || {},
    source: input.source || "manual",
    accountBaseline: creative.accountBaseline || null,
    notes: input.notes || "",
    createdAt: now,
    metricType: input.metricType || "cumulative",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    contentAccount: input.contentAccount || "",
    trafficType: input.trafficType,
    observationWindowDays: input.observationWindowDays
  };
  record.dedupFingerprint = performanceFingerprint(record);
  const existing = await marketingLearningStore.listPerformance({ creativeId: record.creativeId });
  if (existing.some((item) => item.dedupFingerprint === record.dedupFingerprint)) {
    return existing.find((item) => item.dedupFingerprint === record.dedupFingerprint)!;
  }
  return marketingLearningStore.savePerformance(record);
}

/* ------------------------------------------------------------------ CSV 导入 */

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
}

export function parseCsvText(text: string): CsvParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (char === "\r") continue;
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((item) => item.some((cell) => cell.trim() !== ""));
  const headers = (nonEmpty.shift() || []).map((cell) => cell.trim());
  return { headers, rows: nonEmpty };
}

const HEADER_ALIASES: Record<string, string> = {
  "曝光": "impressions", "曝光量": "impressions", "展现": "impressions", "展现量": "impressions", "impressions": "impressions", "impression": "impressions",
  "播放": "views", "播放量": "views", "浏览": "views", "浏览量": "views", "阅读": "views", "views": "views", "view": "views", "play": "views",
  "点击": "clicks", "点击数": "clicks", "clicks": "clicks", "click": "clicks",
  "商品点击": "productClicks", "商品点击数": "productClicks", "productclicks": "productClicks", "product_clicks": "productClicks",
  "点赞": "likes", "点赞数": "likes", "likes": "likes", "like": "likes",
  "评论": "comments", "评论数": "comments", "comments": "comments", "comment": "comments",
  "分享": "shares", "分享数": "shares", "shares": "shares", "share": "shares",
  "收藏": "favorites", "收藏数": "favorites", "favorites": "favorites", "favorite": "favorites", "collect": "favorites",
  "关注": "follows", "关注数": "follows", "follows": "follows", "follow": "follows",
  "订单": "orders", "订单数": "orders", "orders": "orders", "order": "orders",
  "gmv": "gmv", "成交额": "gmv", "销售额": "gmv", "交易额": "gmv",
  "发布时间": "publishedAt", "发布日期": "publishedAt", "publishedat": "publishedAt", "publish_time": "publishedAt",
  "采集时间": "dataCapturedAt", "数据时间": "dataCapturedAt", "datacapturedat": "dataCapturedAt", "captured_at": "dataCapturedAt",
  "creativeid": "creativeId", "creative_id": "creativeId", "创意id": "creativeId",
  "帖子id": "postId", "作品id": "postId", "postid": "postId", "post_id": "postId",
  "链接": "postUrl", "作品链接": "postUrl", "posturl": "postUrl", "post_url": "postUrl",
  "平台": "platform", "platform": "platform"
};

export function suggestCsvMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = String(header || "").trim().toLowerCase().replace(/\s+/g, "");
    const mapped = HEADER_ALIASES[header] || HEADER_ALIASES[key];
    if (mapped) mapping[String(index)] = mapped;
  });
  return mapping;
}

export function previewCsv(text: string, limit = 15) {
  const parsed = parseCsvText(text);
  return {
    headers: parsed.headers,
    sampleRows: parsed.rows.slice(0, limit),
    totalRows: parsed.rows.length,
    suggestedMapping: suggestCsvMapping(parsed.headers),
    metricKeys: Object.keys(EMPTY_METRICS)
  };
}

export interface CsvImportInput {
  text: string;
  /** 列下标（字符串）到字段名的映射。 */
  mapping: Record<string, string>;
  defaultCreativeId?: string;
  platform?: string;
  sourceType?: "own" | "competitor" | "reference";
}

export async function importPerformanceCsv(input: CsvImportInput) {
  const parsed = parseCsvText(input.text);
  const fieldByIndex = new Map<number, string>();
  for (const [index, field] of Object.entries(input.mapping || {})) {
    const columnIndex = Number(index);
    if (Number.isInteger(columnIndex) && field) fieldByIndex.set(columnIndex, field);
  }
  const saved: PerformanceRecord[] = [];
  const errors: string[] = [];
  let duplicates = 0;
  const now = new Date().toISOString();
  // 去重：同一 creativeId 下已有相同指纹（同作品+同采集时间+同数据）的记录不再新增
  const existingByCreative = new Map<string, Set<string>>();
  {
    const all = await marketingLearningStore.listPerformance();
    for (const record of all) {
      if (!record.dedupFingerprint) continue;
      const set = existingByCreative.get(record.creativeId) || new Set<string>();
      set.add(record.dedupFingerprint);
      existingByCreative.set(record.creativeId, set);
    }
  }

  for (const [rowIndex, row] of parsed.rows.entries()) {
    const fields: Record<string, string> = {};
    for (const [columnIndex, field] of fieldByIndex) fields[field] = row[columnIndex] || "";
    const creativeId = (fields.creativeId || input.defaultCreativeId || "").trim();
    if (!creativeId) { errors.push("第 " + (rowIndex + 1) + " 行：没有 creativeId，也未选择默认创意。"); continue; }
    const creative = await marketingLearningStore.getCreative(creativeId);
    if (!creative) { errors.push("第 " + (rowIndex + 1) + " 行：找不到 creativeId " + creativeId + "。"); continue; }
    const metrics: Partial<Record<keyof PerformanceMetrics, unknown>> = {};
    for (const key of Object.keys(EMPTY_METRICS) as Array<keyof PerformanceMetrics>) {
      if (fields[key] !== undefined && fields[key] !== "") metrics[key] = fields[key];
    }
    if (!Object.values(metrics).some((value) => parseNumber(value) !== null)) { errors.push("第 " + (rowIndex + 1) + " 行：没有任何可识别指标，已跳过。"); continue; }
    const record: PerformanceRecord = {
      performanceId: "performance_" + randomUUID(),
      creativeId,
      sourceType: input.sourceType || "own",
      platform: fields.platform || input.platform || creative.platform,
      postId: fields.postId || "",
      postUrl: fields.postUrl || "",
      publishedAt: fields.publishedAt || "",
      dataCapturedAt: fields.dataCapturedAt || now,
      metrics: normalizeMetrics(metrics),
      rawMetrics: {},
      source: "csv",
      accountBaseline: creative.accountBaseline || null,
      notes: "",
      createdAt: now,
      metricType: "cumulative"
    };
    // 指纹身份：行内没有采集时间列时用空值参与指纹（身份=作品+数据），
    // 这样同一文件重复导入会被跳过；行内带了采集时间则不同时间的快照各自保留。
    record.dedupFingerprint = performanceFingerprint({ ...record, dataCapturedAt: fields.dataCapturedAt || "" });
    const fingerprints = existingByCreative.get(creativeId);
    if (fingerprints?.has(record.dedupFingerprint)) {
      duplicates += 1;
      continue;
    }
    fingerprints?.add(record.dedupFingerprint);
    saved.push(await marketingLearningStore.savePerformance(record));
  }
  return { imported: saved.length, skipped: parsed.rows.length - saved.length, duplicates, errors: errors.slice(0, 20), records: saved };
}
