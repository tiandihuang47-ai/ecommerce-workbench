import { getMarketingFidelityConfig } from "@/marketing/engine/config";
import type {
  MarketingPipelineInput,
  MarketingProductFidelityPlan,
  MarketingProductTruth
} from "@/marketing/engine/types";

/**
 * 商品高保真层
 *
 * 单独把「必须锁定的商品特征」和「禁止发明的东西」抽出来，不散落在各段 Prompt 里。
 * 商品准确度 > 营销创意 > 视觉好看；商品跑样整张图直接判失败。
 *
 * 规则文本来自 src/marketing/product-fidelity/fidelity-rules.md。
 */

export function buildProductFidelityPlan(
  truth: MarketingProductTruth,
  input: MarketingPipelineInput
): MarketingProductFidelityPlan {
  const config = getMarketingFidelityConfig();
  const labels = config.criticalFeatureLabels || [];
  const facts = (input.productFacts || []).filter((fact) => fact && fact.value && fact.confidence !== "uncertain");

  const criticalFeatures = unique([
    ...featuresByLabels(facts, labels),
    ...truth.materials.map((value) => "材质：" + value),
    truth.visualConstraints.color ? "颜色：" + truth.visualConstraints.color : "",
    truth.visualConstraints.logo ? "标识：" + truth.visualConstraints.logo : ""
  ]).slice(0, 24);

  const mustPreserve = unique([
    ...truth.visualConstraints.mustPreserve,
    ...labels.slice(0, 16).map((label) => "保留商品原有" + label)
  ]).slice(0, 24);

  const hardConstraints = unique([
    "商品准确度是最高优先级：画面中的商品必须与用户参考图完全一致，不得重新设计、简化、美化或替换。",
    ...mustPreserve.map((item) => "必须保留：" + item),
    ...(config.mustNotInvent || []),
    ...(config.logoRules || []),
    ...(config.colorRules || []),
    ...(config.shapeRules || []),
    ...(config.textOnProductRules || [])
  ]).slice(0, 40);

  return {
    version: config.version || "1",
    criticalFeatures,
    mustPreserve,
    mustNotInvent: config.mustNotInvent || [],
    logoRules: config.logoRules || [],
    textOnProductRules: config.textOnProductRules || [],
    colorRules: config.colorRules || [],
    shapeRules: config.shapeRules || [],
    hardConstraints,
    confidence: facts.length ? "confirmed" : "derived"
  };
}

function featuresByLabels(
  facts: Array<{ label: string; value: string }>,
  labels: string[]
) {
  const out: string[] = [];
  for (const fact of facts) {
    if (labels.some((label) => label && fact.label.toLowerCase().includes(label.toLowerCase()))) {
      out.push(fact.label + "：" + fact.value);
    }
  }
  return out;
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}
