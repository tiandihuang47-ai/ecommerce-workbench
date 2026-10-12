import { randomUUID } from "node:crypto";
import { callCommerceTextJson } from "@/lib/commerce-image-ai";
import { analyzePerformance } from "@/lib/marketing-learning/analysis";
import { formatMetric, goalLabel } from "@/lib/marketing-learning/metrics";
import { marketingLearningStore } from "@/lib/marketing-learning/store";
import type {
  CreativePerformanceSummary,
  DerivedMetric,
  LearningGoal,
  MarketingReview,
  PerformanceAnalysis,
  ReviewEvidence
} from "@/lib/marketing-learning/types";

/**
 * 营销复盘 Agent
 *
 * 只基于真实数据做分析：evidence 全部来自实际指标，AI 只负责组织语言。
 * 不允许把相关性说成因果，不自动修改任何营销规则。
 * 输出是 Recommendation，等待用户人工确认。
 */

export interface ReviewInput {
  creativeIds?: string[];
  experimentId?: string;
  goal?: LearningGoal;
  productId?: string;
}

export interface ReviewDeps {
  callTextJson?: typeof callCommerceTextJson;
}

export async function runMarketingReview(input: ReviewInput = {}, deps: ReviewDeps = {}): Promise<MarketingReview> {
  const analysis = await analyzePerformance({
    creativeIds: input.creativeIds,
    experimentId: input.experimentId,
    goal: input.goal,
    productId: input.productId
  });
  const evidence = buildEvidence(analysis);
  const rule = buildRuleReview(analysis, input);
  let review = rule;
  const caller = deps.callTextJson || callCommerceTextJson;
  if (analysis.sampleSize > 0) {
    try {
      const llm = await callReviewModel(caller, analysis, evidence);
      review = mergeLlmReview(rule, llm);
    } catch {
      review = rule;
    }
  }
  review.reviewId = "review_" + randomUUID();
  /* 证据始终来自真实指标，不由模型生成，保证每个判断可追溯。 */
  review.evidence = evidence;
  return marketingLearningStore.saveReview(review);
}

/** 每个重要判断都能追溯到具体 creative 与指标。 */
export function buildEvidence(analysis: PerformanceAnalysis): ReviewEvidence[] {
  const evidence: ReviewEvidence[] = [];
  for (const summary of analysis.creatives) {
    evidence.push({ creativeId: summary.creativeId, metric: summary.coreMetric.key, value: summary.coreMetric.value, basis: summary.coreMetric.basis });
    for (const metric of topRawMetrics(summary)) {
      evidence.push({ creativeId: summary.creativeId, metric: metric.key, value: metric.value, basis: metric.basis });
    }
  }
  return evidence.slice(0, 40);
}

function topRawMetrics(summary: CreativePerformanceSummary): DerivedMetric[] {
  const keys = ["views", "impressions", "favorites", "productClicks", "orders", "gmv", "favoriteRate", "productClickRate"];
  return summary.metrics.filter((metric) => keys.includes(metric.key));
}

function buildRuleReview(analysis: PerformanceAnalysis, input: ReviewInput): MarketingReview {
  const goal = analysis.goal;
  const ranked = analysis.creatives.filter((item) => item.coreMetric.value !== null);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const strategyTop = analysis.byStrategy[0];
  const strategyBottom = analysis.byStrategy.length > 1 ? analysis.byStrategy[analysis.byStrategy.length - 1] : null;
  const sellingTop = analysis.bySellingPoint[0];
  const layoutTop = analysis.byLayoutType[0];

  const summaryParts = [
    "样本：" + analysis.sampleSize + " 个创意。",
    "目标：" + goalLabel(goal) + "，核心指标：" + (best ? best.coreMetric.label : "数据不足") + "。",
    best ? "当前表现最高的是 " + best.strategyKey + "（" + best.coreMetric.label + " " + formatMetric(best.coreMetric.key, best.coreMetric.value) + "）。" : "当前没有可用于该目标的数据。",
    worst ? "最低的是 " + worst.strategyKey + "。" : ""
  ];

  const whatWorked = [
    strategyTop ? "策略 " + strategyTop.key + " 在 " + strategyTop.sampleSize + " 个创意上核心指标 " + strategyTop.coreMetric.label + " 为 " + formatMetric(strategyTop.coreMetric.key, strategyTop.coreMetric.value) + "。" : "",
    sellingTop ? "主卖点「" + sellingTop.key + "」当前表现最好。" : "",
    layoutTop ? "排版模板 " + layoutTop.key + " 当前表现最好。" : ""
  ].filter(Boolean);

  const whatDidNotWork = [
    strategyBottom && strategyBottom.key !== strategyTop?.key ? "策略 " + strategyBottom.key + " 当前低于 " + strategyTop?.key + "。" : "",
    !best ? "缺少曝光/播放等基础数据，无法计算核心指标。" : ""
  ].filter(Boolean);

  const possibleReasons = [
    "差异可能来自策略本身，也可能来自发布时间、流量分发、账号权重、价格或活动。",
    ranked.length < 2 ? "可比样本不足，暂不能判断哪种策略更好。" : "两种策略可能承担不同业务目标：收藏高不等于商品点击高。"
  ];

  const nextTestRecommendation = [
    best ? "下一轮可继续测试 " + best.strategyKey + "，同时补充 " + goalLabel(goal) + " 相关指标。" : "先补齐曝光、播放等基础数据，再进行复盘。",
    strategyBottom && strategyTop ? "如果要比较策略差异，建议同一商品、同一平台、同一时间范围内各测至少 3 条。" : "建议为同一商品建立 Marketing Experiment，把对比的创意放在一起。",
    analysis.creatives.length && analysis.creatives.every((item) => item.total.orders === null) ? "当前没有成交数据，暂不能判断转化效果。" : "成交类指标缺失时不要下结论，可先补齐商品点击与订单。"
  ].filter(Boolean).slice(0, 3);

  return {
    reviewId: "",
    createdAt: new Date().toISOString(),
    experimentId: input.experimentId || "",
    goal,
    creativeIds: analysis.creatives.map((item) => item.creativeId),
    summary: summaryParts.join(""),
    whatWorked,
    whatDidNotWork,
    possibleReasons,
    strategyObservation: strategyTop
      ? "按策略看，" + analysis.byStrategy.map((item) => item.key + "(" + item.sampleSize + ")=" + formatMetric(item.coreMetric.key, item.coreMetric.value)).join("；") + "。"
      : "暂无可分组的策略数据。",
    copyObservation: sellingTop
      ? "按主卖点看，" + analysis.bySellingPoint.slice(0, 4).map((item) => item.key + "=" + formatMetric(item.coreMetric.key, item.coreMetric.value)).join("；") + "。"
      : "暂无可分组的卖点数据。",
    visualObservation: layoutTop
      ? "按排版模板看，" + analysis.byLayoutType.map((item) => item.key + "=" + formatMetric(item.coreMetric.key, item.coreMetric.value)).join("；") + "。"
      : "暂无可分组的排版数据。",
    productObservation: "本次涉及 " + new Set(analysis.creatives.map((item) => item.productName)).size + " 个商品；跨商品比较时请谨慎。",
    nextTestRecommendation,
    confidence: analysis.sampleSize >= 6 ? "medium" : "low",
    evidence: [],
    sampleSize: analysis.sampleSize,
    platform: analysis.platform,
    timeRange: analysis.timeRange,
    caveats: analysis.caveats,
    source: "rule"
  };
}

