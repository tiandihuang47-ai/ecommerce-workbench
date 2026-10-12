import { buildCreativePlanFallback, refineCreativePlanWithLlm } from "@/marketing/engine/creative-planner";
import { buildProductTruth } from "@/marketing/engine/product-truth";
import { buildProductFidelityPlan } from "@/marketing/engine/product-fidelity";
import { parseUserIntent, refineUserIntentWithLlm } from "@/marketing/engine/intent";
import { compileMarketingPrompt } from "@/marketing/engine/prompt-compiler";
import { buildStrategyPlanFallback, refineStrategyWithLlm, selectStrategyConfig } from "@/marketing/engine/strategist";
import { buildTypographyPlan } from "@/marketing/engine/typography";
import { marketingConfigHash } from "@/marketing/engine/config";
import { MARKETING_ENGINE_VERSION, MARKETING_LAYER_VERSIONS } from "@/marketing/engine/versions";
import type {
  MarketingPipelineDeps,
  MarketingPipelineInput,
  MarketingPipelineRecord
} from "@/marketing/engine/types";

/**
 * 营销生图 Pipeline 主编排（dry-run 与真实链路共用）。
 *
 * 用户输入 → 商品事实 → 用户意图 → 营销策略 → 商品高保真 → 创意编排
 * → 中文排版（程序） → Prompt 编译（→ 现有生图执行 → 营销质检）
 *
 * 每一步都独立、可观察、可版本化；任何一步的模型调用失败都会回退到规则结果，
 * 不会因为营销层不稳定而让整个生图任务失败。
 */

export async function runMarketingPipeline(
  input: MarketingPipelineInput,
  deps: MarketingPipelineDeps = {}
): Promise<MarketingPipelineRecord> {
  const resolved: MarketingPipelineDeps = {
    ...deps,
    useLlm: deps.useLlm !== false && Boolean(deps.callTextJson)
  };

  const productTruth = buildProductTruth(input);
  const baseIntent = parseUserIntent(input, productTruth);
  const intent = await refineUserIntentWithLlm(baseIntent, input, productTruth, resolved);
  const config = selectStrategyConfig(intent);
  const baseStrategy = buildStrategyPlanFallback(config, productTruth, intent);
  const strategy = await refineStrategyWithLlm(baseStrategy, config, productTruth, intent, input, resolved);
  const productFidelity = buildProductFidelityPlan(productTruth, input);
  const baseCreative = buildCreativePlanFallback(strategy, productTruth, intent, input);
  const creativePlan = await refineCreativePlanWithLlm(baseCreative, strategy, productTruth, intent, input, resolved);
  const typography = buildTypographyPlan({ creativePlan, strategyId: strategy.id, intent, panelIndex: 0 });
  const compiled = compileMarketingPrompt({
    source: { productTruth, intent, strategy, creativePlan, productFidelity, typography },
    panel: creativePlan.panels[0],
    provider: resolved.provider
  });

  const warnings = [
    ...productTruth.warnings,
    ...intent.warnings,
    ...creativePlan.warnings,
    ...typography.warnings
  ];
  if (resolved.useLlm && baseIntent.confidence === "rule" && intent.confidence === "rule") warnings.push("意图层未使用模型补全，已按规则结果继续。");
  if (baseStrategy.confidence === "rule" && strategy.confidence === "rule" && resolved.useLlm) warnings.push("策略层未使用模型实例化，已按配置默认值继续。");

  return {
    pipelineVersion: MARKETING_ENGINE_VERSION,
    versions: {
      engine: MARKETING_ENGINE_VERSION,
      strategyConfigHash: marketingConfigHash(),
      productTruth: MARKETING_LAYER_VERSIONS.productTruth,
      intent: MARKETING_LAYER_VERSIONS.intent,
      strategy: MARKETING_LAYER_VERSIONS.strategy,
      platform: MARKETING_LAYER_VERSIONS.platform,
      copy: MARKETING_LAYER_VERSIONS.copy,
      creative: MARKETING_LAYER_VERSIONS.creative,
      productFidelity: productFidelity.version || MARKETING_LAYER_VERSIONS.productFidelity,
      typography: typography.version || MARKETING_LAYER_VERSIONS.typography,
      promptCompiler: MARKETING_LAYER_VERSIONS.promptCompiler,
      qa: MARKETING_LAYER_VERSIONS.qa
    },
    productTruth,
    intent,
    strategy,
    creativePlan,
    productFidelity,
    typography,
    promptPreview: compiled.text,
    promptProvider: compiled.provider,
    warnings,
    updatedAt: new Date().toISOString()
  };
}
