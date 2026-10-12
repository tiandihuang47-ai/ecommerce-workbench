import type {
  CreativeRecord,
  DerivedMetric,
  Experiment,
  LearningGoal,
  MarketingReview,
  PerformanceAnalysis,
  PerformanceMetrics,
  PerformanceRecord
} from "@/lib/marketing-learning/types";

/**
 * 营销学习闭环 · 前端数据访问
 *
 * UI 只调用这里，不直接碰 localStorage / 文件 / 具体存储 key。
 * 以后换数据库，只改服务端实现，UI 不用动。
 */

export interface CreativeHistoryApiItem {
  creative: CreativeRecord;
  performance: {
    recordCount: number;
    total: PerformanceMetrics;
    metrics: DerivedMetric[];
    coreMetric: DerivedMetric;
    timeRange: { from: string; to: string };
  } | null;
}

export interface CreativeDetailApi {
  creative: CreativeRecord;
  performance: PerformanceRecord[];
  reviews: MarketingReview[];
}

export interface LearningOverviewApi {
  creativeCount: number;
  performanceCount: number;
  experimentCount: number;
  reviewCount: number;
  platformBreakdown: Record<string, number>;
  strategyBreakdown: Record<string, number>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { success?: boolean; message?: string };
  if (!response.ok || payload.success === false) throw new Error(payload.message || "请求失败（" + response.status + "）");
  return payload;
}

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function fetchHistory(params: { platform?: string; productId?: string; strategyKey?: string; taskId?: string } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const suffix = query.toString() ? "?" + query.toString() : "";
  return request<{ history: CreativeHistoryApiItem[] }>("/api/marketing-learning/creatives" + suffix);
}

export function fetchOverview() {
  return request<{ overview: LearningOverviewApi }>("/api/marketing-learning/creatives?overview=1");
}

export function fetchCreativeDetail(creativeId: string) {
  return request<CreativeDetailApi>("/api/marketing-learning/creatives/" + encodeURIComponent(creativeId));
}

export function postPerformance(body: Record<string, unknown>) {
  return request<{ record: PerformanceRecord; message: string }>("/api/marketing-learning/performance", json(body));
}

export function previewCsv(text: string) {
  return request<{ preview: { headers: string[]; sampleRows: string[][]; totalRows: number; suggestedMapping: Record<string, string>; metricKeys: string[] } }>(
    "/api/marketing-learning/performance/csv",
    json({ action: "preview", text })
  );
}

export function importCsv(body: Record<string, unknown>) {
  return request<{ result: { imported: number; skipped: number; errors: string[] }; message: string }>(
    "/api/marketing-learning/performance/csv",
    json({ action: "import", ...body })
  );
}

export function fetchExperiments() {
  return request<{ experiments: Array<Experiment & { creativeCount: number; productName: string }> }>("/api/marketing-learning/experiments");
}

export function createExperiment(body: { name: string; goal: LearningGoal; creativeIds: string[]; notes?: string }) {
  return request<{ experiment: Experiment; message: string }>("/api/marketing-learning/experiments", json(body));
}

export function runReview(body: { creativeIds?: string[]; experimentId?: string; goal?: LearningGoal }) {
  return request<{ review: MarketingReview }>("/api/marketing-learning/review", json(body));
}

export function fetchAnalysis(params: { experimentId?: string; goal?: LearningGoal; creativeIds?: string[] } = {}) {
  const query = new URLSearchParams();
  if (params.experimentId) query.set("experimentId", params.experimentId);
  if (params.goal) query.set("goal", params.goal);
  if (params.creativeIds?.length) query.set("creativeIds", params.creativeIds.join(","));
  return request<{ analysis?: PerformanceAnalysis; experiment?: Experiment }>("/api/marketing-learning/analysis?" + query.toString());
}
