import { getMarketingTypographyConfig } from "@/marketing/engine/config";
import type {
  MarketingCreativePanel,
  MarketingCreativePlan,
  MarketingTypographyLayer,
  MarketingTypographyPlan,
  MarketingUserIntent
} from "@/marketing/engine/types";

/**
 * 中文营销排版层（程序渲染）
 *
 * 生图模型只画干净底图并预留安全区；中文营销文字全部由本层用真实系统字体
 * 生成文字图层，再交给导出/预览合成。这样字一定正确、不乱码、可修改、可重渲染。
 *
 * 模板与几何来自 src/marketing/typography/typography-rules.md，V1 只做三套：
 * pain_comparison / scenario_hook / detail_benefit。
 */

const ROLE_ORDER: MarketingTypographyLayer["role"][] = [
  "headline",
  "subheadline",
  "selling_point",
  "comparison_left",
  "comparison_right",
  "cta"
];

export function buildTypographyPlan(options: {
  creativePlan: MarketingCreativePlan;
  strategyId: string;
  intent: MarketingUserIntent;
  panelIndex: number;
}): MarketingTypographyPlan {
  const config = getMarketingTypographyConfig();
  const template = templateFor(options.strategyId);
  const panel = options.creativePlan.panels[Math.max(0, Math.min(options.panelIndex, options.creativePlan.panels.length - 1))];
  const warnings: string[] = [];
  const layers: MarketingTypographyLayer[] = [];

  if (!panel) {
    return { version: config.version || "1", template, textMode: "overlay", textRequired: options.intent.textRequired, layers: [], plannedText: [], warnings: ["没有可排版的画面方案"] };
  }

  const headline = clampText(panel.headline || options.creativePlan.publishTitle || panel.title, config.headlineMaxChars || 18);
  /* 避免同一句话既当副标题又当对比文案，造成信息重复。 */
  const comparisonLeftRaw = panel.comparisonCopy?.left || "";
  const comparisonRightRaw = panel.comparisonCopy?.right || "";
  const subheadlineRaw = panel.subheadline || panel.supportingCopy;
  const duplicateOfComparison = Boolean(subheadlineRaw.trim())
    && [comparisonLeftRaw, comparisonRightRaw].some((value) => value.trim() === subheadlineRaw.trim());
  const subheadline = clampText(duplicateOfComparison ? "" : subheadlineRaw, config.subheadlineMaxChars || 22);
  const sellingPoints = (panel.sellingPointLabels || [])
    .map((item) => clampText(item, config.sellingPointMaxChars || 10))
    .filter(Boolean)
    .slice(0, config.maxSellingPoints || 3);
  const cta = clampText(panel.cta, 14);

  if (options.intent.textRequired && !headline) warnings.push("用户要求画面文字，但创意方案没有给出主标题");
  if ((panel.sellingPointLabels || []).length > (config.maxSellingPoints || 3)) warnings.push("卖点超过 " + (config.maxSellingPoints || 3) + " 条，已截断，避免信息过载");

  if (headline) layers.push(makeLayer("headline", headline, geometry(config, template, "headline"), config));
  if (subheadline) layers.push(makeLayer("subheadline", subheadline, geometry(config, template, "subheadline"), config));

  if (template === "pain_comparison" && panel.comparisonCopy) {
    const left = clampText(panel.comparisonCopy.left, 18);
    const right = clampText(panel.comparisonCopy.right, 18);
    if (left) layers.push(makeLayer("comparison_left", left, geometry(config, template, "comparison_left"), config));
    if (right) layers.push(makeLayer("comparison_right", right, geometry(config, template, "comparison_right"), config));
  }

  const pointGeometry = geometry(config, template, "selling_point");
  sellingPoints.forEach((text, index) => {
    layers.push(makeLayer("selling_point", text, {
      ...pointGeometry,
      y: number(pointGeometry.y, 0.4) + index * number(pointGeometry.gap, 0.08)
    }, config));
  });

  if (cta) layers.push(makeLayer("cta", cta, geometry(config, template, "cta"), config));

  return {
    version: config.version || "1",
    template,
    textMode: config.textMode === "model" ? "model" : "overlay",
    textRequired: options.intent.textRequired,
    layers,
    plannedText: layers.map((layer) => layer.text),
    warnings
  };
}

export function templateFor(strategyId: string): string {
  if (strategyId === "pain_comparison") return "pain_comparison";
  if (strategyId === "scenario_hook" || strategyId === "scene_seeding" || strategyId === "identity_hook") return "scenario_hook";
  return "detail_benefit";
}

function makeLayer(
  role: MarketingTypographyLayer["role"],
  text: string,
  geo: Record<string, unknown>,
  config: ReturnType<typeof getMarketingTypographyConfig>
): MarketingTypographyLayer {
  const palette = config.palette || {};
  const colorKey = role === "cta" || role === "comparison_right" ? "ctaColor" : role === "subheadline" ? "subheadlineColor" : role === "selling_point" ? "sellingPointColor" : "headlineColor";
  const background = stringValue(geo.background, stringValue(palette.panelColor, "#1F1A17"));
  return {
    id: "marketing_type_" + role + "_" + Math.random().toString(36).slice(2, 8),
    role,
    text,
    x: clamp01(number(geo.x, 0.06)),
    y: clamp01(number(geo.y, 0.05)),
    width: clamp01(number(geo.width, 0.88)),
    height: clamp01(number(geo.height, 0.12)),
    fontSize: number(geo.fontSize, 0.05),
    fontWeight: weight(geo.fontWeight),
    lineHeight: number(geo.lineHeight, 1.2),
    color: stringValue(geo.color, stringValue(palette[colorKey], "#FFFFFF")),
    backgroundColor: background,
    /* 主标题默认也带一层半透明底，避免白字落在浅色底图上不可读。 */
    backgroundOpacity: number(geo.backgroundOpacity, number(palette.panelOpacity, 0.42)),
    align: align(geo.align),
    fontFamily: family(stringValue(geo.fontFamily, config.defaultFontFamily))
  };
}

function geometry(config: ReturnType<typeof getMarketingTypographyConfig>, template: string, role: string): Record<string, unknown> {
  const byTemplate = (config.geometry || {})[template] || {};
  const fallback = (config.geometry || {}).detail_benefit || {};
  return byTemplate[role] || fallback[role] || {};
}

function clampText(value: string, max: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }
function number(value: unknown, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function stringValue(value: unknown, fallback: string) { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function weight(value: unknown): MarketingTypographyLayer["fontWeight"] {
  const parsed = Number(value);
  return [400, 500, 600, 700, 800, 900].includes(parsed) ? parsed as MarketingTypographyLayer["fontWeight"] : 700;
}
function align(value: unknown): MarketingTypographyLayer["align"] {
  return value === "center" || value === "right" ? value : "left";
}
function family(value: string): MarketingTypographyLayer["fontFamily"] {
  return value === "serif" || value === "rounded" ? value : "sans";
}

export { ROLE_ORDER };
