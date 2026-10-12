import { randomUUID } from "node:crypto";
import type {
  CommerceImageCanvasRegion,
  CommerceImageLayoutGuide,
  CommerceImageOverlay,
  CommerceImagePanel,
  CommerceImagePublishPackage,
  CommerceImageStoryboard,
  CommerceImageStoryboardCard,
  CommerceImageStoryboardRole,
  CommerceImageTask,
  CommerceImageTextLayer,
  CommerceImageTextSafeZone,
  CommerceImageVisualBible,
  CommerceSellingPointCard
} from "@/lib/commerce-image-types";
import { sellingPointCardsForTask } from "@/lib/commerce-image-selling-points";
import { compileMarketingPrompt } from "@/marketing/engine/prompt-compiler";
import { marketingToTextLayers } from "@/marketing/engine/bridge";
import {
  buildSeriesConsistencyAnchor,
  cleanGeneratorVisual,
  cleanUserRequest,
  CLEAN_BASE_IMAGE_RULE,
  commerceImageModeLabel,
  describeBrandPalette,
  describeCleanSafeZones,
  detectCommerceImageTextRequirement,
  IN_IMAGE_TEXT_RULE,
  marketingBeatForRole,
  marketingPathForTask,
  PERSON_POLICY_TEXT,
  sanitizeCommerceImageGeneratorPrompt,
  stripDesaturation,
  stripNoTextIntent,
  stripPersonProhibition,
  buildLogoTextBlock
} from "@/lib/commerce-image-marketing";

export interface CommerceImagePlanDraft {
  panels?: Array<{ title?: string; kind?: string; description?: string; headline?: string; body?: string; layout?: string; style?: string }>;
  storyboard?: {
    theme?: string;
    emotionalHook?: string;
    summary?: string;
    visualBible?: Partial<Omit<CommerceImageVisualBible, "referenceAssetIds">>;
    cards?: Array<{ role?: string; title?: string; purpose?: string; visual?: string; copyIntent?: string }>;
  };
  publishTitle?: string;
  publishBody?: string;
  tags?: string[];
  summary?: string;
}

type PanelSeed = {
  kind: string;
  title: string;
  description: string;
  overlayTitle: string;
  overlayBody: string;
  referenceSegmentId?: string;
  storyboardCard?: CommerceImageStoryboardCard;
  layoutGuide?: CommerceImageLayoutGuide;
  /** 直连模式：本张画面绑定的卖点卡，进入提示词与质检。 */
  sellingPoint?: CommerceSellingPointCard;
};

/** 直连模式：电商图文（小红书 / 抖音）不走营销 Agent、故事线、平台分流与 Prompt 二次改写。 */
export function isDirectCommerceKind(kind: CommerceImageTask["kind"]): boolean {
  return kind === "xiaohongshu_post" || kind === "douyin_post";
}

const DIRECT_ROLE_LABELS: Record<CommerceImageStoryboardRole, string> = {
  cover_hook: "封面钩子",
  scene_context: "场景代入",
  fact_proof: "卖点证明",
  highlight: "卖点延展",
  outfit_closing: "收藏收尾"
};

/**
 * 直连模式的画面方案：按「钩子 → 场景 → 证明 → 收束」节奏给每张画面分配职责，
 * 并绑定卖点卡（收尾页不绑卡，只负责收束）。用户原话仍是最高优先级；
 * 没有任何可用卖点卡时退回原来的"画面 N"薄方案。
 */
export async function buildDirectCommerceImagePlan(task: CommerceImageTask) {
  const product = task.productName || task.productSnapshot?.name || "商品";
  const sellingPoints = taskFacts(task);
  const warnings = buildWarnings(task);
  /* 默认 1 张（原来兜底 4 张）；用户手动改成 2/3/4 张时照旧按 cardCount 执行。 */
  const count = Math.max(1, Math.min(10, task.brief.cardCount || 1));
  const userRequest = cleanUserRequest(task.brief.extra);
  const scene = task.brief.scene || task.productSnapshot?.useScenarios || "";
  const cards = await sellingPointCardsForTask(task);
  /* 文字边界：用户明确要求画面内文字 → 模型直接画字，不叠程序文字层；
   * 用户明确不要文字 → 不排任何字；未提及时才用程序 overlay 排卖点短句。 */
  const textRequirement = detectCommerceImageTextRequirement(task.brief.extra);
  const seeds: PanelSeed[] = xiaohongshuRoles(count).map((role, index) => {
    /* 收尾页只负责收束，不绑定具体卖点；其余页面循环绑定卖点卡。 */
    const card = role === "outfit_closing" ? undefined : cards[index % Math.max(1, cards.length)];
    if (!card && !userRequest) {
      return { kind: "direct", title: "画面 " + (index + 1), description: "忠实执行用户需求", overlayTitle: "", overlayBody: "" };
    }
    const roleBrief = directRoleBrief(role, card, product, scene);
    return {
      kind: role,
      title: card ? `${DIRECT_ROLE_LABELS[role]} · ${card.label}` : `${DIRECT_ROLE_LABELS[role]}`,
      description: [
        card ? `这一张卖「${card.label}」：${roleBrief}` : roleBrief || "忠实执行用户需求",
        userRequest ? `用户要求：${userRequest}` : ""
      ].filter(Boolean).join("；"),
      overlayTitle: textRequirement === "unspecified" && card?.copyLine ? card.copyLine : "",
      overlayBody: "",
      sellingPoint: card
    };
  });
  return {
    panels: seeds.map((seed, index) => buildPanel(task, seed, index, undefined)),
    publishPackage: buildPublishPackage(task, product, sellingPoints, task.brief.audience || "目标消费者", undefined, undefined),
    storyboard: undefined,
    warnings: unique([...warnings, ...(task.referenceAnalysis.warnings || [])])
  };
}

