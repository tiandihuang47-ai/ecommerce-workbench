import { getMarketingPlatform } from "@/marketing/engine/config";
import { generateCopywritingJson } from "@/lib/copywriting-service";
import type {
  MarketingCreativePanel,
  MarketingCreativePlan,
  MarketingPipelineDeps,
  MarketingPipelineInput,
  MarketingProductTruth,
  MarketingStrategyPlan,
  MarketingUserIntent
} from "@/marketing/engine/types";

/**
 * 第四层 · 创意编排层
 *
 * 把营销策略翻译成一张张具体画面方案：画面类型、左右结构、主标题、
 * 副标题、卖点标签、对比文案、行动引导、商品位置、背景与文字安全区。
 *
 * 文案是独立能力，字段拆开存放，以后只想改文案时只改这一层或文案规则。
 */

export function buildCreativePlanFallback(
  strategy: MarketingStrategyPlan,
  truth: MarketingProductTruth,
  intent: MarketingUserIntent,
  input: MarketingPipelineInput
): MarketingCreativePlan {
  const count = panelCount(input, intent);
  const structure = strategy.messageHierarchy.length ? strategy.messageHierarchy : ["开场钩子", "场景代入", "真实证明", "收尾引导"];
  const labels = [strategy.primarySellingPoint, ...strategy.secondarySellingPoints].filter(Boolean).slice(0, 4);
  const panels: MarketingCreativePanel[] = Array.from({ length: count }, (_, index) => {
    const role = structure[Math.min(index, structure.length - 1)] || "画面 " + (index + 1);
    const isFirst = index === 0;
    const isLast = index === count - 1 && count > 1;
    const headline = isFirst ? strategy.hook : labels[index % Math.max(1, labels.length)] || strategy.primarySellingPoint;
    const label = labels[index % Math.max(1, labels.length)] || strategy.primarySellingPoint;
    return {
      order: index,
      role,
      kind: isFirst ? "cover" : isLast ? "closing" : "content",
      title: role,
      visual: isFirst
        ? strategy.visualStrategy
        : intent.comparisonRequired && index === 1
          ? "用左右或前后对比呈现痛点与改善"
          : "围绕" + label + "的真实画面，保持统一光线与色调",
      headline,
      subheadline: isFirst ? strategy.primarySellingPoint : "",
      sellingPointLabels: (isFirst ? labels.slice(0, 3) : [label]).filter(Boolean).slice(0, 3),
      comparisonCopy: strategy.comparisonRequired && (isFirst || index === 1)
        ? { left: strategy.primaryPainPoint, right: strategy.primarySellingPoint }
        : undefined,
      cta: isLast ? strategy.ctaStrategy : "",
      supportingCopy: isFirst ? strategy.primaryPainPoint : "",
      textHierarchy: ["主标题：" + headline, ...(isFirst ? [] : []), labels.length ? "卖点：" + labels.slice(0, 3).join(" / ") : "", isLast && strategy.ctaStrategy ? "行动引导：" + strategy.ctaStrategy : ""].filter(Boolean),
      productPlacement: isFirst ? "商品主体占画面中部偏下，主标题放上方安全区" : "商品主体清晰，文字放留白区",
      background: intent.scene || "真实生活场景，光线自然",
      textSafeArea: "画面一侧保留平整、低纹理的干净留白区，文字不压商品和人物脸",
      copyIntent: headline
    };
  });

  return {
    version: strategy.version,
    summary: "已按「" + strategy.label + "」编排 " + panels.length + " 张画面，主线：" + strategy.hook,
    panels,
    publishTitle: strategy.hook.slice(0, 40) || truth.productName,
    publishBody: [strategy.primaryPainPoint, ...(strategy.primarySellingPoint ? [strategy.primarySellingPoint] : []), ...strategy.secondarySellingPoints.slice(0, 2)].filter(Boolean).join("\n"),
    tags: [truth.productName, strategy.label, ...labels.slice(0, 2)].filter(Boolean).slice(0, 8),
    confidence: "rule",
    warnings: []
  };
}

