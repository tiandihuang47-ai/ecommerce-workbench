import type {
  MarketingCreativePlan,
  MarketingPipelineRecord,
  MarketingProductFidelityPlan,
  MarketingProductTruth,
  MarketingQaResult,
  MarketingTypographyPlan,
  MarketingUserIntent
} from "@/marketing/engine/types";

/**
 * 营销学习闭环 V1 · 数据模型
 *
 * 创意数据血缘（Creative Lineage）：一张最终图片从何而来、为什么这样生成。
 * 这里只定义结构，不做存储，不依赖任何运行时环境。
 */

/** 创意来源：V1 只真正使用 own_generated，其余为架构预留。 */
export type CreativeSourceType = "own_generated" | "own_manual" | "competitor" | "reference";
/** 数据来源：手工录入 / CSV / 未来 API 连接器。 */
export type PerformanceSource = "manual" | "csv" | "api";
/** 业务目标，决定复盘时看哪个核心指标。 */
export type LearningGoal = "traffic" | "engagement" | "product_click" | "conversion";

export interface LearningAssetRef {
  id: string;
  role: string;
  name: string;
  url?: string;
}

/** 一张最终图片的完整创意记录。creativeId 是唯一关联 ID。 */
export interface CreativeRecord {
  creativeId: string;
  createdAt: string;
  updatedAt: string;
  sourceType: CreativeSourceType;

  /** 来源任务/画面/版本：保留原体系，creativeId 不是批次 ID。 */
  taskId: string;
  panelId: string;
  versionId: string;
  setId: string;

  productId: string;
  productName: string;
  category: string;
  platform: string;
  businessGoal: string;
  userRequest: string;
  consumerInsight: string;

  /** 营销策略层信息。 */
  marketingStrategy: string;
  strategyKey: string;
  strategyVersion: string;
  skillsUsed: string[];
  primaryPainPoint: string;
  primarySellingPoint: string;
  secondarySellingPoints: string[];
  headline: string;
  subheadline: string;
  cta: string;
  creativePlan: MarketingCreativePlan | null;
  layoutType: string;
  compiledPrompt: string;

  /** 规则版本：未来才能回答「V1 策略 vs V2 策略哪个更好」。 */
  engineVersion: string;
  strategyConfigHash: string;
  productTruthVersion: string;
  intentVersion: string;
  creativeVersion: string;
  promptCompilerVersion: string;
  productFidelityVersion: string;
  typographyVersion: string;
  copyRuleVersion: string;
  platformRuleVersion: string;
  qaVersion: string;

  /** 生成层信息。 */
  provider: string;
  model: string;
  aspectRatio: string;
  generationCount: number;
  sourceProductAssets: LearningAssetRef[];
  referenceAssets: LearningAssetRef[];
  outputImageAssetId: string;
  outputImagePath: string;
  outputImageUrl: string;
  generationStatus: string;
  qaResult: MarketingQaResult | null;
  marketingTaskSuccess: boolean | null;

  /** 为未来检索（RAG）与同行比较预留的可搜索字段。 */
  tags: string[];
  accountBaseline: AccountBaseline | null;

  /** 完整链路快照，便于复盘时回看。 */
  productTruth: MarketingProductTruth | null;
  intent: MarketingUserIntent | null;
  productFidelity: MarketingProductFidelityPlan | null;
  typography: MarketingTypographyPlan | null;
}

/** 账号基准：未来同行比较不能只看绝对数。 */
export interface AccountBaseline {
  accountId: string;
  avgImpressions: number | null;
  avgEngagement: number | null;
  capturedAt: string;
}

export interface PerformanceMetrics {
  impressions: number | null;
  views: number | null;
  clicks: number | null;
  productClicks: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  favorites: number | null;
  follows: number | null;
  orders: number | null;
  gmv: number | null;
  watchTimeMs: number | null;
  avgWatchMs: number | null;
  completionRate: number | null;
}