function directRoleBrief(role: CommerceImageStoryboardRole, card: CommerceSellingPointCard | undefined, product: string, scene: string): string {
  if (!card) return "";
  const evidence = card.visualEvidence;
  if (role === "cover_hook") return `把${product}作为绝对主角，用最能体现「${card.label}」的画面形成第一眼停留，画面里要能真实看到${evidence}`;
  if (role === "scene_context") return `把${product}放进${scene || "真实使用场景"}的生活时刻让目标买家代入，画面里能看出「${card.label}」（${evidence}）`;
  if (role === "fact_proof" || role === "highlight") return `镜头推进放大呈现${evidence}，让「${card.label}」一眼可信`;
  return "";
}

export async function buildCommerceImagePlan(task: CommerceImageTask, aiDraft?: CommerceImagePlanDraft) {
  if (isDirectCommerceKind(task.kind)) return buildDirectCommerceImagePlan(task);
  const product = task.productName || task.productSnapshot?.name || "商品";
  const sellingPoints = taskFacts(task);
  const audience = task.brief.audience || task.productSnapshot?.targetAudience || "目标消费者";
  const scene = task.brief.scene || task.productSnapshot?.useScenarios || "真实使用场景";
  const warnings = buildWarnings(task);
  const storyboard = task.kind === "xiaohongshu_post" ? buildXiaohongshuStoryboard(task, aiDraft) : undefined;
  const localSeeds = task.kind === "detail_page"
    ? detailPageSeeds(task, product, sellingPoints, scene)
    : task.kind === "xiaohongshu_post" && storyboard
      ? xiaohongshuSeeds(task, storyboard, sellingPoints)
      : task.kind === "douyin_post"
        ? socialSeeds(task, product, sellingPoints, audience, scene)
        : retouchSeeds(task);
  const seeds = task.kind === "xiaohongshu_post" ? localSeeds : mergeAiDraft(localSeeds, aiDraft);
  return {
    panels: seeds.map((seed, index) => buildPanel(task, seed, index, storyboard)),
    publishPackage: buildPublishPackage(task, product, sellingPoints, audience, aiDraft, storyboard),
    storyboard,
    warnings: unique([...warnings, ...(task.referenceAnalysis.warnings || [])])
  };
}

export function buildCommerceImageWarnings(task: CommerceImageTask) {
  return buildWarnings(task);
}

// Compile from the current approved story at dispatch time. Saved prompts may
// belong to an older story revision; versions keep their original prompt.
export function compileCommerceImagePanel(task: CommerceImageTask, panel: CommerceImagePanel) {
  /* 直连模式没有故事线，面板提示词在规划时就已最终确定，不再二次编译。 */
  if (isDirectCommerceKind(task.kind)) return panel;
  if (task.kind !== "xiaohongshu_post" || !task.storyboard) return panel;
  const index = Math.max(0, task.panels.findIndex((item) => item.id === panel.id));
  const card = task.storyboard.cards.find((item) => item.id === panel.storyboardCardId) || task.storyboard.cards[index];
  if (!card) return panel;
  const compiled = buildPanel(task, {
    kind: card.role, title: card.title, description: `${card.purpose}；${card.visual}`,
    overlayTitle: card.copyIntent, overlayBody: panel.overlay.body,
    storyboardCard: card, layoutGuide: panel.layoutGuide || xiaohongshuLayoutGuide(index, card.role)
  }, index, task.storyboard);
  return { ...panel, title: card.title, description: compiled.description, prompt: compiled.prompt,
    storyboardCardId: card.id, layoutGuide: compiled.layoutGuide, overlay: compiled.overlay, textLayers: compiled.textLayers };
}

/**
 * 提示词装配。优先级严格按用户要求：
 *   1. 用户本轮原话（最高优先级，原文保留，不改写、不压缩）
 *   2. 用户明确要求的画面文字 / 营销风格
 *   3. 产品资料里的真实事实
 *   4. 参考图与商品一致性约束
 *   5. 系统默认风格（不得覆盖以上任何一项）
 */
