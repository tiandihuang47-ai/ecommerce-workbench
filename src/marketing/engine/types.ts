/**
 * 营销生图引擎 · 数据结构定义
 *
 * 这一层只定义各层之间传递的数据形状，不包含任何业务逻辑。
 * 每一层的输入输出都必须能独立序列化、独立调试、独立版本化。
 */

export type MarketingPlatformId = "xiaohongshu" | "douyin" | "ecommerce-detail" | "generic";
export type MarketingBusinessGoal = "traffic" | "conversion" | "trust" | "engagement";

/** 配置层：一条营销策略（来自 src/marketing/strategies/*.md）。 */
export interface MarketingStrategyConfig {
  id: string;
  label: string;
  version: string;
  active: boolean;
  kind: "image_text" | "detail_page";
  platforms: string[];
  businessGoals: string[];
  creativeType: string;
  defaultTextRequired: boolean;
  comparisonRequired: boolean;
  matchKeywords: string[];
  focusTags: string[];
  priority: number;
  defaultPainPoint?: string;
  defaultHook?: string;
  defaultVisual?: string;
  structure: string[];
  requiredElements: string[];
  file: string;
  guidance: string;
  sections: Array<{ title: string; content: string }>;
}

/** 配置层：平台风格（来自 src/marketing/platforms/*.md）。 */
export interface MarketingPlatformConfig {
  id: string;
  label: string;
  version: string;
  platforms?: string[];
  tone: string;
  headlineMaxChars: number;
  bodyMaxChars: number;
  emojiLevel: string;
  textRequiredByDefault: boolean;
  copyRules: string[];
  visualRules: string[];
  forbidden: string[];
  file: string;
  guidance: string;
  sections: Array<{ title: string; content: string }>;
}

/** 配置层：文案规则（来自 src/marketing/copy/*.md）。 */
export interface MarketingCopyConfig {
  id: string;
  label: string;
  version: string;
  scope: string;
  [key: string]: unknown;
  file: string;
  guidance: string;
  sections: Array<{ title: string; content: string }>;
}

/** 配置层：质检规则（来自 src/marketing/qa/*.md）。 */
export interface MarketingQaConfig {
  id: string;
  label: string;
  version: string;
  failStatusCode: string;
  checks: Array<{ id: string; label: string; required: boolean; description: string }>;
  file: string;
  guidance: string;
  sections: Array<{ title: string; content: string }>;
}

/** 配置层：商品高保真规则（来自 src/marketing/product-fidelity/fidelity-rules.md）。 */
export interface MarketingFidelityConfig {
  id: string;
  label: string;
  version: string;
  priority: string;
  criticalFeatureLabels: string[];
  mustNotInvent: string[];
  logoRules: string[];
  textOnProductRules: string[];
  colorRules: string[];
  shapeRules: string[];
  file: string;
  guidance: string;
  sections: Array<{ title: string; content: string }>;
}

/** 配置层：中文营销排版规则（来自 src/marketing/typography/typography-rules.md）。 */
export interface MarketingTypographyConfig {
  id: string;
  label: string;
  version: string;
  textMode: string;
  templates: string[];
  headlineMaxChars: number;
  subheadlineMaxChars: number;
  sellingPointMaxChars: number;
  maxSellingPoints: number;
  defaultFontFamily: string;
  palette: Record<string, string | number>;
  geometry: Record<string, Record<string, Record<string, unknown>>>;
  fonts: Record<string, string>;
  file: string;
  guidance: string;
  sections: Array<{ title: string; content: string }>;
}

export interface MarketingConfig {
  contentHash: string;
  generatedAt: string;
  strategies: MarketingStrategyConfig[];
  platforms: MarketingPlatformConfig[];
  copy: MarketingCopyConfig[];
  fidelity: MarketingFidelityConfig;
  typography: MarketingTypographyConfig;
  qa: MarketingQaConfig;
}

/** 第一层：商品事实（只允许来自产品资料或图片可见信息）。 */
export interface MarketingProductTruth {
  productName: string;
  category: string;
  targetAudience: string;
  coreSellingPoints: string[];
  functionalFeatures: string[];
  userBenefits: string[];
  usageScenes: string[];
  priceFacts: string[];
  materials: string[];
  visualConstraints: {
    color: string;
    logo: string;
    mustPreserve: string[];
    forbidden: string[];
  };
  claimsAllowed: string[];
  claimsForbidden: string[];
  sourceEvidence: Array<{ claim: string; sourceName: string; sourceExcerpt: string; confidence: string }>;
  confidence: "confirmed" | "partial" | "empty";
  warnings: string[];
}

/** 第二层：用户意图。 */
export interface MarketingUserIntent {
  platform: MarketingPlatformId;
  businessGoal: MarketingBusinessGoal;
  creativeIntent: string;
  focusSellingPoints: string[];
  textRequired: boolean;
  comparisonRequired: boolean;
  tone: string;
  scene: string;
  referenceMode: "product_reference" | "benchmark_replica" | "none";
  specialRequirements: string[];
  rawRequest: string;
  confidence: "llm" | "rule";
  warnings: string[];
}

/** 第三层：营销策略（回答“这张图应该怎么卖”）。 */
export interface MarketingStrategyPlan {
  id: string;
  label: string;
  version: string;
  sourceFile: string;
  platform: MarketingPlatformId;
  businessGoal: MarketingBusinessGoal;
  creativeType: string;
  targetAudience: string;
  primaryPainPoint: string;
  primarySellingPoint: string;
  secondarySellingPoints: string[];
  hook: string;
  messageHierarchy: string[];
  visualStrategy: string;
  copyStrategy: string;
  ctaStrategy: string;
  textRequired: boolean;
  comparisonRequired: boolean;
  riskWarnings: string[];
  guidance: string[];
  confidence: "llm" | "rule";
}

