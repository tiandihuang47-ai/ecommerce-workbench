import { getMarketingCopy, getMarketingPlatform, getMarketingStrategy, listMarketingStrategies } from "@/marketing/engine/config";
import type {
  MarketingPipelineDeps,
  MarketingPipelineInput,
  MarketingProductTruth,
  MarketingStrategyConfig,
  MarketingStrategyPlan,
  MarketingUserIntent
} from "@/marketing/engine/types";

/**
 * 第三层 · 营销策略层（最重要）
 *
 * 回答的不是“怎么画”，而是“这张图应该怎么卖”。
 * 策略内容来自 src/marketing/strategies/*.md 配置；本文件只负责
 * 选择策略 + 结合真实商品事实把它实例化成一张图的营销方案。
 *
 * 策略文件定义原则、逻辑、结构、禁忌与成功标准；具体的痛点、卖点、
 * 标题方向仍由模型结合商品和用户动态发挥，不是死模板。
 */

export function selectStrategyConfig(intent: MarketingUserIntent): MarketingStrategyConfig {
  const all = listMarketingStrategies();
  return all.find((item) => item.id === intent.creativeIntent)
    || all.find((item) => item.id === "scenario_hook")
    || all[0];
}

export function buildStrategyPlanFallback(
  config: MarketingStrategyConfig,
  truth: MarketingProductTruth,
  intent: MarketingUserIntent
): MarketingStrategyPlan {
  const primarySellingPoint = intent.focusSellingPoints[0] || truth.coreSellingPoints[0] || truth.productName;
  const secondary = (intent.focusSellingPoints.length > 1 ? intent.focusSellingPoints.slice(1) : truth.coreSellingPoints).filter((point) => point !== primarySellingPoint).slice(0, 3);
  const strategySection = config.sections.find((section) => /文案/.test(section.title));
  return {
    id: config.id,
    label: config.label,
    version: config.version,
    sourceFile: config.file,
    platform: intent.platform,
    businessGoal: intent.businessGoal,
    creativeType: config.creativeType,
    targetAudience: truth.targetAudience,
    primaryPainPoint: safeText(config.defaultPainPoint, 160) || "用户选择这类商品时的典型顾虑",
    primarySellingPoint,
    secondarySellingPoints: secondary,
    hook: safeText(config.defaultHook, 160) || primarySellingPoint,
    messageHierarchy: (config.structure || []).slice(0, 6),
    visualStrategy: safeText(config.defaultVisual, 300) || "围绕真实商品安排场景、光线与构图",
    copyStrategy: strategySection?.content.slice(0, 400) || config.guidance.slice(0, 400),
    ctaStrategy: safeText(getCtaRule(intent.platform), 160),
    textRequired: intent.textRequired,
    comparisonRequired: intent.comparisonRequired || Boolean(config.comparisonRequired),
    riskWarnings: truth.claimsForbidden.slice(0, 8),
    guidance: (config.sections || []).map((section) => section.title + "：" + section.content).slice(0, 8),
    confidence: "rule"
  };
}

/** 可选：让文本模型结合商品事实实例化策略；失败时回退规则结果。 */
export async function refineStrategyWithLlm(
  base: MarketingStrategyPlan,
  config: MarketingStrategyConfig,
  truth: MarketingProductTruth,
  intent: MarketingUserIntent,
  input: MarketingPipelineInput,
  deps: MarketingPipelineDeps
): Promise<MarketingStrategyPlan> {
  if (!deps.useLlm || !deps.callTextJson) return base;
  try {
    const platform = getMarketingPlatform(intent.platform);
    const copyRules = ["headline-rules", "selling-point-rules", "cta-rules"]
      .map((id) => getMarketingCopy(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => item.label + "：" + item.guidance.slice(0, 300));
    const draft = await deps.callTextJson<Record<string, unknown>>({
      route: "marketing_strategy",
      system: [
        "MARKETING_STRATEGY。你是电商营销策略师，只输出合法 JSON。",
        "你只决定“这张图应该怎么卖”，不写摄影提示词。",
        "只能使用给定的真实商品事实，不得编造价格、销量、认证、功效、检测报告或用户评价。",
        "策略框架：" + config.label + "。" + config.guidance.slice(0, 1600),
        platform ? "平台风格：" + platform.label + "。" + platform.guidance.slice(0, 500) : "",
        copyRules.join("\n")
      ].filter(Boolean).join("\n"),
      user: [
        "返回 JSON：{primaryPainPoint,primarySellingPoint,secondarySellingPoints:string[],hook,messageHierarchy:string[],visualStrategy,copyStrategy,ctaStrategy,riskWarnings:string[]}。",
        "商品：" + truth.productName + "（" + truth.category + "）",
        "目标人群：" + truth.targetAudience,
        "真实卖点（只能从这里选）：" + truth.coreSellingPoints.join("；"),
        "用户重点卖点：" + intent.focusSellingPoints.join("；"),
        "用户原话：" + (input.rawRequest || "（没有补充）"),
        "平台：" + intent.platform + "；目标：" + intent.businessGoal + "；是否需要文字：" + String(intent.textRequired),
        "竞品/对标：" + (input.benchmarkSummary || "无")
      ].join("\n"),
      temperature: 0.35,
      maxTokens: 1600,
      signal: deps.signal
    });
    return mergeStrategy(base, draft);
  } catch {
    return base;
  }
}

function mergeStrategy(base: MarketingStrategyPlan, draft: Record<string, unknown>): MarketingStrategyPlan {
  const secondary = stringList(draft.secondarySellingPoints);
  return {
    ...base,
    primaryPainPoint: safeText(draft.primaryPainPoint, 200) || base.primaryPainPoint,
    primarySellingPoint: safeText(draft.primarySellingPoint, 160) || base.primarySellingPoint,
    secondarySellingPoints: secondary.length ? secondary.slice(0, 4) : base.secondarySellingPoints,
    hook: safeText(draft.hook, 200) || base.hook,
    messageHierarchy: stringList(draft.messageHierarchy).length ? stringList(draft.messageHierarchy).slice(0, 6) : base.messageHierarchy,
    visualStrategy: safeText(draft.visualStrategy, 400) || base.visualStrategy,
    copyStrategy: safeText(draft.copyStrategy, 500) || base.copyStrategy,
    ctaStrategy: safeText(draft.ctaStrategy, 200) || base.ctaStrategy,
    riskWarnings: stringList(draft.riskWarnings).length ? stringList(draft.riskWarnings).slice(0, 8) : base.riskWarnings,
    confidence: "llm"
  };
}

function getCtaRule(platform: string) {
  const config = getMarketingCopy("cta-rules");
  const styles = config?.styles as Record<string, string> | undefined;
  return styles?.[platform] || "按需选择";
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 8) : [];
}

function safeText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