function buildPanelPrompt(
  task: CommerceImageTask,
  seed: PanelSeed,
  index: number,
  storyboard: CommerceImageStoryboard | undefined,
  parts: { productLock: string; personRule: string; safeZoneInstruction: string; storyContext: string }
) {
  if (isDirectCommerceKind(task.kind)) return buildDirectPanelPrompt(task, parts, seed);
  const textRequirement = detectCommerceImageTextRequirement(task.brief.extra);
  /* 营销引擎默认走程序排版：底图保持干净，中文由排版层叠加，不再要求模型写字。 */
  const marketingOverlay = Boolean(task.marketing && task.marketing.typography?.textMode === "overlay");
  const requiresInImageText = !marketingOverlay && textRequirement === "require";
  const mode = commerceImageModeLabel(task);
  const facts = taskFacts(task);

  const userRequest = cleanUserRequest(task.brief.extra);
  const userRequestBlock = userRequest
    ? [
      "【用户本轮原始需求 · 最高优先级】",
      "以下是用户原话，必须完整执行；与后面的任何默认风格、模板或系统建议冲突时，一律以本节为准。",
      userRequest,
      marketingOverlay
        ? "（说明：用户要的标题、卖点、CTA 等中文文字会由程序在生成后叠加到画面上。底图只负责画面内容并预留干净安全区，严禁在画面里生成任何中文、字母、数字、标签或类似文字的纹理。）"
        : ""
    ].filter(Boolean).join("\n")
    : "";
  const marketingBlock = buildMarketingPromptBlock(task, index);
  /* 程序排版模式下，底图「禁止写字」是技术硬约束，放在提示词最前面。 */
  const overlayBaseRule = marketingOverlay
    ? "【底图硬规则 · 最高优先级】只画真实商品、人物、场景、光影与构图，并预留干净留白。绝对不要在画面里生成任何中文、字母、数字、标题、卖点、标签、按钮、图标字形或类似文字的纹理；商品本体上原有的缝制商标、印花与包装字样必须保留。"
    : "";

  const productFactBlock = facts.length
    ? [
      "【产品资料 · 只能使用这些真实事实】",
      facts.map((fact) => `- ${fact}`).join("\n"),
      requiresInImageText
        ? "以上是画面文案唯一可用的卖点来源，可以直接改写成中文短句排到画面上。"
        : "本节只作为理解商品与文案的依据；本画面不需要画面内文字时，不要把这些字样画到画面上。"
    ].join("\n")
    : "";

  const systemPrompt = stripNoTextIntent(sanitizeCommerceImageGeneratorPrompt([
    parts.productLock,
    `生成一张${mode}的${requiresInImageText ? "完整营销图文画面（含画面内中文文案）" : "真实摄影底图"}。`,
    parts.storyContext,
    !parts.storyContext ? `可见画面任务：${cleanGeneratorVisual(seed.description, 760)}。` : "",
    task.brief.style ? `视觉方向：${cleanGeneratorVisual(task.brief.style, 420)}。` : "",
    `配色：${describeBrandPalette(task.brandProfile.primaryColor, task.brandProfile.secondaryColor)}。`,
    seed.referenceSegmentId ? "参考对标模块的空间层级、构图、留白、配色与光影，但不要复制竞品商品、品牌元素或宣传内容。" : "",
    parts.personRule,
    requiresInImageText ? "" : CLEAN_BASE_IMAGE_RULE,
    parts.safeZoneInstruction,
    "画面真实、商业摄影质感、边缘自然、商品结构准确，不做夸张功效暗示。"
  ].filter(Boolean).join("\n")));

  return [
    overlayBaseRule,
    userRequestBlock,
    requiresInImageText ? IN_IMAGE_TEXT_RULE : "",
    marketingBlock,
    productFactBlock,
    buildLogoTextBlock(task),
    `【当前模式】${mode}`,
    systemPrompt
  ].filter(Boolean).join("\n\n");
}

/**
 * 直连模式的薄提示词：只做「忠实执行 + 参考图保真 + 资料只作事实 + 不删用户要求」。
 * 在此基础上注入"本张转化任务"块（绑定卖点卡时），但用户原话仍最高优先级。
 */
function buildDirectPanelPrompt(
  task: CommerceImageTask,
  parts: { productLock: string; personRule: string },
  seed: PanelSeed
) {
  const requiresInImageText = detectCommerceImageTextRequirement(task.brief.extra) === "require";
  const facts = taskFacts(task).slice(0, 8);
  const userRequest = cleanUserRequest(task.brief.extra);
  const userBlock = userRequest
    ? [
      "【用户原始需求 · 最高优先级】",
      "严格按用户原话执行，不要改写、不要压缩、不要替用户重新决定创意方向。",
      userRequest
    ].join("\n")
    : "【用户原始需求】用户没有额外描述，请根据商品参考图生成一张干净、真实的商品图。";
  const card = seed.sellingPoint;
  const conversionBlock = card
    ? [
      "【本张转化任务 · 优先级低于用户原话】",
      `这张画面要卖的是「${card.label}」。`,
      card.audience ? `对谁：${card.audience}。` : "",
      card.painPoint ? `痛点/动机：${card.painPoint}。` : "",
      `画面必须真实拍到：${card.visualEvidence}。`,
      requiresInImageText && card.copyLine ? `配套中文短句：${card.copyLine}。` : "",
      "画面证据只能来自商品参考图与产品事实，不得编造价格、销量、认证、功效或检测报告。",
      "用户原话与本张转化任务冲突时，一律以用户原话为准。"
    ].filter(Boolean).join("\n")
    : "";
  const instruction = [
    "【直连执行要求】",
    "1. 忠实执行用户要求；用户明确要求的文字、卖点、标题、对比结构、营销元素、画面元素必须保留并执行，不得删除或改写。",
    "2. 尽量参考提供的商品参考图：颜色、版型、结构、logo、印花、袖口等保持一致，不要重新设计商品。",
    "3. 产品资料只作为事实参考；资料里没有的价格、销量、认证、功效、检测报告不要编造。",
    requiresInImageText
      ? "4. 用户要求画面内中文文字：请把中文正确、清晰、可读地排到画面上，不要出现乱码或错字。"
      : "4. 用户没有要求画面文字时，不要在画面上生成无关的说明文字。"
  ].join("\n");
  const factBlock = facts.length
    ? ["【产品事实 · 仅作参考，不要编造】", facts.map((fact) => "- " + fact).join("\n")].join("\n")
    : "";
  return [
    userBlock,
    instruction,
    requiresInImageText ? IN_IMAGE_TEXT_RULE : "",
    conversionBlock,
    buildLogoTextBlock(task),
    parts.productLock,
    factBlock,
    parts.personRule,
    "画面真实、商业摄影质感、边缘自然、商品结构准确；不要生成平台界面、按钮、二维码或水印。"
  ].filter(Boolean).join("\n\n");
}