/** 第四层：创意编排里的单张画面方案。 */
export interface MarketingCreativePanel {
  order: number;
  role: string;
  kind: string;
  title: string;
  visual: string;
  headline: string;
  subheadline: string;
  sellingPointLabels: string[];
  comparisonCopy?: { left: string; right: string };
  cta: string;
  supportingCopy: string;
  textHierarchy: string[];
  productPlacement: string;
  background: string;
  textSafeArea: string;
  copyIntent: string;
}

/** 第四层：创意编排计划。 */
export interface MarketingCreativePlan {
  version: string;
  summary: string;
  panels: MarketingCreativePanel[];
  publishTitle: string;
  publishBody: string;
  tags: string[];
  confidence: "llm" | "rule";
  warnings: string[];
}

/** 商品高保真层：只描述必须锁定的商品特征与禁区。 */
export interface MarketingProductFidelityPlan {
  version: string;
  criticalFeatures: string[];
  mustPreserve: string[];
  mustNotInvent: string[];
  logoRules: string[];
  textOnProductRules: string[];
  colorRules: string[];
  shapeRules: string[];
  hardConstraints: string[];
  confidence: "confirmed" | "derived";
}

/** 中文营销排版的单个文字层（相对画布坐标）。 */
export interface MarketingTypographyLayer {
  id: string;
  role: "headline" | "subheadline" | "selling_point" | "comparison_left" | "comparison_right" | "cta";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700 | 800 | 900;
  lineHeight: number;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  align: "left" | "center" | "right";
  fontFamily: "sans" | "serif" | "rounded";
}

/** 中文营销排版层：程序渲染，不交给生图模型。 */
export interface MarketingTypographyPlan {
  version: string;
  template: string;
  textMode: "overlay" | "model";
  textRequired: boolean;
  layers: MarketingTypographyLayer[];
  plannedText: string[];
  warnings: string[];
}

/** 第五层：Prompt 编译结果。 */
export interface MarketingCompiledPrompt {
  version: string;
  provider: string;
  panelId: string;
  text: string;
  sections: Array<{ id: string; title: string; content: string }>;
  textRequired: boolean;
}

/** 第七层：营销质检。 */
export type MarketingQaStatus =
  | "PASS"
  | "WARN"
  | "MARKETING_INTENT_FAILED"
  | "PRODUCT_FIDELITY_FAILED"
  | "TEXT_REQUIRED_MISSING"
  | "INFORMATION_OVERLOAD"
  | "COPY_MISMATCH"
  | "MODEL_TEXT_LEAKED"
  | "UNAVAILABLE";

export interface MarketingQaCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "unavailable";
  detail: string;
}

export interface MarketingQaResult {
  version: string;
  status: MarketingQaStatus;
  checks: MarketingQaCheck[];
  failedChecks: string[];
  summary: string;
  textRequired: boolean;
  textDetected: boolean | null;
  /** 生图 API 成功不等于营销任务成功；这里只表示营销任务是否达标。 */
  marketingTaskSuccess: boolean;
  source: "rule" | "vision" | "hybrid";
  checkedAt: string;
}

/** 版本记录：每次任务都能追问“当时用的是哪个版本”。 */
export interface MarketingVersionRecord {
  engine: string;
  strategyConfigHash: string;
  productTruth: string;
  intent: string;
  strategy: string;
  platform: string;
  copy: string;
  creative: string;
  productFidelity: string;
  typography: string;
  promptCompiler: string;
  qa: string;
}

/** 整条营销链路的可观测记录。 */
export interface MarketingPipelineRecord {
  pipelineVersion: string;
  versions: MarketingVersionRecord;
  productTruth: MarketingProductTruth;
  intent: MarketingUserIntent;
  strategy: MarketingStrategyPlan;
  creativePlan: MarketingCreativePlan;
  productFidelity: MarketingProductFidelityPlan;
  typography: MarketingTypographyPlan;
  promptPreview: string;
  promptProvider: string;
  qa?: MarketingQaResult;
  /** 明确区分：生图 API 成功 ≠ 营销任务成功。 */
  success?: {
    imageGeneration: boolean;
    marketingTask: boolean;
  };
  warnings: string[];
  updatedAt: string;
}

/** 引擎输入：与运行环境解耦，方便单测和 dry-run。 */
export interface MarketingPipelineInput {
  kind: "detail_page" | "douyin_post" | "xiaohongshu_post" | "retouch" | "free_chat";
  productName: string;
  category: string;
  targetAudience: string;
  sellingPoints: string;
  scene: string;
  style: string;
  rawRequest: string;
  cardCount: number;
  brand: { primaryColor: string; secondaryColor: string };
  productFacts: Array<{ label: string; value: string; sourceName: string; sourceExcerpt: string; confidence: string }>;
  documentText: string;
  referenceText: string;
  hasBenchmark: boolean;
  benchmarkSummary: string;
  strategyHint: string;
}

export type MarketingTextCaller = <T>(options: {
  /** 业务 Route（config/model-routing.yaml）；营销各层各自指定。 */
  route?: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}) => Promise<T>;

export interface MarketingPipelineDeps {
  callTextJson?: MarketingTextCaller;
  useLlm?: boolean;
  provider?: string;
  signal?: AbortSignal;
}
