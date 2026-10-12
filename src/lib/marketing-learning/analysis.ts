import {
  aggregatePerformance,
  chooseComparableMetricKey,
  coreMetricForGoal,
  deriveMetrics,
  goalLabel,
  metricByKey,
  priorityKeysForGoal
} from "@/lib/marketing-learning/metrics";
import { marketingLearningStore } from "@/lib/marketing-learning/store";
import type {
  CreativePerformanceSummary,
  CreativeRecord,
  DerivedMetric,
  GroupSummary,
  LearningGoal,
  PerformanceAnalysis,
  PerformanceRecord
} from "@/lib/marketing-learning/types";

/**
 * 营销学习闭环 · 表现分析（V1 只做简单统计，不做机器学习）
 *
 * 必须按业务目标看对应核心指标，不能统一用点赞量判断所有内容。
 * 只描述「当前已有数据里谁更高」，不给绝对结论，并附带样本量与时间范围。
 */

export interface AnalyzeOptions {
  goal?: LearningGoal;
  platform?: string;
  productId?: string;
  experimentId?: string;
  creativeIds?: string[];
}

export async function analyzePerformance(options: AnalyzeOptions = {}): Promise<PerformanceAnalysis> {
  const goal = options.goal || "traffic";
  let creatives = await marketingLearningStore.listCreatives();
  let platform = options.platform || "";

  if (options.experimentId) {
    const experiment = await marketingLearningStore.getExperiment(options.experimentId);
    if (experiment) {
      const ids = new Set(experiment.creativeIds);
      creatives = creatives.filter((item) => ids.has(item.creativeId));
      platform = platform || experiment.platform;
    }
  }
  if (options.creativeIds && options.creativeIds.length) {
    const ids = new Set(options.creativeIds);
    creatives = creatives.filter((item) => ids.has(item.creativeId));
  }
  if (options.productId) creatives = creatives.filter((item) => item.productId === options.productId);
  if (options.platform) creatives = creatives.filter((item) => item.platform === options.platform);

  const allPerformance = await marketingLearningStore.listPerformance();
  const byCreative = new Map<string, PerformanceRecord[]>();
  for (const record of allPerformance) {
    if (record.sourceType !== "own") continue;
    const list = byCreative.get(record.creativeId) || [];
    list.push(record);
    byCreative.set(record.creativeId, list);
  }

  const withData = creatives.filter((item) => (byCreative.get(item.creativeId) || []).length > 0);
  const metricLists = withData.map((item) => deriveMetrics(aggregatePerformance(byCreative.get(item.creativeId) as PerformanceRecord[])));
  const comparableKey = chooseComparableMetricKey(metricLists, goal);

  const summaries: CreativePerformanceSummary[] = withData.map((creative, index) => {
    const records = byCreative.get(creative.creativeId) as PerformanceRecord[];
    const total = aggregatePerformance(records);
    const metrics = metricLists[index];
    const core = metricByKey(metrics, comparableKey) || coreMetricForGoal(metrics, goal);
    return {
      creativeId: creative.creativeId,
      productName: creative.productName,
      platform: creative.platform,
      strategyKey: creative.strategyKey,
      strategyVersion: creative.strategyVersion,
      primarySellingPoint: creative.primarySellingPoint,
      layoutType: creative.layoutType,
      goal,
      coreMetric: core,
      metrics,
      recordCount: records.length,
      total,
      timeRange: timeRangeOf(records),
      outputImageUrl: creative.outputImageUrl
    };
  }).sort((a, b) => compareMetricDesc(a.coreMetric.value, b.coreMetric.value));

  const byStrategy = groupSummaries(withData, byCreative, comparableKey, (item) => item.strategyKey, (item) => item.strategyKey);
  const bySellingPoint = groupSummaries(withData, byCreative, comparableKey, (item) => item.primarySellingPoint || "未标注", (item) => item.primarySellingPoint || "未标注");
  const byLayoutType = groupSummaries(withData, byCreative, comparableKey, (item) => item.layoutType || "未标注", (item) => item.layoutType || "未标注");

  const recordsWithData = withData.flatMap((item) => byCreative.get(item.creativeId) as PerformanceRecord[]);
  const core = priorityKeysForGoal(goal)[0];
  const caveats = [
    "样本量：" + withData.length + " 个创意 / " + recordsWithData.length + " 条数据；样本较小时结论不稳定。",
    "数据可能受账号、发布时间、流量分发、价格与活动影响，相关性不等于因果。",
    "建议优先比较同一商品、同一平台、同一时间范围内的创意。",
    metricLists.some((list) => (metricByKey(list, core)?.value ?? null) !== null)
      ? "当前目标「" + goalLabel(goal) + "」使用的是核心指标：" + (metricByKey(metricLists[0] || [], comparableKey)?.label || comparableKey) + "。"
      : "当前目标「" + goalLabel(goal) + "」缺少核心指标数据，暂时无法排序。"
  ];

  return {
    generatedAt: new Date().toISOString(),
    goal,
    platform,
    sampleSize: withData.length,
    timeRange: timeRangeOf(recordsWithData),
    creatives: summaries,
    byStrategy,
    bySellingPoint,
    byLayoutType,
    caveats
  };
}

export async function compareExperiment(experimentId: string, goal?: LearningGoal) {
  const experiment = await marketingLearningStore.getExperiment(experimentId);
  if (!experiment) throw new Error("没有找到这个营销实验。");
  const analysis = await analyzePerformance({ experimentId, goal: goal || experiment.goal });
  return { experiment, analysis };
}

function groupSummaries(
  creatives: CreativeRecord[],
  byCreative: Map<string, PerformanceRecord[]>,
  comparableKey: string,
  keyOf: (creative: CreativeRecord) => string,
  labelOf: (creative: CreativeRecord) => string
): GroupSummary[] {
  const groups = new Map<string, CreativeRecord[]>();
  for (const creative of creatives) {
    const key = keyOf(creative) || "未标注";
    const list = groups.get(key) || [];
    list.push(creative);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, members]) => {
    const records = members.flatMap((item) => byCreative.get(item.creativeId) as PerformanceRecord[]);
    const metrics = deriveMetrics(aggregatePerformance(records));
    const core = metricByKey(metrics, comparableKey) || coreMetricForGoal(metrics, "traffic");
    return { key, label: labelOf(members[0]), sampleSize: members.length, coreMetric: core, metrics } as GroupSummary;
  }).sort((a, b) => compareMetricDesc(a.coreMetric.value, b.coreMetric.value));
}

function timeRangeOf(records: PerformanceRecord[]) {
  const dates = records.map((item) => item.publishedAt || item.dataCapturedAt || item.createdAt).filter(Boolean).sort();
  return { from: dates[0] || "", to: dates[dates.length - 1] || "" };
}

/** 降序：有值的排前面，unavailable 排最后。 */
function compareMetricDesc(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** 供 UI 直接展示的一行摘要（含 unavailable 说明）。 */
export function summarizeAnalysisLine(summary: CreativePerformanceSummary) {
  return summary.strategyKey + " · " + summary.coreMetric.label + " " + describeMetric(summary.coreMetric);
}

export function describeMetric(metric: DerivedMetric) {
  if (metric.value === null) return "unavailable（" + metric.basis + "）";
  return String(metric.value);
}