/** 第五层 Prompt 编译结果进入最终提示词；平台名与坐标等会被统一清洗。 */
function buildMarketingPromptBlock(task: CommerceImageTask, index: number) {
  const record = task.marketing;
  if (!record?.creativePlan?.panels?.length) return "";
  if (!record.productFidelity || !record.typography) return "";
  const panel = record.creativePlan.panels[Math.min(Math.max(0, index), record.creativePlan.panels.length - 1)];
  if (!panel) return "";
  try {
    const compiled = compileMarketingPrompt({
      source: {
        productTruth: record.productTruth,
        intent: record.intent,
        strategy: record.strategy,
        creativePlan: record.creativePlan,
        productFidelity: record.productFidelity,
        typography: record.typography
      },
      panel,
      provider: task.resolvedModelId || ""
    });
    return sanitizeCommerceImageGeneratorPrompt(compiled.text);
  } catch {
    return "";
  }
}

function buildPanel(task: CommerceImageTask, seed: PanelSeed, index: number, storyboard?: CommerceImageStoryboard): CommerceImagePanel {
  const productAssets = task.sourceAssets.filter((asset) => isProductAssetRole(asset.role));
  /* 最高优先级：商品一致性。只要用户上传了商品参考图，任何场景、风格、营销要求
   * 都不得改变商品本身。这一段必须放在提示词最前面，权重高于其他所有指令。 */
  const productLock = productAssets.length
    ? [
      "【最高优先级 · 商品一致性】",
      "画面中的商品必须与用户上传的商品参考图完全一致：颜色与色相、版型、肩线与长度、连帽或立领结构、绗缝走向、袖口、口袋、拉链与五金、胸前标识的文字与图形、袖章、印花内容与位置，一律照参考图原样呈现。",
      "不得改变、简化、美化、替换或重新设计商品；不得凭空新增或删除结构、图案、五金与标识；不得为配合场景色调而降低商品颜色的饱和度、亮度或改变色相。",
      "当场景、风格、光线、构图、营销诉求与商品一致性冲突时，一律以商品参考图为准。商品一致性不可协商。"
    ].join("\n")
    : "不得虚构商品结构、功效、检测数据、价格、销量、品牌标识或认证。";
  /* 人物规则：由「用户需求 + 参考图内容」决定，不再由素材角色硬性禁止。
   * 参考图里本来就有真人穿着时，允许按用户需求延续同一人物与穿着。 */
  const personRule = productAssets.length
    ? "人物与场景以用户的需求和参考图为准：参考图中已有人物穿着该商品时，可以按用户需求延续同一人物的身形、发型、穿着方式与所在场景；用户没有要求人物时，不要额外添加无关人物。不得替换成另一个人，也不得改变穿着方式。"
    : "不添加无关人物；不得伪造模特或试穿效果。";
  const safeZoneInstruction = describeCleanSafeZones(seed.layoutGuide);
  const storyContext = storyboard && seed.storyboardCard
    ? [
      buildSeriesConsistencyAnchor(task, storyboard),
      `当前画面的传播职责：${marketingBeatForRole(seed.storyboardCard.role)}`,
      `当前画面的可见内容：${cleanGeneratorVisual(seed.storyboardCard.visual || seed.description, 680) || "围绕同一真实商品推进故事"}。`,
      seed.storyboardCard.role === "fact_proof"
        ? "证据镜头只能呈现真实参考图中看得见的面料纹理、绗线、拉链、袖口、领口、做工或包装细节；不能把填充量、成分、功效、认证或数值变成画面标签。"
        : "用构图、景别和场景变化推进叙事，不依赖任何画面内字样。",
      `人物边界：${PERSON_POLICY_TEXT}`
    ].join("\n")
    : "";
  const prompt = buildPanelPrompt(task, seed, index, storyboard, {
    productLock,
    personRule,
    safeZoneInstruction,
    storyContext
  });
  const xiaohongshu = task.kind === "xiaohongshu_post";
  const overlay: CommerceImageOverlay = {
    visible: task.kind !== "retouch" && Boolean(seed.overlayTitle || seed.overlayBody),
    title: seed.overlayTitle,
    body: seed.overlayBody,
    textColor: xiaohongshu ? "#211A1A" : "#ffffff",
    accentColor: xiaohongshu
      ? (task.brandProfile.primaryColor && task.brandProfile.primaryColor !== "#7c3aed" ? task.brandProfile.primaryColor : "#7B2D35")
      : task.brandProfile.primaryColor || "#7c3aed",
    position: xiaohongshu || index % 2 === 0 ? "top" : "bottom",
    align: xiaohongshu ? "left" : index % 3 === 0 ? "center" : "left"
  };
  return {
    id: `commerce_image_panel_${randomUUID()}`,
    kind: seed.kind,
    title: seed.title,
    description: seed.description,
    prompt,
    ratio: task.ratio,
    status: "draft",
    error: "",
    overlay,
    storyboardCardId: seed.storyboardCard?.id,
    sellingPointCardId: seed.sellingPoint?.id,
    sellingPoint: seed.sellingPoint,
    order: index,
    referenceSegmentId: seed.referenceSegmentId || "",
    layoutGuide: seed.layoutGuide,
    quality: xiaohongshu ? {
      status: "pending",
      productVisible: false,
      productFidelity: false,
      textSafe: false,
      storyFit: false,
      marketingFit: false,
      seriesConsistent: false,
      unexpectedText: false,
      detectedText: [],
      layoutRetryCount: 0,
      qualityRetryCount: 0,
      warnings: [],
      checkedAt: ""
    } : undefined,
    textLayers: task.marketing && task.marketing.typography?.textMode === "overlay"
      ? marketingToTextLayers(task.marketing, index)
      : overlay.visible ? buildTextLayers(overlay, seed.layoutGuide?.safeZones, xiaohongshu) : [],
    imageFit: task.kind === "retouch" ? "contain" : "cover",
    versions: [],
    selectedVersionId: ""
  };
}