/** 可选：让文本模型按策略动态发挥文案与构图；失败时回退规则结果。 */
export async function refineCreativePlanWithLlm(
  base: MarketingCreativePlan,
  strategy: MarketingStrategyPlan,
  truth: MarketingProductTruth,
  intent: MarketingUserIntent,
  input: MarketingPipelineInput,
  deps: MarketingPipelineDeps
): Promise<MarketingCreativePlan> {
  if (!deps.useLlm || !deps.callTextJson) return base;
  try {
    const platform = getMarketingPlatform(intent.platform);
    const count = base.panels.length;
    const copyRequest = {
      system: [
        "MARKETING_CREATIVE_PLAN。你是电商图文创意编排师，只输出合法 JSON。",
        "把已经确定的营销策略编排成恰好 " + count + " 张画面，不要改变策略本身。",
        "文案只能使用给定真实卖点，不得编造价格、销量、认证、功效、检测报告或用户评价。",
        "画面里不要写平台界面、点赞按钮、二维码或水印。",
        "策略：" + strategy.label + "；主卖点：" + strategy.primarySellingPoint + "；核心痛点：" + strategy.primaryPainPoint + "；钩子：" + strategy.hook,
        intent.textRequired
          ? "用户要求画面内出现中文营销文字，headline、sellingPointLabels、cta 必须是可直接排到图上的最终简体中文短句。"
          : "用户没有要求画面内文字，文案字段只作为内部编排参考，不要描述成要画在画面上的文字。",
        platform ? "平台风格：" + platform.label + "；" + platform.copyRules.join("；") : ""
      ].filter(Boolean).join("\n"),
      user: [
        "返回 JSON：{summary,panels:[{title,visual,headline,subheadline,sellingPointLabels:string[],comparisonLeft,comparisonRight,cta,supportingCopy,productPlacement,background,textSafeArea}],publishTitle,publishBody,tags:string[]}。",
        "必须恰好 " + count + " 个 panels，按顺序对应：" + base.panels.map((panel) => panel.role).join(" → "),
        "商品：" + truth.productName + "；真实卖点：" + truth.coreSellingPoints.join("；"),
        "用户原话：" + (input.rawRequest || "（没有补充）"),
        "场景：" + (intent.scene || "未指定") + "；平台：" + intent.platform + "；目标：" + intent.businessGoal
      ].join("\n"),
      temperature: 0.5,
      maxTokens: 4200,
      signal: deps.signal
    };
    const copyResult = await generateCopywritingJson<Record<string, unknown>>({
      purpose: "marketing_creative_plan",
      ...copyRequest
    });
    return mergeCreativePlan(base, copyResult.value);
  } catch {
    return base;
  }
}

function mergeCreativePlan(base: MarketingCreativePlan, draft: Record<string, unknown>): MarketingCreativePlan {
  const rawPanels = Array.isArray(draft.panels) ? draft.panels : [];
  const panels = base.panels.map((panel, index) => {
    const patch = (rawPanels[index] || {}) as Record<string, unknown>;
    const labels = stringList(patch.sellingPointLabels);
    const left = safeText(patch.comparisonLeft, 120);
    const right = safeText(patch.comparisonRight, 120);
    return {
      ...panel,
      title: safeText(patch.title, 80) || panel.title,
      visual: safeText(patch.visual, 500) || panel.visual,
      headline: safeText(patch.headline, 80) || panel.headline,
      subheadline: safeText(patch.subheadline, 80) || panel.subheadline,
      sellingPointLabels: labels.length ? labels.slice(0, 3) : panel.sellingPointLabels,
      comparisonCopy: left || right ? { left: left || panel.comparisonCopy?.left || "", right: right || panel.comparisonCopy?.right || "" } : panel.comparisonCopy,
      cta: safeText(patch.cta, 40) || panel.cta,
      supportingCopy: safeText(patch.supportingCopy, 160) || panel.supportingCopy,
      productPlacement: safeText(patch.productPlacement, 200) || panel.productPlacement,
      background: safeText(patch.background, 200) || panel.background,
      textSafeArea: safeText(patch.textSafeArea, 200) || panel.textSafeArea
    };
  });
  return {
    ...base,
    summary: safeText(draft.summary, 400) || base.summary,
    panels,
    publishTitle: safeText(draft.publishTitle, 120) || base.publishTitle,
    publishBody: safeText(draft.publishBody, 2000) || base.publishBody,
    tags: stringList(draft.tags).length ? stringList(draft.tags).slice(0, 12) : base.tags,
    confidence: "llm"
  };
}

export function panelCount(input: MarketingPipelineInput, intent: MarketingUserIntent) {
  const max = input.kind === "detail_page" ? 12 : intent.platform === "generic" ? 4 : 9;
  return Math.max(1, Math.min(max, Number(input.cardCount) || (input.kind === "detail_page" ? 6 : 4)));
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 8) : [];
}

function safeText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
