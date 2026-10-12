import { getMarketingPlatform } from "@/marketing/engine/config";
import { MARKETING_LAYER_VERSIONS } from "@/marketing/engine/versions";
import type {
  MarketingCompiledPrompt,
  MarketingCreativePanel,
  MarketingCreativePlan,
  MarketingProductFidelityPlan,
  MarketingProductTruth,
  MarketingStrategyPlan,
  MarketingTypographyPlan,
  MarketingUserIntent
} from "@/marketing/engine/types";

/**
 * 第五层 · Prompt 编译层
 *
 * 只做一件事：把前面已经确定好的 ProductTruth / UserIntent / MarketingStrategy /
 * CreativePlan / ProductFidelity / Typography 翻译成生图模型能执行的提示词。
 *
 * 它不自己决定怎么营销；营销决策在策略层完成。换了生图模型，只换 Adapter，
 * 策略与创意不需要重写。
 *
 * 默认 textMode=overlay：模型只画干净底图并预留文案安全区，中文由程序排版层叠加。
 */

export interface MarketingPromptSource {
  productTruth: MarketingProductTruth;
  intent: MarketingUserIntent;
  strategy: MarketingStrategyPlan;
  creativePlan: MarketingCreativePlan;
  productFidelity: MarketingProductFidelityPlan;
  typography: MarketingTypographyPlan;
}

export function compileMarketingPrompt(options: {
  source: MarketingPromptSource;
  panel: MarketingCreativePanel;
  provider?: string;
}): MarketingCompiledPrompt {
  const { source, panel } = options;
  const provider = options.provider || "generic";
  const textMode = source.typography.textMode === "model" ? "model" : "overlay";
  const sections: Array<{ id: string; title: string; content: string }> = [];

  sections.push({
    id: "marketing_strategy",
    title: "营销策略（本图怎么卖）",
    content: [
      "策略：" + source.strategy.label + "；目标：" + source.strategy.businessGoal + "；平台：" + source.intent.platform,
      "核心痛点：" + source.strategy.primaryPainPoint,
      "主卖点：" + source.strategy.primarySellingPoint,
      source.strategy.secondarySellingPoints.length ? "辅助卖点：" + source.strategy.secondarySellingPoints.join("；") : "",
      "钩子方向：" + source.strategy.hook,
      source.strategy.messageHierarchy.length ? "信息层级：" + source.strategy.messageHierarchy.join(" → ") : "",
      "视觉策略：" + source.strategy.visualStrategy,
      "本图只允许一个主营销主题，辅助卖点最多 3 条；信息过多请拆图。"
    ].filter(Boolean).join("\n")
  });

  sections.push({
    id: "panel_task",
    title: "本张画面任务",
    content: [
      "画面职责：" + panel.role + "（" + panel.title + "）",
      "可见内容：" + panel.visual,
      "商品位置：" + panel.productPlacement,
      "背景：" + panel.background
    ].join("\n")
  });

  // 中文文字：默认交给程序排版层，模型只预留干净安全区，不要自己写大量中文
  if (textMode === "overlay") {
    sections.push({
      id: "typography_reserved",
      title: "文案安全区（程序排字，模型不要写字）",
      content: [
        "本图的全部中文营销文字由程序在生成后叠加，请不要在画面里生成任何标题、卖点、标签、按钮或长段中文。",
        "只需在指定区域留出干净、低纹理、对比稳定的背景，不要压商品主体、人物脸或关键细节。",
        ...source.typography.layers.map((layer) => "预留区域（" + layerRoleLabel(layer.role) + "）：画面 " + Math.round(layer.x * 100) + "% / " + Math.round(layer.y * 100) + "% 起，宽约 " + Math.round(layer.width * 100) + "%，高约 " + Math.round(layer.height * 100) + "%"),
        "可以为了留白重新安排构图、人物位置和背景，但不能改动商品本身。"
      ].join("\n")
    });
  } else if (source.intent.textRequired) {
    sections.push({
      id: "text_requirement",
      title: "画面文字要求（用户明确要求，必须执行）",
      content: [
        "必须在画面中排入清晰、正确、可读的简体中文营销文字，不要只给摄影底图。",
        "主标题：" + (panel.headline || source.strategy.primarySellingPoint),
        panel.subheadline ? "副标题：" + panel.subheadline : "",
        panel.sellingPointLabels.length ? "卖点短句：" + panel.sellingPointLabels.join(" / ") : "",
        panel.comparisonCopy ? "对比文案：左「" + panel.comparisonCopy.left + "」/ 右「" + panel.comparisonCopy.right + "」" : "",
        panel.cta ? "行动引导：" + panel.cta : "",
        "文字要有明确层级：一个主标题 + 3 条以内卖点短句；不得出现乱码、错字或缺笔。",
        "文字不得压住商品主体或人物面部。"
      ].filter(Boolean).join("\n")
    });
  }

  const platform = getMarketingPlatform(source.intent.platform);
  if (platform) {
    sections.push({
      id: "platform_style",
      title: "平台风格",
      content: [
        "平台：" + platform.label + "；语气：" + platform.tone,
        platform.copyRules.length ? "文案规则：" + platform.copyRules.join("；") : "",
        platform.visualRules.length ? "视觉规则：" + platform.visualRules.join("；") : ""
      ].filter(Boolean).join("\n")
    });
  }

  sections.push({
    id: "truth_boundary",
    title: "真实性边界（不可越过）",
    content: source.productTruth.claimsForbidden.map((claim) => "不得出现：" + claim).join("\n")
  });

  // 商品高保真：单独一层，Hard Constraints
  sections.push({
    id: "product_fidelity",
    title: "商品高保真（最高优先级 · Hard Constraints）",
    content: source.productFidelity.hardConstraints.join("\n")
  });

  const adapter = adapterInstructions(provider, source.intent.textRequired, textMode);
  if (adapter) sections.push({ id: "provider_adapter", title: "Provider Adapter", content: adapter });

  return {
    version: MARKETING_LAYER_VERSIONS.promptCompiler,
    provider,
    panelId: String(panel.order),
    text: sections.map((section) => "【" + section.title + "】\n" + section.content).join("\n\n"),
    sections,
    textRequired: source.intent.textRequired
  };
}