/**
 * XHS is deliberately planned as one story before any individual image prompt
 * is built. This also gives legacy projects a deterministic, editable fallback
 * when they are first opened after the V3 migration.
 */
export function buildXiaohongshuStoryboard(task: CommerceImageTask, aiDraft?: CommerceImagePlanDraft): CommerceImageStoryboard {
  const now = new Date().toISOString();
  const product = task.productName || task.productSnapshot?.name || "这个商品";
  const facts = taskFacts(task);
  const count = Math.max(1, Math.min(9, task.brief.cardCount || 4));
  const prior = task.storyboard;
  const planner = aiDraft?.storyboard;
  const theme = safeText(planner?.theme, 160)
    || safeText(prior?.theme, 160)
    || safeText(task.brief.extra, 160)
    || `${product}的真实种草笔记`;
  const emotionalHook = safeText(planner?.emotionalHook, 100)
    || safeText(prior?.emotionalHook, 100)
    || (facts[0] ? `${facts[0]}，先把真实细节讲清楚` : `先看${product}真实是什么样`);
  const visualBible: CommerceImageVisualBible = {
    productAnchor: safeText(planner?.visualBible?.productAnchor, 320)
      || `以用户上传的${product}为唯一商品主体，锁定颜色、版型、材质、Logo、包装与可见文字。`,
    colorMood: stripDesaturation(safeText(planner?.visualBible?.colorMood, 240))
      || `${describeBrandPalette(task.brandProfile.primaryColor, task.brandProfile.secondaryColor)}；${task.brief.style || "真实、克制、有生活感"}；整组色彩分级保持一致。`,
    photography: stripDesaturation(safeText(planner?.visualBible?.photography, 240))
      || "同一组保持同一焦段、自然柔光、真实电商商品摄影、干净背景与清晰商品边缘。",
    typography: safeText(planner?.visualBible?.typography, 240)
      || "标题和正文由系统独立排版：克制深色文字、米白半透明底、统一字号层级，不把文字压在商品主体上。",
    scene: stripPersonProhibition(safeText(planner?.visualBible?.scene, 240)) || task.brief.scene || "围绕用户主题的真实生活场景。",
    subjectRule: PERSON_POLICY_TEXT,
    referenceAssetIds: task.sourceAssets.filter((asset) => isProductAssetRole(asset.role)).map((asset) => asset.id)
  };
  const roles = xiaohongshuRoles(count);
  const sourceCards = planner?.cards || prior?.cards || [];
  const cards = roles.map((role, index): CommerceImageStoryboardCard => {
    const draft = sourceCards[index];
    const fallback = xiaohongshuCardFallback(role, index, product, facts, task.brief.scene, emotionalHook);
    return {
      id: prior?.cards[index]?.id || `commerce_image_story_card_${randomUUID()}`,
      order: index,
      role: isStoryboardRole(draft?.role) ? draft.role : role,
      title: safeText(draft?.title, 80) || fallback.title,
      purpose: safeText(draft?.purpose, 360) || fallback.purpose,
      visual: safeText(draft?.visual, 600) || fallback.visual,
      copyIntent: safeText(draft?.copyIntent, 180) || fallback.copyIntent
    };
  });
  return {
    version: 1,
    theme,
    audience: task.brief.audience || task.productSnapshot?.targetAudience || "目标消费者",
    emotionalHook,
    summary: safeText(planner?.summary, 600)
      || safeText(prior?.summary, 600)
      || `围绕“${theme}”，按“${marketingPathForTask(task)}”推进，让每张图只承担一个明确营销任务。`,
    visualBible,
    cards,
    status: "planned",
    confirmedAt: "",
    updatedAt: now
  };
}

function xiaohongshuSeeds(task: CommerceImageTask, storyboard: CommerceImageStoryboard, points: string[]): PanelSeed[] {
  return storyboard.cards.map((card, index) => {
    const fact = points[index % Math.max(1, points.length)] || "以真实商品和资料为准";
    return {
      kind: card.role,
      title: card.title,
      description: `${card.purpose}；${card.visual}`,
      overlayTitle: card.copyIntent || card.title,
      overlayBody: card.role === "fact_proof" && card.copyIntent !== fact ? fact : "",
      storyboardCard: card,
      layoutGuide: xiaohongshuLayoutGuide(index, card.role)
    };
  });
}

