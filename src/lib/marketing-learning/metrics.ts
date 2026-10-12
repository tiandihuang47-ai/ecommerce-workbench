import type { DerivedMetric, LearningGoal, PerformanceMetrics, PerformanceRecord } from "@/lib/marketing-learning/types";

/**
 * 营销学习闭环 · 指标计算（唯一来源）
 *
 * 所有比率都在这里集中计算，UI 和复盘都不许各算一份。
 * 缺失分母时返回 null（unavailable），绝不编造数据。
 * 每个比率都带 basis（用了哪个分母），方便复盘追溯。
 */

export const EMPTY_METRICS: PerformanceMetrics = {
  impressions: null,
  views: null,
  clicks: null,
  productClicks: null,
  likes: null,
  comments: null,
  shares: null,
  favorites: null,
  follows: null,
  orders: null,
  gmv: null,
  watchTimeMs: null,
  avgWatchMs: null,
  completionRate: null
};

export const METRIC_LABELS: Record<string, string> = {
  impressions: "曝光",
  views: "播放/浏览",
  clicks: "点击",
  productClicks: "商品点击",
  likes: "点赞",
  comments: "评论",
  shares: "分享",
  favorites: "收藏",
  follows: "关注",
  orders: "订单",
  gmv: "GMV",
  ctr: "点击率 CTR",
  engagementRate: "互动率",
  productClickRate: "商品点击率",
  conversionRate: "转化率",
  favoriteRate: "收藏率",
  shareRate: "分享率",
  commentRate: "评论率",
  likeRate: "点赞率",
  gmvPerOrder: "客单价"
};

const RATE_KEYS = new Set(["ctr", "engagementRate", "productClickRate", "conversionRate", "favoriteRate", "shareRate", "commentRate", "likeRate", "completionRate"]);

const CHINESE_UNIT_MULTIPLIERS: Record<string, number> = {
  "万": 10000,
  "w": 10000,
  "亿": 100000000
};

/**
 * 数值解析：
 * - 支持常见中文数量单位（1.2万 → 12000）；无法识别时返回 null，不产生错误数值。
 * - rate=true（完播率/点击率等比率字段）时统一到小数比例："45%" → 0.45、"45" → 0.45、"0.45" → 0.45。
 */
export function parseNumber(value: unknown, options?: { rate?: boolean }): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (options?.rate && value > 1) return value / 100;
    return value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const isPercent = /%$/.test(raw);
  const unitMatch = raw.match(/(万|w|亿)$/i);
  const cleaned = raw
    .replace(/[,，\s%￥$]/g, "")
    .replace(/(万|w|亿)$/i, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  let result = parsed;
  if (unitMatch) {
    const multiplier = CHINESE_UNIT_MULTIPLIERS[unitMatch[1].toLowerCase()];
    if (!multiplier) return null;
    result = parsed * multiplier;
  }
  if (options?.rate) {
    if (isPercent) return result / 100;
    if (result > 1) return result / 100;
  }
  return result;
}

/** 比例字段：录入 45 或 "45%" 都归一成 0.45 */
const RATE_METRIC_KEYS = new Set<keyof PerformanceMetrics>(["completionRate"]);

export function normalizeMetrics(input: Partial<Record<keyof PerformanceMetrics, unknown>> | undefined): PerformanceMetrics {
  const source = input || {};
  const next = { ...EMPTY_METRICS };
  for (const key of Object.keys(EMPTY_METRICS) as Array<keyof PerformanceMetrics>) {
    next[key] = parseNumber(source[key], { rate: RATE_METRIC_KEYS.has(key) });
  }
  return next;
}

export function sumMetrics(records: PerformanceMetrics[]): PerformanceMetrics {
  const total = { ...EMPTY_METRICS };
  for (const record of records) {
    for (const key of Object.keys(EMPTY_METRICS) as Array<keyof PerformanceMetrics>) {
      const value = record[key];
      if (typeof value === "number") total[key] = (total[key] || 0) + value;
    }
  }
  return total;
}

/** reach = 播放/浏览优先，其次曝光；都缺失则无法算比率。 */
function reachOf(metrics: PerformanceMetrics): { value: number | null; basis: string } {
  if (typeof metrics.views === "number" && metrics.views > 0) return { value: metrics.views, basis: "views" };
  if (typeof metrics.impressions === "number" && metrics.impressions > 0) return { value: metrics.impressions, basis: "impressions" };
  return { value: null, basis: "缺少 views/impressions" };
}

function rate(numerator: number | null, denominator: number | null, basis: string): { value: number | null; basis: string } {
  if (numerator === null || denominator === null || denominator === 0) return { value: null, basis };
  return { value: numerator / denominator, basis };
}

