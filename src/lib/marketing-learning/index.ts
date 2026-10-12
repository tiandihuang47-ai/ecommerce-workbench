import { marketingLearningStore } from "@/lib/marketing-learning/store";
import { aggregatePerformance, coreMetricForGoal, deriveMetrics, priorityKeysForGoal } from "@/lib/marketing-learning/metrics";
import type {
  CreativeRecord,
  LearningGoal,
  PerformanceRecord
} from "@/lib/marketing-learning/types";

export * from "@/lib/marketing-learning/types";
export * from "@/lib/marketing-learning/metrics";
export {
  marketingLearningStore,
  learningDataRoot,
  type MarketingLearningStore,
  type CreativeQuery
} from "@/lib/marketing-learning/store";
export { recordCreativeForVersion, buildCreativeRecord, syncTaskCreatives } from "@/lib/marketing-learning/creative";
export {
  createPerformanceRecord,
  parseCsvText,
  previewCsv,
  importPerformanceCsv,
  suggestCsvMapping,
  type ManualPerformanceInput,
  type CsvImportInput
} from "@/lib/marketing-learning/performance";
export { analyzePerformance, compareExperiment, describeMetric } from "@/lib/marketing-learning/analysis";
export { runMarketingReview, buildEvidence, type ReviewInput } from "@/lib/marketing-learning/review";
export { createExperiment, listExperiments, type CreateExperimentInput } from "@/lib/marketing-learning/experiments";

function goalFromBusinessGoal(value: string): LearningGoal {
  if (value === "conversion" || value === "trust") return "conversion";
  if (value === "engagement") return "engagement";
  return "traffic";
}

export interface CreativeHistoryItem {
  creative: CreativeRecord;
  performance: {
    recordCount: number;
    total: PerformanceRecord["metrics"];
    metrics: ReturnType<typeof deriveMetrics>;
    coreMetric: ReturnType<typeof coreMetricForGoal>;
    timeRange: { from: string; to: string };
  } | null;
}

export interface CreativeHistoryFilter {
  platform?: string;
  productId?: string;
  strategyKey?: string;
  taskId?: string;
  limit?: number;
}

/** 营销历史：所有 Creative，有数据就带上基础表现（UI 直接用）。 */
export async function getCreativeHistory(filter: CreativeHistoryFilter = {}): Promise<CreativeHistoryItem[]> {
  const creatives = await marketingLearningStore.queryCreatives({
    platform: filter.platform,
    productId: filter.productId,
    strategyKey: filter.strategyKey,
    taskId: filter.taskId
  });
  const allPerformance = await marketingLearningStore.listPerformance();
  const byCreative = new Map<string, PerformanceRecord[]>();
  for (const record of allPerformance) {
    const list = byCreative.get(record.creativeId) || [];
    list.push(record);
    byCreative.set(record.creativeId, list);
  }
  const items = creatives.map((creative) => {
    const records = byCreative.get(creative.creativeId) || [];
    if (!records.length) return { creative, performance: null };
    const total = aggregatePerformance(records);
    const metrics = deriveMetrics(total);
    const goal = goalFromBusinessGoal(creative.businessGoal);
    const coreMetric = coreMetricForGoal(metrics, goal);
    const dates = records.map((item) => item.publishedAt || item.dataCapturedAt || item.createdAt).filter(Boolean).sort();
    return {
      creative,
      performance: {
        recordCount: records.length,
        total,
        metrics,
        coreMetric,
        timeRange: { from: dates[0] || "", to: dates[dates.length - 1] || "" }
      }
    };
  });
  return filter.limit ? items.slice(0, filter.limit) : items;
}

export async function getCreativeDetail(creativeId: string) {
  const creative = await marketingLearningStore.getCreative(creativeId);
  if (!creative) return null;
  const performance = await marketingLearningStore.listPerformance({ creativeId });
  const reviews = await marketingLearningStore.listReviews({ creativeId });
  return { creative, performance, reviews };
}

export async function learningOverview() {
  const [creatives, performance, experiments, reviews] = await Promise.all([
    marketingLearningStore.listCreatives(),
    marketingLearningStore.listPerformance(),
    marketingLearningStore.listExperiments(),
    marketingLearningStore.listReviews()
  ]);
  return {
    creativeCount: creatives.length,
    performanceCount: performance.length,
    experimentCount: experiments.length,
    reviewCount: reviews.length,
    platformBreakdown: countBy(creatives.map((item) => item.platform)),
    strategyBreakdown: countBy(creatives.map((item) => item.strategyKey))
  };
}

export function marketingGoalForCreative(creative: CreativeRecord): LearningGoal {
  return goalFromBusinessGoal(creative.businessGoal);
}

export function priorityMetricKeys(goal: LearningGoal) {
  return priorityKeysForGoal(goal);
}

function countBy(values: string[]) {
  const result: Record<string, number> = {};
  for (const value of values) result[value || "unknown"] = (result[value || "unknown"] || 0) + 1;
  return result;
}