function xiaohongshuRoles(count: number): CommerceImageStoryboardRole[] {
  // 必须严格返回 count 个角色：用户选几张就规划几张。
  if (count <= 1) return ["cover_hook"];
  if (count === 2) return ["cover_hook", "outfit_closing"];
  if (count === 3) return ["cover_hook", "scene_context", "outfit_closing"];
  const leading: CommerceImageStoryboardRole[] = ["cover_hook", "scene_context", "fact_proof"];
  return [...leading, ...Array.from({ length: Math.max(0, count - 4) }, () => "highlight" as const), "outfit_closing"];
}

function xiaohongshuCardFallback(role: CommerceImageStoryboardRole, index: number, product: string, points: string[], scene: string, emotionalHook: string) {
  const fact = points[index % Math.max(1, points.length)] || "真实商品细节";
  if (role === "cover_hook") return { title: "封面 · 情绪引子", purpose: "用一个能让目标用户停下来的情绪和主题，建立整篇笔记要讲什么。", visual: `${product}作为画面主体，场景、光线与色调按用户需求和参考图确定，商品主体放在画面下方或右侧。`, copyIntent: emotionalHook };
  if (role === "scene_context") return { title: "第二张 · 场景代入", purpose: "把主题落到用户熟悉的使用时刻，让读者自然代入。", visual: `${scene || "用户需求描述的"}真实生活场景，延续封面同一商品、色调与光线；是否出现人物以用户需求为准。`, copyIntent: scene ? `放进${scene}的日常里` : "把喜欢放进日常里" };
  if (role === "fact_proof") return { title: "第三张 · 真实证明", purpose: "用商品近景或局部画面证明前两张提出的选择理由。", visual: `放大${fact}对应的可见细节，背景保持干净，商品细节清晰。`, copyIntent: fact };
  if (role === "outfit_closing") return { title: "最后一张 · 收藏收尾", purpose: "收束主题，给读者一个克制的收藏或挑选理由，不强迫转化。", visual: `${product}完整陈列，延续同一摄影语言，预留上方文字区。`, copyIntent: "先收藏，按真实需求慢慢选" };
  return { title: `补充页 ${index + 1} · 细节延展`, purpose: "补足一个与主题有关的真实信息，使故事仍然向收尾推进。", visual: `围绕${fact}的局部或场景静物，保持同一色调、光线和留白。`, copyIntent: fact };
}

function xiaohongshuLayoutGuide(index: number, role: CommerceImageStoryboardRole): CommerceImageLayoutGuide {
  const presets: Array<{ subject: CommerceImageCanvasRegion; zones: Array<[number, number, number, number]> }> = [
    { subject: { x: 0.42, y: 0.28, width: 0.5, height: 0.64 }, zones: [[0.07, 0.07, 0.5, 0.13], [0.07, 0.22, 0.46, 0.1]] },
    { subject: { x: 0.5, y: 0.25, width: 0.43, height: 0.65 }, zones: [[0.07, 0.09, 0.42, 0.13], [0.07, 0.24, 0.38, 0.1]] },
    { subject: { x: 0.54, y: 0.18, width: 0.37, height: 0.66 }, zones: [[0.07, 0.12, 0.43, 0.13], [0.07, 0.27, 0.4, 0.1]] },
    { subject: { x: 0.38, y: 0.32, width: 0.52, height: 0.56 }, zones: [[0.08, 0.08, 0.52, 0.13], [0.08, 0.23, 0.46, 0.1]] }
  ];
  const preset = presets[index % presets.length];
  const safeZones = preset.zones.map(([x, y, width, height], zoneIndex): CommerceImageTextSafeZone => ({
    id: `planned_${role}_${index}_${zoneIndex}`,
    label: zoneIndex === 0 ? "标题留白" : "正文留白",
    confidence: "planned",
    x, y, width, height
  }));
  return { subjectBox: preset.subject, safeZones, source: "planned", checkedAt: "" };
}

