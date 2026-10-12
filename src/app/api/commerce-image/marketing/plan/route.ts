import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { callCommerceTextJson } from "@/lib/commerce-image-ai";
import { loadMarketingConfig } from "@/marketing/engine/config";
import { runMarketingPipeline } from "@/marketing/engine/pipeline";
import { runMarketingQa } from "@/marketing/engine/qa";
import { marketingTypographyForPanel } from "@/marketing/engine/bridge";
import type { MarketingPipelineInput } from "@/marketing/engine/types";

export const runtime = "nodejs";

/**
 * 营销引擎 dry-run 接口。
 *
 * 只跑「商品事实 → 意图 → 策略 → 创意 → Prompt 编译 → 质检（规则）」，
 * 不调用生图模型、不写任何任务数据。用于：
 *   1. 回归 fixtures 测试；
 *   2. 出问题时快速定位是哪一层的问题（把自然语言输入丢进来就能看到每层输出）。
 */

export async function GET() {
  const config = loadMarketingConfig();
  return NextResponse.json({
    success: true,
    contentHash: config.contentHash,
    generatedAt: config.generatedAt,
    strategies: config.strategies.map((item) => ({ id: item.id, label: item.label, version: item.version, kind: item.kind, active: item.active !== false })),
    platforms: config.platforms.map((item) => ({ id: item.id, label: item.label, version: item.version })),
    copy: config.copy.map((item) => ({ id: item.id, label: item.label, version: item.version })),
    productFidelity: { id: config.fidelity.id, label: config.fidelity.label, version: config.fidelity.version },
    typography: { id: config.typography.id, label: config.typography.label, version: config.typography.version, templates: config.typography.templates },
    qa: { id: config.qa.id, label: config.qa.label, version: config.qa.version, checks: config.qa.checks }
  });
}

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return failure("请求体必须是 JSON。");
  }
  const raw = (body.input && typeof body.input === "object" ? body.input : body) as Record<string, unknown>;
  const input = normalizeInput(raw);
  const useLlm = body.useLlm !== false && raw.useLlm !== false;
  try {
    const marketing = await runMarketingPipeline(input, {
      callTextJson: useLlm ? callCommerceTextJson : undefined,
      useLlm,
      provider: text(raw.provider, 60)
    });
    const qa = body.skipQa === true ? undefined : await runMarketingQa({
      source: {
        productTruth: marketing.productTruth,
        intent: marketing.intent,
        strategy: marketing.strategy,
        creativePlan: marketing.creativePlan,
        productFidelity: marketing.productFidelity,
        typography: marketing.typography
      },
      panel: marketing.creativePlan.panels[0]
    });
    /* 每张画面的程序排版方案（dry-run 调试用，方便检查模板与安全区）。 */
    const typographyByPanel = marketing.creativePlan.panels.map((_, index) => marketingTypographyForPanel(marketing, index));
    return NextResponse.json({ success: true, input, marketing, qa, typographyByPanel });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "营销引擎运行失败。", 500);
  }
}

function normalizeInput(raw: Record<string, unknown>): MarketingPipelineInput {
  const kind = ["detail_page", "douyin_post", "xiaohongshu_post", "retouch", "free_chat"].includes(String(raw.kind))
    ? raw.kind as MarketingPipelineInput["kind"]
    : "xiaohongshu_post";
  const brand = (raw.brand && typeof raw.brand === "object" ? raw.brand : {}) as Record<string, unknown>;
  return {
    kind,
    productName: text(raw.productName, 120),
    category: text(raw.category, 80),
    targetAudience: text(raw.targetAudience, 80),
    sellingPoints: text(raw.sellingPoints, 600),
    scene: text(raw.scene, 200),
    style: text(raw.style, 200),
    rawRequest: text(raw.rawRequest, 4000),
    cardCount: clamp(Number(raw.cardCount), 1, kind === "detail_page" ? 12 : 9, kind === "detail_page" ? 6 : 4),
    brand: { primaryColor: text(brand.primaryColor, 20), secondaryColor: text(brand.secondaryColor, 20) },
    productFacts: Array.isArray(raw.productFacts)
      ? raw.productFacts.slice(0, 40).map((item) => {
        const fact = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return {
          label: text(fact.label, 80) || "商品信息",
          value: text(fact.value, 300),
          sourceName: text(fact.sourceName, 120) || "产品资料",
          sourceExcerpt: text(fact.sourceExcerpt, 300) || text(fact.value, 300),
          confidence: ["confirmed", "observed", "uncertain"].includes(String(fact.confidence)) ? String(fact.confidence) : "confirmed"
        };
      }).filter((fact) => fact.value)
      : [],
    documentText: text(raw.documentText, 40000),
    referenceText: text(raw.referenceText, 40000),
    hasBenchmark: raw.hasBenchmark === true,
    benchmarkSummary: text(raw.benchmarkSummary, 2000),
    strategyHint: text(raw.strategyHint, 40) || "auto"
  };
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clamp(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function failure(message: string, status = 400) {
  return NextResponse.json({ success: false, code: "MARKETING_PLAN_ERROR", category: "validation", retryable: false, message }, { status });
}