/** 发布后的真实市场反馈；与 CreativeRecord 解耦，可后补。 */
export interface PerformanceRecord {
  performanceId: string;
  creativeId: string;
  sourceType: "own" | "competitor" | "reference";
  platform: string;
  postId: string;
  postUrl: string;
  publishedAt: string;
  dataCapturedAt: string;
  metrics: PerformanceMetrics;
  rawMetrics: Record<string, number | string>;
  source: PerformanceSource;
  accountBaseline: AccountBaseline | null;
  notes: string;
  createdAt: string;
  /** 数据口径：累计快照（默认）或区间增量；旧记录缺省=口径待确认（按累计处理并标注） */
  metricType?: "cumulative" | "increment";
  /** 增量口径的区间起止 */
  periodStart?: string;
  periodEnd?: string;
  /** 内容账号标识（与登录账号无关） */
  contentAccount?: string;
  /** 去重指纹：同文件/同作品同采集时间重复导入时跳过 */
  dedupFingerprint?: string;
  /** 观察窗口天数 */
  observationWindowDays?: number;
  /** 自然/付费流量标识 */
  trafficType?: "natural" | "paid" | "mixed";
  /** 表现评价来源：旧记录自动阈值=auto_legacy；人工=manual；相对值=relative；缺省=未评价 */
  performanceLevelSource?: "auto_legacy" | "manual" | "relative";
}

/** 一组用于比较的 Creative（轻量分组，不是 A/B 系统）。 */
export interface Experiment {
  experimentId: string;
  name: string;
  productId: string;
  platform: string;
  goal: LearningGoal;
  creativeIds: string[];
  createdAt: string;
  notes: string;
}

export interface DerivedMetric {
  key: string;
  label: string;
  value: number | null;
  basis: string;
}

export interface CreativePerformanceSummary {
  creativeId: string;
  productName: string;
  platform: string;
  strategyKey: string;
  strategyVersion: string;
  primarySellingPoint: string;
  layoutType: string;
  goal: LearningGoal;
  coreMetric: DerivedMetric;
  metrics: DerivedMetric[];
  recordCount: number;
  total: PerformanceMetrics;
  timeRange: { from: string; to: string };
  outputImageUrl: string;
}

export interface GroupSummary {
  key: string;
  label: string;
  sampleSize: number;
  coreMetric: DerivedMetric;
  metrics: DerivedMetric[];
}

export interface PerformanceAnalysis {
  generatedAt: string;
  goal: LearningGoal;
  platform: string;
  sampleSize: number;
  timeRange: { from: string; to: string };
  creatives: CreativePerformanceSummary[];
  byStrategy: GroupSummary[];
  bySellingPoint: GroupSummary[];
  byLayoutType: GroupSummary[];
  caveats: string[];
}

export interface ReviewEvidence {
  creativeId: string;
  metric: string;
  value: number | null;
  basis: string;
}

export interface MarketingReview {
  reviewId: string;
  createdAt: string;
  experimentId: string;
  goal: LearningGoal;
  creativeIds: string[];
  summary: string;
  whatWorked: string[];
  whatDidNotWork: string[];
  possibleReasons: string[];
  strategyObservation: string;
  copyObservation: string;
  visualObservation: string;
  productObservation: string;
  nextTestRecommendation: string[];
  confidence: "low" | "medium" | "high";
  evidence: ReviewEvidence[];
  sampleSize: number;
  platform: string;
  timeRange: { from: string; to: string };
  caveats: string[];
  source: "llm" | "rule";
}

export interface CreateCreativeOptions {
  taskId: string;
  panelId: string;
  versionId: string;
  setId: string;
  marketing: MarketingPipelineRecord;
  identity: CreativeIdentity;
}

export interface CreativeIdentity {
  productId: string;
  productName: string;
  category: string;
  platform: string;
  businessGoal: string;
  userRequest: string;
  consumerInsight: string;
  provider: string;
  model: string;
  aspectRatio: string;
  generationCount: number;
  sourceProductAssets: LearningAssetRef[];
  referenceAssets: LearningAssetRef[];
  outputImageAssetId: string;
  outputImagePath: string;
  outputImageUrl: string;
  generationStatus: string;
  strategyLabel: string;
  strategyKey: string;
  strategyVersion: string;
  skillsUsed: string[];
  primaryPainPoint: string;
  primarySellingPoint: string;
  secondarySellingPoints: string[];
  headline: string;
  subheadline: string;
  cta: string;
  creativePanel: MarketingCreativePlan["panels"][number] | null;
  layoutType: string;
  compiledPrompt: string;
  quality: MarketingQaResult | null;
  marketingTaskSuccess: boolean | null;
}