function detailPageSeeds(task: CommerceImageTask, product: string, points: string[], scene: string): PanelSeed[] {
  if (task.referenceAnalysis.segments.length) {
    const targetCount = Math.max(1, Math.min(12, task.brief.cardCount || task.referenceAnalysis.segments.length));
    const segments = Array.from({ length: targetCount }, (_, index) => {
      const sourceIndex = Math.min(task.referenceAnalysis.segments.length - 1, Math.floor(index * task.referenceAnalysis.segments.length / targetCount));
      return task.referenceAnalysis.segments[sourceIndex];
    });
    return segments.map((segment, index) => ({
      kind: segment.kind || "detail",
      title: segment.title || `详情模块 ${index + 1}`,
      description: [
        `参考对标长图的第 ${index + 1} 个模块`,
        segment.layout ? `版式：${segment.layout}` : "",
        segment.style ? `风格：${segment.style}` : "",
        `用${product}替换竞品主体，并用用户事实重写卖点`
      ].filter(Boolean).join("；"),
      overlayTitle: points[index % Math.max(1, points.length)] || (index === 0 ? product : "真实细节展示"),
      overlayBody: index === 0 ? (points[0] || scene) : (points[(index + 1) % Math.max(1, points.length)] || "以实际商品为准"),
      referenceSegmentId: segment.id
    }));
  }
  const fallback: PanelSeed[] = [
    { kind: "hero", title: "首屏主视觉", description: `${product}主体清晰，建立第一眼价值感`, overlayTitle: product, overlayBody: points[0] || "先看真实商品" },
    { kind: "problem", title: "需求与痛点", description: `呈现${scene}中的真实需求，不虚构效果`, overlayTitle: "为什么值得认真选", overlayBody: points[0] || "从实际需求出发" },
    { kind: "benefit", title: "核心卖点", description: `聚焦${points[0] || "核心商品细节"}`, overlayTitle: points[0] || "核心细节", overlayBody: points[1] || "真实呈现，不夸张" },
    { kind: "detail", title: "细节证明", description: `用微距与局部构图呈现${points[1] || "材质和做工"}`, overlayTitle: "放大细节", overlayBody: points[1] || "以参考图为准" },
    { kind: "scene", title: "使用场景", description: `展示${scene}`, overlayTitle: "适合这些场景", overlayBody: scene },
    { kind: "closing", title: "收束转化", description: `完整呈现${product}并留出行动引导`, overlayTitle: "按真实需求选择", overlayBody: product }
  ];
  // 没有拆解出对标模块时，也必须尊重用户选择的张数。
  return fallback.slice(0, Math.max(1, Math.min(12, task.brief.cardCount || fallback.length)));
}

function socialSeeds(task: CommerceImageTask, product: string, points: string[], audience: string, scene: string): PanelSeed[] {
  const count = Math.max(1, Math.min(9, task.brief.cardCount || (task.kind === "xiaohongshu_post" ? 6 : 5)));
  const strategy = strategyLabel(task.brief.strategy);
  const base: PanelSeed[] = [
    { kind: "cover", title: "封面", description: `${strategy}方向的高信息密度封面，让${audience}快速看懂主题`, overlayTitle: task.kind === "douyin_post" ? `${product}怎么选？` : `${product}真实体验`, overlayBody: points[0] || "先看这个关键细节" },
    { kind: "problem", title: "痛点代入", description: `呈现${scene}里的典型困扰`, overlayTitle: "你是不是也遇到过", overlayBody: "先看需求，再看商品" },
    { kind: "answer", title: "商品解法", description: `用真实商品画面说明${points[0] || "核心选择标准"}`, overlayTitle: points[0] || "核心选择标准", overlayBody: "不靠夸张承诺" },
    { kind: "detail", title: "细节证据", description: `放大${points[1] || points[0] || "材质与做工"}`, overlayTitle: "放大细节再决定", overlayBody: points[1] || "真实展示更可信" },
    { kind: "advice", title: "选择建议", description: "客观呈现适合与不适合的场景", overlayTitle: "适合谁 / 不适合谁", overlayBody: "根据真实需求选择" },
    { kind: "ending", title: "收尾互动", description: `${product}完整陈列并留出收藏或评论引导`, overlayTitle: task.kind === "douyin_post" ? "你更在意哪一点？" : "先收藏，再慢慢选", overlayBody: product }
  ];
  while (base.length < count) {
    const index = base.length;
    base.splice(base.length - 1, 0, {
      kind: "highlight",
      title: `卖点 ${index - 3}`,
      description: `用独立画面呈现${points[index % Math.max(1, points.length)] || "一个真实商品细节"}`,
      overlayTitle: points[index % Math.max(1, points.length)] || "真实商品细节",
      overlayBody: "信息以用户资料为准"
    });
  }
  return base.slice(0, count);
}

function retouchSeeds(task: CommerceImageTask): PanelSeed[] {
  const labels: Record<CommerceImageTask["brief"]["retouchOperation"], string> = {
    white_background: "纯白底精修", transparent_background: "透明底抠图", change_scene: "更换商品场景", remove_clutter: "清除杂物",
    light_color: "光线与色彩校正", upscale: "清晰度增强", crop: "构图裁切", batch_consistency: "批量视觉统一"
  };
  const label = labels[task.brief.retouchOperation];
  const count = Math.max(1, task.sourceAssets.filter((asset) => isProductAssetRole(asset.role)).length);
  return Array.from({ length: count }, (_, index) => ({
    kind: "retouch", title: count > 1 ? `${label} ${index + 1}` : label,
    description: `${label}；仅处理对应商品参考图，保持商品颜色、比例、纹理、文字和结构不变`, overlayTitle: "", overlayBody: ""
  }));
}

function mergeAiDraft(localSeeds: PanelSeed[], aiDraft?: CommerceImagePlanDraft) {
  if (!aiDraft?.panels?.length) return localSeeds;
  return localSeeds.map((seed, index) => {
    const patch = aiDraft.panels?.[index];
    if (!patch) return seed;
    return {
      ...seed,
      kind: safeText(patch.kind, 60) || seed.kind,
      title: safeText(patch.title, 80) || seed.title,
      description: [safeText(patch.description, 600), safeText(patch.layout, 300), safeText(patch.style, 300)].filter(Boolean).join("；") || seed.description,
      overlayTitle: safeText(patch.headline, 80) || seed.overlayTitle,
      overlayBody: safeText(patch.body, 160) || seed.overlayBody
    };
  });
}

