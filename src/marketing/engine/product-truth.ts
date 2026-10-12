import type { MarketingPipelineInput, MarketingProductTruth } from "@/marketing/engine/types";

/**
 * 第一层 · 商品事实层
 *
 * 职责：把「商品图片 + 产品资料 + 用户补充」整理成结构化 ProductTruth。
 *
 * 关键约束：不能凭空编造商品事实。本层只从已经过事实审校的产品事实
 * （productFacts，来自视觉模型 + 文档提取）和用户明确填写的内容里整理，
 * 不做营销化改写，也不引入新的宣称。事实与营销表达在这一层严格分开。
 */

const MATERIAL_LABELS = ["材质", "面料", "填充", "成分", "面料成分", "里料", "面料克重", "材质成分"];
const PRICE_LABELS = ["价格", "售价", "到手价", "活动价", "原价", "单价", "价格区间", "价位"];
const AUDIENCE_LABELS = ["人群", "适用人群", "目标人群", "适合人群", "适用对象", "受众"];
const SCENE_LABELS = ["场景", "使用场景", "适用场景", "适用季节", "使用季节", "适用场合"];
const COLOR_LABELS = ["颜色", "色彩", "色号", "配色"];
const LOGO_LABELS = ["标识", "logo", "logo标识", "商标", "品牌标识", "印花", "图案"];
const BENEFIT_LABELS = ["功效", "效果", "体验", "穿着感受", "使用感受", "优点", "优势"];

export function buildProductTruth(input: MarketingPipelineInput): MarketingProductTruth {
  const facts = (input.productFacts || []).filter((fact) => fact && String(fact.value || "").trim());
  const usable = facts.filter((fact) => fact.confidence !== "uncertain");
  const values = unique(usable.map((fact) => fact.value));
  const byLabel = (labels: string[]) => unique(usable.filter((fact) => labels.some((label) => fact.label.toLowerCase().includes(label.toLowerCase()))).map((fact) => fact.value));

  const materials = byLabel(MATERIAL_LABELS);
  const priceFacts = byLabel(PRICE_LABELS);
  const functionalFeatures = unique([
    ...byLabel(["功能", "特性", "特点", "工艺", "结构", "版型"]),
    ...values.filter((value) => /(绒|棉|羊毛|真丝|防水|防风|保暖|透气|弹力|抗菌|加厚|轻量)/.test(value))
  ]);
  const coreSellingPoints = unique([
    ...splitPoints(input.sellingPoints),
    ...values
  ]).slice(0, 12);

  const targetAudience = safeText(input.targetAudience, 80)
    || byLabel(AUDIENCE_LABELS)[0]
    || "目标消费者";
  const usageScenes = unique([
    ...splitPoints(input.scene),
    ...byLabel(SCENE_LABELS)
  ]);
  const color = byLabel(COLOR_LABELS)[0] || "";
  const logo = byLabel(LOGO_LABELS)[0] || "";
  const claimsForbidden = buildForbiddenClaims(input);
  const warnings: string[] = [];
  if (!usable.length) warnings.push("没有可用的商品事实，ProductTruth 为空；营销文案只能做非事实性表达。");

  return {
    productName: safeText(input.productName, 120) || "未命名商品",
    category: safeText(input.category, 80),
    targetAudience,
    coreSellingPoints,
    functionalFeatures: functionalFeatures.slice(0, 12),
    userBenefits: byLabel(BENEFIT_LABELS).slice(0, 8),
    usageScenes: usageScenes.slice(0, 8),
    priceFacts,
    materials,
    visualConstraints: {
      color,
      logo,
      mustPreserve: unique([color, logo, input.referenceText ? "参考图中的商品颜色、版型、结构、标识与印花" : ""]).filter(Boolean),
      forbidden: ["改变商品颜色、版型、结构或标识", "为配合场景降低商品饱和度或改变色相", "把资料中不存在的参数、认证或功效画成标签"]
    },
    claimsAllowed: coreSellingPoints.slice(0, 12),
    claimsForbidden,
    sourceEvidence: usable.slice(0, 24).map((fact) => ({
      claim: fact.value,
      sourceName: fact.sourceName || "商品资料",
      sourceExcerpt: fact.sourceExcerpt || fact.value,
      confidence: fact.confidence || "confirmed"
    })),
    confidence: usable.length ? (facts.length === usable.length ? "confirmed" : "partial") : "empty",
    warnings
  };
}

function buildForbiddenClaims(input: MarketingPipelineInput) {
  const base = [
    "资料中没有出现的价格、原价、折扣或到手价",
    "销量、排名、评价数量或“全网最低”",
    "检测报告、权威认证、专利或获奖（资料未明确写出时）",
    "医疗、治疗或绝对功效承诺",
    "明星代言或专家推荐（资料未明确写出时）"
  ];
  return unique(base).filter(Boolean);
}

function splitPoints(value: string) {
  return unique(String(value || "").split(/[\n；;、,，]+/).map((item) => item.trim()).filter(Boolean));
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function safeText(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return max > 0 ? text.slice(0, max) : text;
}