function sumOptional(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => typeof value === "number");
  return present.length ? present.reduce((total, value) => total + value, 0) : null;
}

/** 由基础指标派生所有比率；数据不足返回 null。 */
export function deriveMetrics(metrics: PerformanceMetrics): DerivedMetric[] {
  const reach = reachOf(metrics);
  const engagement = sumOptional([metrics.likes, metrics.comments, metrics.shares, metrics.favorites]);
  const ctr = rate(metrics.clicks, metrics.impressions, "clicks / impressions");
  const engagementRate = rate(engagement, reach.value, "互动数 / " + reach.basis);
  const productClickRate = rate(metrics.productClicks, reach.value, "productClicks / " + reach.basis);
  const conversionBase = metrics.productClicks !== null ? metrics.productClicks : metrics.clicks;
  const conversionBasis = metrics.productClicks !== null ? "orders / productClicks" : "orders / clicks";
  const conversionRate = rate(metrics.orders, conversionBase, conversionBasis);
  const favoriteRate = rate(metrics.favorites, reach.value, "favorites / " + reach.basis);
  const shareRate = rate(metrics.shares, reach.value, "shares / " + reach.basis);
  const commentRate = rate(metrics.comments, reach.value, "comments / " + reach.basis);
  const likeRate = rate(metrics.likes, reach.value, "likes / " + reach.basis);
  const gmvPerOrder = rate(metrics.gmv, metrics.orders, "gmv / orders");

  const list: DerivedMetric[] = [
    metric("impressions", metrics.impressions, "原始字段"),
    metric("views", metrics.views, "原始字段"),
    metric("clicks", metrics.clicks, "原始字段"),
    metric("productClicks", metrics.productClicks, "原始字段"),
    metric("likes", metrics.likes, "原始字段"),
    metric("comments", metrics.comments, "原始字段"),
    metric("shares", metrics.shares, "原始字段"),
    metric("favorites", metrics.favorites, "原始字段"),
    metric("follows", metrics.follows, "原始字段"),
    metric("orders", metrics.orders, "原始字段"),
    metric("gmv", metrics.gmv, "原始字段"),
    metric("ctr", ctr.value, ctr.basis),
    metric("engagementRate", engagementRate.value, engagementRate.basis),
    metric("productClickRate", productClickRate.value, productClickRate.basis),
    metric("conversionRate", conversionRate.value, conversionBasis),
    metric("favoriteRate", favoriteRate.value, favoriteRate.basis),
    metric("shareRate", shareRate.value, shareRate.basis),
    metric("commentRate", commentRate.value, commentRate.basis),
    metric("likeRate", likeRate.value, likeRate.basis),
    metric("gmvPerOrder", gmvPerOrder.value, gmvPerOrder.basis)
  ];
  // 原始字段为 null 时丢弃；比率类即使 null 也保留，方便 UI 显示 unavailable
  return list.filter((item) => item.value !== null || isRateMetric(item.key));
}

function metric(key: string, value: number | null, basis: string): DerivedMetric {
  return { key, label: METRIC_LABELS[key] || key, value, basis };
}

export function metricByKey(list: DerivedMetric[], key: string): DerivedMetric | null {
  return list.find((item) => item.key === key) || null;
}

const GOAL_PRIORITY: Record<LearningGoal, string[]> = {
  traffic: ["ctr", "views", "impressions"],
  engagement: ["engagementRate", "favoriteRate", "likeRate"],
  product_click: ["productClickRate", "productClicks", "clicks"],
  conversion: ["conversionRate", "orders", "gmv"]
};

export function goalLabel(goal: LearningGoal) {
  if (goal === "traffic") return "流量";
  if (goal === "engagement") return "互动";
  if (goal === "product_click") return "商品点击";
  return "转化";
}

export function priorityKeysForGoal(goal: LearningGoal): string[] {
  return GOAL_PRIORITY[goal] || GOAL_PRIORITY.traffic;
}

/** 单条数据选核心指标：按目标优先级取第一个有值的。 */
export function coreMetricForGoal(list: DerivedMetric[], goal: LearningGoal): DerivedMetric {
  for (const key of priorityKeysForGoal(goal)) {
    const found = metricByKey(list, key);
    if (found && found.value !== null) return found;
  }
  const fallbackKey = priorityKeysForGoal(goal)[0];
  return metricByKey(list, fallbackKey) || { key: fallbackKey, label: METRIC_LABELS[fallbackKey] || fallbackKey, value: null, basis: "数据不足" };
}