function buildPublishPackage(task: CommerceImageTask, product: string, points: string[], audience: string, draft?: CommerceImagePlanDraft, storyboard?: CommerceImageStoryboard): CommerceImagePublishPackage {
  if (task.kind === "detail_page" || task.kind === "retouch") return { title: product, body: "", tags: [], complianceWarnings: buildComplianceWarnings(task) };
  const title = safeText(draft?.publishTitle, 120) || (task.kind === "xiaohongshu_post" && storyboard ? storyboard.emotionalHook : `${product}怎么选？先看这些真实细节`);
  const body = safeText(draft?.publishBody, 6000) || [
    task.kind === "xiaohongshu_post" && storyboard ? `主题：${storyboard.theme}` : `给正在选${product}的${audience}：`,
    ...points.slice(0, 4).map((point, index) => `${index + 1}. ${point}`),
    task.brief.scene ? `放到「${task.brief.scene}」里判断是否适合自己。` : "",
    "图片与描述均以实际商品和用户提供资料为准。"
  ].filter(Boolean).join("\n\n");
  return {
    title,
    body,
    tags: unique([...(draft?.tags || []).map((item) => safeText(item, 40)), product, task.kind === "douyin_post" ? "抖音图文" : "小红书图文", ...points.slice(0, 2)]).slice(0, 12),
    complianceWarnings: buildComplianceWarnings(task)
  };
}

function buildTextLayers(overlay: CommerceImageOverlay, safeZones?: CommerceImageTextSafeZone[], xiaohongshu = false): CommerceImageTextLayer[] {
  const top = overlay.position === "top";
  const align = overlay.align;
  const titleZone = safeZones?.find((zone) => zone.label === "标题留白");
  const bodyZone = safeZones?.find((zone) => zone.label === "正文留白") || titleZone;
  const common = { fontFamily: "sans" as const, backgroundColor: xiaohongshu ? "#F7F1E8" : "#000000", backgroundOpacity: xiaohongshu ? 0.88 : 0, visible: true, locked: false };
  const layers: CommerceImageTextLayer[] = [];
  if (overlay.title) {
    layers.push({ id: `commerce_image_text_${randomUUID()}`, name: "标题", text: overlay.title, x: titleZone?.x ?? 0.08, y: titleZone?.y ?? (top ? 0.08 : 0.69), width: titleZone?.width ?? 0.84, height: titleZone?.height ?? 0.14, fontSize: xiaohongshu ? 0.052 : 0.06, fontWeight: 800, lineHeight: 1.14, color: overlay.textColor, align, ...common });
  }
  if (overlay.body) {
    layers.push({ id: `commerce_image_text_${randomUUID()}`, name: "正文", text: overlay.body, x: bodyZone?.x ?? 0.08, y: bodyZone?.y ?? (top ? 0.24 : 0.84), width: bodyZone?.width ?? 0.84, height: bodyZone?.height ?? 0.1, fontSize: xiaohongshu ? 0.027 : 0.032, fontWeight: xiaohongshu ? 600 : 500, lineHeight: 1.3, color: overlay.accentColor, align, ...common });
  }
  return layers;
}

function buildWarnings(task: CommerceImageTask) {
  const warnings: string[] = [];
  const products = task.sourceAssets.filter((asset) => isProductAssetRole(asset.role));
  if (!products.length) warnings.push("尚未上传自己的商品图；生成前必须补充至少一张真实商品图。");
  if (task.kind === "detail_page" && !task.sourceAssets.some((asset) => asset.role === "benchmark_reference")) warnings.push("尚未上传对标详情长图。");
  return unique([...warnings, ...buildComplianceWarnings(task)]);
}

function buildComplianceWarnings(task: CommerceImageTask) {
  const warnings: string[] = [];
  if (task.productSnapshot?.forbiddenWords) warnings.push(`禁用词：${task.productSnapshot.forbiddenWords}`);
  if (task.productSnapshot?.forbiddenClaims) warnings.push(`禁用宣称：${task.productSnapshot.forbiddenClaims}`);
  warnings.push("不得生成资料中没有的价格、销量、认证、功效、检测报告或代言信息。");
  return unique(warnings);
}

function taskFacts(task: CommerceImageTask) {
  return unique([
    ...task.productFacts.filter((fact) => fact.confidence !== "uncertain").map((fact) => fact.value),
    ...splitFacts(task.brief.sellingPoints || task.productSnapshot?.coreSellingPoints || ""),
    task.productSnapshot?.productFacts || "",
    task.productSnapshot?.specifications || "",
    task.productSnapshot?.colors || ""
  ]).slice(0, 12);
}

function isProductAssetRole(role: string) {
  return !["benchmark_reference", "reference_segment", "style_reference", "skill_reference"].includes(role);
}

function isStoryboardRole(value: unknown): value is CommerceImageStoryboardRole {
  return ["cover_hook", "scene_context", "fact_proof", "outfit_closing", "highlight"].includes(String(value));
}

function strategyLabel(value: CommerceImageTask["brief"]["strategy"]) {
  return ({ auto: "AI 推荐", pain_point: "买家痛点", contrast: "强对比", scenario: "场景种草", emotion: "情绪共鸣", listicle: "清单知识", evidence: "测评证据", custom_skill: "自定义 Skill" } as const)[value];
}

function splitFacts(value: string) { return unique(value.split(/[\n；;、]+/).map((item) => item.trim()).filter(Boolean)).slice(0, 10); }
function unique(values: string[]) { return [...new Set(values.map((item) => item.trim()).filter(Boolean))]; }
function safeText(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
