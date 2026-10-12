import type { ProductRecord, ProductReferenceSnapshot } from "@/lib/pipeline-types";

export function createProductReferenceSnapshot(product: ProductRecord): ProductReferenceSnapshot {
  return {
    id: product.id,
    name: product.name,
    brandName: product.brandName || "",
    category: product.category || "",
    priceRange: product.priceRange || "",
    productFacts: product.productFacts || "",
    specifications: product.specifications || "",
    colors: product.colors || "",
    coreSellingPoints: product.coreSellingPoints || "",
    secondarySellingPoints: product.secondarySellingPoints || "",
    targetAudience: product.targetAudience || "",
    painPoints: product.painPoints || "",
    objections: product.objections || "",
    useScenarios: product.useScenarios || "",
    competitorComparison: product.competitorComparison || "",
    buyerFeedback: product.buyerFeedback || "",
    forbiddenWords: product.forbiddenWords || "",
    forbiddenClaims: product.forbiddenClaims || "",
    proofMaterials: product.proofMaterials || "",
    sourceDocumentName: product.sourceDocumentName || "",
    updatedAt: product.updatedAt || ""
  };
}

export function formatProductReferenceForPrompt(snapshot?: ProductReferenceSnapshot): string {
  if (!snapshot) return "";
  return [
    "【已引用产品资料】",
    `产品：${snapshot.name}`,
    snapshot.brandName ? `品牌：${snapshot.brandName}` : "",
    snapshot.category ? `品类：${snapshot.category}` : "",
    snapshot.priceRange ? `价格信息：${snapshot.priceRange}` : "",
    snapshot.productFacts ? `产品事实：${snapshot.productFacts}` : "",
    snapshot.specifications ? `规格参数：${snapshot.specifications}` : "",
    snapshot.colors ? `颜色/款式：${snapshot.colors}` : "",
    snapshot.coreSellingPoints ? `核心卖点：${snapshot.coreSellingPoints}` : "",
    snapshot.secondarySellingPoints ? `次级卖点：${snapshot.secondarySellingPoints}` : "",
    snapshot.targetAudience ? `目标人群：${snapshot.targetAudience}` : "",
    snapshot.painPoints ? `用户痛点：${snapshot.painPoints}` : "",
    snapshot.objections ? `用户顾虑：${snapshot.objections}` : "",
    snapshot.useScenarios ? `使用场景：${snapshot.useScenarios}` : "",
    snapshot.competitorComparison ? `竞品区别：${snapshot.competitorComparison}` : "",
    snapshot.buyerFeedback ? `买家反馈：${snapshot.buyerFeedback}` : "",
    snapshot.proofMaterials ? `证据材料：${snapshot.proofMaterials}` : "",
    snapshot.forbiddenWords ? `禁忌词：${snapshot.forbiddenWords}` : "",
    snapshot.forbiddenClaims ? `不能承诺：${snapshot.forbiddenClaims}` : "",
    "只能使用以上已有事实；资料未提供的信息必须明确说明没有依据，不能编造。"
  ].filter(Boolean).join("\n");
}