/** 一组数据选统一核心指标：取第一个「至少有一个非空值」的优先级指标，保证可比。 */
export function chooseComparableMetricKey(metricLists: DerivedMetric[][], goal: LearningGoal): string {
  for (const key of priorityKeysForGoal(goal)) {
    if (metricLists.some((list) => (metricByKey(list, key)?.value ?? null) !== null)) return key;
  }
  return priorityKeysForGoal(goal)[0];
}

export function formatMetric(key: string, value: number | null): string {
  if (value === null || value === undefined) return "unavailable";
  if (RATE_KEYS.has(key) || key === "completionRate") return (value * 100).toFixed(value < 0.01 ? 2 : 1) + "%";
  if (key === "gmv") return "¥" + Math.round(value).toLocaleString("zh-CN");
  if (key === "gmvPerOrder") return "¥" + Math.round(value).toLocaleString("zh-CN");
  return Math.round(value).toLocaleString("zh-CN");
}

export function isRateMetric(key: string) {
  return RATE_KEYS.has(key);
}

/**
 * 兼容入口：按口径修正规则聚合（累计取最新快照、增量需不重叠、比率不跨作品相加）。
 * 所有旧的按创意/分组汇总调用点都自动获得修正后的口径。
 */
export function aggregatePerformance(records: PerformanceRecord[]): PerformanceMetrics {
  return aggregatePerformanceRecords(records).total;
}

/* ------------------------------------------------------------------ */
/* 口径修正聚合（2026-09 开发文档 §三.D1/D2）                            */
/* ------------------------------------------------------------------ */

export type AggregationCaveat = {
  workKey: string;
  kind: "mixed_caliber" | "overlapping_period" | "capture_conflict" | "legacy_caliber";
  message: string;
};

export type AggregationResult = {
  total: PerformanceMetrics;
  /** 每个作品的最终口径：累计取最新快照；增量仅在区间明确且不重叠时相加 */
  perWork: Array<{ workKey: string; metrics: PerformanceMetrics; caliberNote: string }>;
  caveats: AggregationCaveat[];
  /** 因冲突/口径问题被排除的记录数 */
  excludedCount: number;
};