function layerRoleLabel(role: string) {
  if (role === "headline") return "主标题";
  if (role === "subheadline") return "副标题";
  if (role === "selling_point") return "卖点";
  if (role === "comparison_left") return "左侧对比文案";
  if (role === "comparison_right") return "右侧对比文案";
  if (role === "cta") return "行动引导";
  return role;
}

/** 不同生图模型使用不同提示词偏好；营销策略与创意不需要重写。 */
export function adapterInstructions(provider: string, textRequired: boolean, textMode: "overlay" | "model" = "overlay"): string {
  const key = provider.toLowerCase();
  if (textMode === "overlay") {
    if (key.includes("qwen")) return "阿里云通义万相：只输出干净营销底图并预留安全区，不要生成任何中文、标签或乱码纹理；文字由程序叠加。";
    if (key.includes("gpt")) return "GPT Image：只输出干净营销底图并预留安全区，绝对不要生成任何文字、字母或类似文字的纹理。";
    if (key.includes("seedream") || key.includes("doubao")) return "豆包 Seedream：只输出真实商品营销底图并预留干净留白，不要添加文字、标签、图标或水印。";
    return "只输出干净营销底图并预留文字安全区，不要在画面中生成任何文字。";
  }
  if (key.includes("qwen")) {
    return textRequired
      ? "阿里云通义万相：中文文字能力强，请把中文文案的层级、位置和用途写清楚，并明确这是完整营销图文而非纯底图。"
      : "阿里云通义万相：输出真实摄影底图，不要生成任何悬浮文字、标签或乱码纹理。";
  }
  if (key.includes("gpt")) {
    return textRequired
      ? "GPT Image：文字容易出错，请优先保证中文正确、简短、大号、位置明确；宁可少字，也不要乱码。"
      : "GPT Image：输出干净摄影底图，避免任何文字、字母或类似文字的纹理。";
  }
  if (key.includes("seedream") || key.includes("doubao")) {
    return textRequired
      ? "豆包 Seedream：按主标题、卖点短句的层级排版中文，文字清晰可读，不压商品主体。"
      : "豆包 Seedream：输出真实商品摄影底图，不添加文字、标签、图标或水印。";
  }
  return textRequired ? "按营销层级在画面中排入清晰中文文案。" : "输出真实摄影底图，不添加任何画面内文字。";
}