async function callReviewModel(
  caller: typeof callCommerceTextJson,
  analysis: PerformanceAnalysis,
  evidence: ReviewEvidence[]
): Promise<Record<string, unknown>> {
  const compact = {
    goal: analysis.goal,
    sampleSize: analysis.sampleSize,
    platform: analysis.platform,
    timeRange: analysis.timeRange,
    creatives: analysis.creatives.map((item) => ({
      creativeId: item.creativeId,
      strategy: item.strategyKey,
      sellingPoint: item.primarySellingPoint,
      layout: item.layoutType,
      core: { key: item.coreMetric.key, value: item.coreMetric.value, basis: item.coreMetric.basis },
      total: item.total
    })),
    byStrategy: analysis.byStrategy.map((item) => ({ key: item.key, sampleSize: item.sampleSize, core: item.coreMetric })),
    bySellingPoint: analysis.bySellingPoint.map((item) => ({ key: item.key, sampleSize: item.sampleSize, core: item.coreMetric })),
    byLayoutType: analysis.byLayoutType.map((item) => ({ key: item.key, sampleSize: item.sampleSize, core: item.coreMetric }))
  };
  return caller<Record<string, unknown>>({
    route: "marketing_review",
    system: [
      "MARKETING_REVIEW。你是电商营销复盘助手，只输出合法 JSON。",
      "只能基于给定的真实数据描述现状，不得把相关性说成因果，不得编造缺失数据。",
      "缺失指标必须说 unavailable。结论要保守，并说明样本量小、平台与时间范围的影响。",
      "不得建议或声称自动修改营销规则；只输出下一轮测试建议。",
      "返回 JSON：{summary,whatWorked:string[],whatDidNotWork:string[],possibleReasons:string[],strategyObservation,copyObservation,visualObservation,productObservation,nextTestRecommendation:string[],confidence}。confidence 只能是 low、medium、high。"
    ].join("\n"),
    user: [
      "真实数据：" + JSON.stringify(compact),
      "可引用证据（必须与之一致，不得新增数字）：" + JSON.stringify(evidence.slice(0, 20))
    ].join("\n"),
    temperature: 0.25,
    maxTokens: 1600
  });
}

function mergeLlmReview(rule: MarketingReview, llm: Record<string, unknown>): MarketingReview {
  const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 6) : [];
  const text = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim().slice(0, 1200) : fallback;
  const confidence = llm.confidence === "medium" || llm.confidence === "high" ? llm.confidence : "low";
  return {
    ...rule,
    summary: text(llm.summary, rule.summary),
    whatWorked: list(llm.whatWorked).length ? list(llm.whatWorked) : rule.whatWorked,
    whatDidNotWork: list(llm.whatDidNotWork).length ? list(llm.whatDidNotWork) : rule.whatDidNotWork,
    possibleReasons: list(llm.possibleReasons).length ? list(llm.possibleReasons) : rule.possibleReasons,
    strategyObservation: text(llm.strategyObservation, rule.strategyObservation),
    copyObservation: text(llm.copyObservation, rule.copyObservation),
    visualObservation: text(llm.visualObservation, rule.visualObservation),
    productObservation: text(llm.productObservation, rule.productObservation),
    nextTestRecommendation: list(llm.nextTestRecommendation).length ? list(llm.nextTestRecommendation) : rule.nextTestRecommendation,
    confidence,
    source: "llm"
  };
}