/** 作品身份：postId 优先，其次规范化链接，最后退回 creativeId+平台 */
export function workKeyOf(record: Pick<PerformanceRecord, "postId" | "postUrl" | "creativeId" | "platform">): string {
  if (record.postId?.trim()) return `post:${record.postId.trim()}`;
  const url = (record.postUrl || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  if (url) return `url:${url}`;
  return `creative:${record.creativeId}:${record.platform || ""}`;
}

export function performanceFingerprint(record: Pick<
  PerformanceRecord,
  "creativeId" | "platform" | "postId" | "postUrl" | "dataCapturedAt" | "metrics"
>): string {
  const metricPart = (Object.keys(EMPTY_METRICS) as Array<keyof PerformanceMetrics>)
    .map((key) => `${key}=${record.metrics[key] ?? ""}`)
    .join("|");
  return [record.creativeId, record.platform || "", record.postId || "", record.postUrl || "", record.dataCapturedAt, metricPart].join("§");
}

/** 区间是否重叠（半开区间：start <= other.end && other.start <= end，端点相接不算重叠） */
function periodsOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * 口径修正聚合：
 * - 同一作品的累计快照：取观察范围内最新有效快照（不相加、不取最大）；
 * - 增量：仅在区间明确且互不重叠时相加；
 * - 累计与增量混合 / 区间重叠：提示冲突并排除冲突部分；
 * - 同作品同采集时间但数据不同：提示冲突，取较新导入并标注；
 * - 旧记录无口径字段：按累计处理并标记 legacy_caliber（不推断为增量）；
 * - 完播率、平均观看时长不可跨作品汇总（返回 null，由 UI 展示单条值）。
 */
export function aggregatePerformanceRecords(records: PerformanceRecord[]): AggregationResult {
  const caveats: AggregationCaveat[] = [];
  let excludedCount = 0;
  const byWork = new Map<string, PerformanceRecord[]>();
  for (const record of records) {
    const key = workKeyOf(record);
    const list = byWork.get(key) || [];
    list.push(record);
    byWork.set(key, list);
  }

  const perWork: AggregationResult["perWork"] = [];
  /** 每作品一行"代表指标"：比率字段取该作品最新快照的值，供展示层使用 */
  for (const [workKey, workRecords] of byWork) {
    const cumulative = workRecords.filter((record) => (record.metricType ?? "cumulative") === "cumulative");
    const increments = workRecords.filter((record) => record.metricType === "increment");
    let workMetrics: PerformanceMetrics;
    let caliberNote = "";

    if (cumulative.length > 0) {
      const sorted = [...cumulative].sort((a, b) => b.dataCapturedAt.localeCompare(a.dataCapturedAt));
      workMetrics = { ...sorted[0].metrics };
      if (sorted.some((record) => !record.metricType)) {
        caveats.push({ workKey, kind: "legacy_caliber", message: "部分记录未标注口径，已按累计快照处理（口径待确认）" });
      }
      // 同采集时间但数据不同 → 提示冲突
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i].dataCapturedAt === sorted[0].dataCapturedAt) {
          const differs = (Object.keys(EMPTY_METRICS) as Array<keyof PerformanceMetrics>)
            .some((key) => sorted[i].metrics[key] !== null && sorted[0].metrics[key] !== null && sorted[i].metrics[key] !== sorted[0].metrics[key]);
          if (differs) {
            caveats.push({ workKey, kind: "capture_conflict", message: `同一采集时间存在不同数据，已采用导入时间较新的记录（${sorted[0].performanceId.slice(-8)}）` });
          }
        }
      }
      caliberNote = `累计快照，截至 ${sorted[0].dataCapturedAt.slice(0, 10)}`;
    } else if (increments.length > 0) {
      // 增量：区间必须明确且互不重叠
      const withPeriod = increments.filter((record) => record.periodStart && record.periodEnd);
      const withoutPeriod = increments.filter((record) => !record.periodStart || !record.periodEnd);
      const overlapping: PerformanceRecord[] = [];
      const accepted: PerformanceRecord[] = [];
      const acceptedPeriods: Array<{ start: string; end: string }> = [];
      for (const record of [...withPeriod].sort((a, b) => (a.periodStart || "").localeCompare(b.periodStart || ""))) {
        const period = { start: record.periodStart!, end: record.periodEnd! };
        if (acceptedPeriods.some((existing) => periodsOverlap(existing, period))) {
          overlapping.push(record);
          continue;
        }
        accepted.push(record);
        acceptedPeriods.push(period);
      }
      workMetrics = sumMetrics(accepted.map((record) => record.metrics));
      excludedCount += overlapping.length + withoutPeriod.length;
      if (overlapping.length) {
        caveats.push({ workKey, kind: "overlapping_period", message: `${overlapping.length} 条增量因区间重叠被排除` });
      }
      if (withoutPeriod.length) {
        caveats.push({ workKey, kind: "mixed_caliber", message: `${withoutPeriod.length} 条增量缺少明确区间，已排除` });
      }
      caliberNote = `区间增量求和（${accepted.length} 条）`;
    } else {
      continue;
    }

    if (cumulative.length > 0 && increments.length > 0) {
      caveats.push({ workKey, kind: "mixed_caliber", message: "同作品混合了累计快照与增量口径：已只采用累计最新快照，增量被排除" });
      excludedCount += increments.length;
      const sorted = [...cumulative].sort((a, b) => b.dataCapturedAt.localeCompare(a.dataCapturedAt));
      workMetrics = { ...sorted[0].metrics };
      caliberNote = `累计快照（增量已排除），截至 ${sorted[0].dataCapturedAt.slice(0, 10)}`;
    }

    perWork.push({ workKey, metrics: workMetrics, caliberNote });
  }

  // 跨作品汇总：计数与金额可加；比率类（完播率等）不可加 → null
  const total = sumMetrics(perWork.map((item) => item.metrics));
  total.completionRate = null;
  total.avgWatchMs = null;

  return { total, perWork, caveats, excludedCount };
}

/**
 * 相对表现（§三.D3）：与同账号近期同目标中位数比较。
 * 至少 5 条可比记录才输出，否则返回 null（样本不足，不产生虚假基线）。
 * 只给相对值，不解释成因果。
 */
export function relativeToAccountMedian(options: {
  record: PerformanceRecord;
  peers: PerformanceRecord[];
  metricKey: keyof PerformanceMetrics;
}): { median: number; value: number; deltaPercent: number } | null {
  const selfValue = options.record.metrics[options.metricKey];
  if (typeof selfValue !== "number") return null;
  const peerValues = options.peers
    .filter((peer) => peer.performanceId !== options.record.performanceId)
    .map((peer) => peer.metrics[options.metricKey])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (peerValues.length < 5) return null;
  const mid = Math.floor(peerValues.length / 2);
  const median = peerValues.length % 2 === 0 ? (peerValues[mid - 1] + peerValues[mid]) / 2 : peerValues[mid];
  if (median === 0) return null;
  return {
    median,
    value: selfValue,
    deltaPercent: Math.round(((selfValue - median) / median) * 100)
  };
}
