import generated from "@/marketing/generated/config.json";
import type {
  MarketingConfig,
  MarketingCopyConfig,
  MarketingFidelityConfig,
  MarketingPlatformConfig,
  MarketingQaConfig,
  MarketingStrategyConfig,
  MarketingTypographyConfig
} from "@/marketing/engine/types";

/**
 * 配置读取层。所有营销策略 / 平台 / 文案 / 高保真 / 排版 / 质检规则都来自
 * src/marketing/ 下的 Markdown（经 scripts/build-marketing-config.mjs 生成 JSON）。
 *
 * 引擎代码只从本文件拿配置，不直接写死任何策略内容。
 */

interface GeneratedShape {
  schemaVersion?: number;
  generatedAt?: string;
  contentHash?: string;
  groups?: Record<string, unknown>;
}

let cached: MarketingConfig | null = null;

export function loadMarketingConfig(): MarketingConfig {
  if (cached) return cached;
  const source = generated as GeneratedShape;
  const groups = source.groups || {};
  cached = {
    contentHash: typeof source.contentHash === "string" ? source.contentHash : "unknown",
    generatedAt: typeof source.generatedAt === "string" ? source.generatedAt : "",
    strategies: toArray<MarketingStrategyConfig>(groups.strategies).filter((item) => item && item.id),
    platforms: toArray<MarketingPlatformConfig>(groups.platforms).filter((item) => item && item.id),
    copy: toArray<MarketingCopyConfig>(groups.copy).filter((item) => item && item.id),
    fidelity: toArray<MarketingFidelityConfig>(groups["product-fidelity"])[0] || emptyFidelity(),
    typography: toArray<MarketingTypographyConfig>(groups.typography)[0] || emptyTypography(),
    qa: toArray<MarketingQaConfig>(groups.qa)[0] || emptyQa()
  };
  return cached;
}

export function listMarketingStrategies(): MarketingStrategyConfig[] {
  return loadMarketingConfig().strategies.filter((item) => item.active !== false);
}

export function getMarketingStrategy(id: string): MarketingStrategyConfig | undefined {
  return loadMarketingConfig().strategies.find((item) => item.id === id);
}

export function getMarketingPlatform(id: string): MarketingPlatformConfig | undefined {
  const config = loadMarketingConfig();
  return config.platforms.find((item) => item.id === id || item.platforms?.includes(id));
}

export function getMarketingCopy(id: string): MarketingCopyConfig | undefined {
  return loadMarketingConfig().copy.find((item) => item.id === id);
}

export function getMarketingFidelityConfig(): MarketingFidelityConfig {
  return loadMarketingConfig().fidelity;
}

export function getMarketingTypographyConfig(): MarketingTypographyConfig {
  return loadMarketingConfig().typography;
}

export function getMarketingQaConfig(): MarketingQaConfig {
  return loadMarketingConfig().qa;
}

export function marketingConfigHash(): string {
  return loadMarketingConfig().contentHash;
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function emptyFidelity(): MarketingFidelityConfig {
  return { id: "fidelity-rules", label: "商品高保真规则", version: "1", priority: "highest", criticalFeatureLabels: [], mustNotInvent: [], logoRules: [], textOnProductRules: [], colorRules: [], shapeRules: [], file: "", guidance: "", sections: [] };
}

function emptyTypography(): MarketingTypographyConfig {
  return { id: "typography-rules", label: "中文营销排版", version: "1", textMode: "overlay", templates: [], headlineMaxChars: 18, subheadlineMaxChars: 22, sellingPointMaxChars: 10, maxSellingPoints: 3, defaultFontFamily: "sans", palette: {}, geometry: {}, fonts: {}, file: "", guidance: "", sections: [] };
}

function emptyQa(): MarketingQaConfig {
  return { id: "marketing-qa", label: "营销质检", version: "1", failStatusCode: "MARKETING_INTENT_FAILED", checks: [], file: "", guidance: "", sections: [] };
}
