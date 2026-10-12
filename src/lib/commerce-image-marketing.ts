import type {
  CommerceImageLayoutGuide,
  CommerceImageMarketingStrategy,
  CommerceImageStoryboard,
  CommerceImageStoryboardRole,
  CommerceImageTask
} from "@/lib/commerce-image-types";

/**
 * The prompt-sanitising and repeated series-anchor patterns in this module are
 * adapted from motiful/product-shots (MIT), commit 063c508b0b7f4db5cda89f10bdf20df25026dfc5.
 * The original license is bundled at docs/licenses/motiful-product-shots-MIT.txt.
 *
 * We intentionally keep this as a small, dependency-free compatibility layer:
 * the upstream Agent Skills runtime and image gateway are not embedded here.
 */

export type CommerceImageEngagementGoal = "save" | "share" | "comment";

const SAFE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(?:xiaohongshu|rednote)\b|小红书/gi, "生活方式内容系列"],
  [/\b(?:tiktok|douyin)\b|抖音/gi, "移动端竖版内容系列"],
  [/\b(?:instagram|facebook|pinterest|linkedin|twitter)\b/gi, "社交内容系列"],
  [/\b(?:carousel|feed|story|reel|post)\b/gi, "series image"],
  [/图文卡片|图文内容|社媒帖子|社交媒体帖子/g, "系列画面"],
  [/封面图/g, "系列开场画面"],
  [/广告图|广告创意|促销海报/g, "商品传播画面"]
];

const REMOVED_GENERATOR_TERMS: RegExp[] = [
  /\b(?:like|share|comment|follow|save)\s+(?:button|icon|count|section)\b/gi,
  /\b(?:sponsored|promoted|ad manager|boost post|campaign)\b/gi,
  /\b(?:screenshot|phone screen|mobile mockup|app interface|ui design)\b/gi,
  /\b(?:canva|figma|photoshop|lightroom|adobe)\b/gi,
  /(?:点赞|评论|转发|关注|收藏)(?:按钮|图标|数量|区域)?/g,
  /(?:用户名|粉丝数|状态栏|手机边框|应用界面|平台界面|二维码)/g
];

const BANNED_TERM_CHECKS: Array<{ label: string; pattern: RegExp }> = [
  { label: "平台名", pattern: /\b(?:xiaohongshu|rednote|tiktok|douyin|instagram|facebook|pinterest|linkedin|twitter)\b|小红书|抖音/i },
  { label: "平台交互组件", pattern: /\b(?:like|share|comment|follow|save)\s+(?:button|icon|count|section)\b|点赞按钮|评论按钮|转发按钮|关注按钮|收藏按钮/i },
  { label: "截图或界面", pattern: /\b(?:screenshot|phone screen|mobile mockup|app interface|ui design)\b|状态栏|手机边框|应用界面|平台界面/i },
  { label: "工具名", pattern: /\b(?:canva|figma|photoshop|lightroom|adobe)\b/i }
];

export const CLEAN_BASE_IMAGE_RULE = [
  "只生成摄影底图，不添加任何悬浮字样、标题、正文、说明、数字、角标、按钮、图标、边框、二维码或水印。",
  "不要把提示词里的任何词句抄到画面上，也不要生成类似文字的乱码纹理。",
  "但必须完整保留真实商品本体上原有的印花、缝制商标、包装字样和物理标记；不得删除、重写或另造。"
].join("\n");

/* 用户明确要求在画面里放文字时，用这一条替代上面的「干净底图」规则。
 * 二者互斥：同时出现会让模型收到自相矛盾的指令（这正是之前出图没有文字的原因）。 */
export const IN_IMAGE_TEXT_RULE = [
  "【画面文字要求 · 用户明确要求，必须执行】",
  "必须在画面中排入清晰、正确、可读的中文文案，不要只给摄影底图。",
  "文案只能取自下面的用户需求和真实产品资料，不得编造价格、销量、认证、功效、检测报告或用户评价。",
  "文字要有明确的营销层级：一个主标题 + 3 条以内卖点短句，必要时加一句收尾；字号、位置和留白要像真实社交平台的营销图文。",
  "文字必须写成规范的简体中文，不得出现乱码、错字、缺笔或英文乱码纹理；不得把文字压在商品主体或人物脸上。",
  "在保持商品与参考图一致的前提下，可以为了文字排版重新安排构图、留白和背景。"
].join("\n");

export type CommerceImageTextRequirement = "require" | "forbid" | "unspecified";

const TEXT_FORBID_PATTERNS: RegExp[] = [
  /不要(?:任何|出现|加|写|带)?\s*(?:画面|图片)?(?:内|里|中)?(?:的)?(?:中文|英文|任何)?(?:文字|文案|卖点|标题|字幕)/,
  /(?:无|没有|不带|不加|不用)(?:任何)?(?:中文|英文)?(?:文字|文案|卖点|标题|字幕|字)/,
  /纯(?:人物|商品|摄影|图片|图)(?!文)/,
  /no\s*text/i,
  /without\s*(?:any\s*)?text/i,
  /text[- ]?free/i,
  /plain\s*(?:photo|image)/i
];

const TEXT_REQUIRE_PATTERNS: RegExp[] = [
  /文字/,
  /文案/,
  /卖点/,
  /字幕/,
  /标题/,
  /排版/,
  /图文/,
  /海报/,
  /种草/,
  /字\s*(?:要|必须)/,
  /\btext\s+(?:on|in|over)\b/i,
  /must\s+(?:include|have|contain)\s+text/i,
  /with\s+(?:chinese\s+)?text/i
];

/**
 * 从用户原话里判断他到底要不要「画面内文字」。
 * 判定顺序：明确禁止 > 明确要求 > 未提及（未提及时保持原来的干净底图行为）。
 */
export function detectCommerceImageTextRequirement(input: string | undefined): CommerceImageTextRequirement {
  const value = (input || "").trim();
  if (!value) return "unspecified";
  if (TEXT_FORBID_PATTERNS.some((pattern) => pattern.test(value))) return "forbid";
  if (TEXT_REQUIRE_PATTERNS.some((pattern) => pattern.test(value))) return "require";
  return "unspecified";
}

/** 用户要求画面内文字时，清掉系统模板里「不依赖画面内字样」这类互相矛盾的措辞。 */
export function stripNoTextIntent(value: string) {
  return value
    .replace(/[，,；;]?\s*不依赖(?:任何)?画面内字样。?/g, "")
    .replace(/不依赖(?:任何)?画面内字样/g, "")
    .replace(/，\s*。/g, "。")
    .replace(/；\s*；/g, "；")
    .trim();
}

/** 用户原话进入提示词前的唯一处理：去掉链接和多余空行，不改写、不压缩、不删除语义。 */
export function cleanUserRequest(value: string) {
  return (value || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}

export function commerceImageModeLabel(task: Pick<CommerceImageTask, "kind">) {
  if (task.kind === "detail_page") return "电商详情图复刻";
  if (task.kind === "retouch") return "商品精修";
  if (task.kind === "douyin_post") return "抖音图文";
  if (task.kind === "xiaohongshu_post") return "小红书图文";
  return "电商图文";
}

export function engagementGoalForStrategy(strategy: CommerceImageMarketingStrategy): CommerceImageEngagementGoal {
  if (strategy === "contrast") return "comment";
  if (strategy === "emotion" || strategy === "scenario" || strategy === "pain_point") return "share";
  return "save";
}

export function engagementGoalLabel(goal: CommerceImageEngagementGoal) {
  if (goal === "share") return "情绪共鸣与转发";
  if (goal === "comment") return "观点互动与评论";
  return "实用价值与收藏";
}

export function marketingPathForTask(task: Pick<CommerceImageTask, "brief">) {
  const goal = engagementGoalForStrategy(task.brief.strategy);
  if (goal === "share") return "情绪钩子 → 场景共鸣 → 商品证明 → 分享收束";
  if (goal === "comment") return "反差钩子 → 观点代入 → 商品证据 → 讨论收束";
  return "停留钩子 → 场景代入 → 事实证明 → 收藏收尾";
}

export function marketingBeatForRole(role: CommerceImageStoryboardRole) {
  if (role === "cover_hook") return "用高辨识度商品主角和明确情绪场景形成视觉钩子，让人第一眼愿意继续看；不依赖画面内字样。";
  if (role === "scene_context") return "承接开场，把同一商品放进具体生活时刻，形成代入感；延续相同色调和光线，但更换景别。";
  if (role === "fact_proof") return "镜头推进到真实可见的面料、绗线、拉链、袖口、领口或包装细节，用可见证据建立可信感；不可把成分、填充量或认证画成标签。";
  if (role === "outfit_closing") return "回到完整商品或整体陈列，收束前面的情绪和证据，留下克制、值得保存参考的结束画面。";
  return "补充一个与总主题直接相关的新场景或可见细节，让信息继续向结论推进，不另起主题。";
}

/* ---------------------------------------------------------------- 商品标识文字 */

/**
 * 从产品事实里筛出「商品上的印刷文字」（label 含 文字/标识/印花/字母/logo）。
 * 数据来源是事实提取阶段的逐字转录（commerce-image-analysis），供提示词与质检共同引用。
 */
export function productLogoTextFacts(task: Pick<CommerceImageTask, "productFacts">): Array<{ label: string; value: string }> {
  return (task.productFacts || [])
    .filter((fact) => fact.confidence !== "uncertain")
    .filter((fact) => /(文字|标识|印花|字母|logo)/i.test(fact.label))
    .map((fact) => ({ label: fact.label, value: fact.value }))
    .slice(0, 8);
}

/** 提示词用的标识文字块：没有可引用的文字事实时返回空串。 */
export function buildLogoTextBlock(task: Pick<CommerceImageTask, "productFacts">): string {
  const facts = productLogoTextFacts(task);
  if (!facts.length) return "";
  return [
    "【商品标识文字 · 必须逐字还原】",
    ...facts.map((fact) => `${fact.label}：${fact.value}`),
    "以上文字必须与商品参考图逐字一致：不得增删字母、不得改拼写、不得画成乱码或不可读的纹理；看不清时宁可弱化处理，也不得写错。"
  ].join("\n");
}

/* 历史任务里存档的 storyboard 可能带着旧策略留下的「禁止人物」与「降低饱和」措辞。
 * 这些措辞会直接进入出图提示词，与「商品一致性最高优先级 + 人物由用户需求决定」冲突，
 * 因此在任何复用点都必须清掉，而不是原样继承。 */
export function stripPersonProhibition(value: string) {
  return value
    .replace(/[，、；]?\s*(?:均为|全部为|全部使用)?无人物[^。；，、]*/g, "")
    .replace(/[，、；]?\s*不(?:出现|得出现|要出现)(?:模特|人物|试穿|连续人物)[^。；]*/g, "")
    .replace(/[，、；]?\s*禁止[^。；]*?(?:模特|人物|试穿|连续人物)[^。；]*/g, "")
    .replace(/[，、；]?\s*不得(?:生成|出现)[^。；]*?(?:模特|试穿|连续人物)[^。；]*/g, "")
    .replace(/[，、；]?\s*商品陈列、局部细节或场景静物[^。；]*/g, "")
    .replace(/，{2,}/g, "，")
    .replace(/^[，、；\s]+|[，、；\s]+$/g, "")
    .trim();
}

export function stripDesaturation(value: string) {
  return value
    .replace(/低饱和(?:暖调|中性色|色调)?/g, "")
    .replace(/低饱和/g, "")
    .replace(/不刺眼/g, "")
    .replace(/，{2,}/g, "，")
    .replace(/^[，、；\s]+|[，、；\s]+$/g, "")
    .trim();
}

/** 人物边界现在是系统策略，不再复用 AI 或历史数据里的说法。 */
export const PERSON_POLICY_TEXT = "人物与场景以用户需求和参考图为准：参考图中已有人物穿着商品时，可按用户需求延续同一人物的身形、发型、穿着方式与所在场景；用户未要求人物时不要额外添加无关人物。不得替换成另一个人，也不得改变穿着方式。";

export function buildSeriesConsistencyAnchor(task: CommerceImageTask, storyboard: CommerceImageStoryboard) {
  const theme = cleanGeneratorVisual(storyboard.theme, 180) || "围绕同一商品和同一生活主题";
  const color = stripDesaturation(cleanGeneratorVisual(storyboard.visualBible.colorMood, 260)) || "以商品真实主色为锚点，背景色调按用户需求与参考图确定";
  const photography = stripDesaturation(cleanGeneratorVisual(storyboard.visualBible.photography, 260)) || "统一自然柔光、镜头质感和色彩分级";
  const scene = stripPersonProhibition(cleanGeneratorVisual(storyboard.visualBible.scene, 220)) || "统一且可连续理解的生活场景";
  return [
    `连续系列统一基准：画面始终围绕${theme}。`,
    `整组固定同一件真实商品、同一颜色与材质、同一季节和地点逻辑；${color}；${photography}；场景基准为${scene}。`,
    "每一张只推进景别、动作或细节，不更换商品身份、主色、摄影语言或故事主题。"
  ].join("\n");
}

export function describeCleanSafeZones(guide?: CommerceImageLayoutGuide) {
  if (!guide?.safeZones.length) return "在画面一侧保留一块平整、低纹理、对比稳定的干净背景区域；商品主体、人物脸、手和关键细节不得进入。";
  const positions = [...new Set(guide.safeZones.map((zone) => regionPosition(zone)))];
  return `将画面的${positions.join("与")}保持为平整、低纹理、对比稳定的干净背景留白；商品主体、人物脸、手和关键细节不得进入这些区域。`;
}

export function describeBrandPalette(primary: string, secondary: string) {
  const colors = [primary, secondary]
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index && value.toLowerCase() !== "#7c3aed")
    .map(hexColorName)
    .filter(Boolean);
  /* 商品颜色不可被场景或品牌色调改变；品牌色只作用于场景氛围与文字排版。 */
  const protectProduct = "商品本身的颜色必须忠实还原参考图，不得为配合场景或品牌色调而改变色相、降低饱和度或压暗提亮。";
  return colors.length
    ? `品牌配色参考${colors.join("和")}，仅用于场景氛围与文字排版；${protectProduct}`
    : `场景与背景色调按用户需求和参考图确定；${protectProduct}`;
}

export function cleanGeneratorVisual(value: string, max = 900) {
  return sanitizeCommerceImageGeneratorPrompt(value)
    .replace(/[“”「」『』\"']/g, "")
    .replace(/(?:标题|正文|文案|字幕|标签|角标|按钮|价格)[^。；\n]*[。；]?/g, "")
    .replace(/[0-9０-９]+(?:[.,．][0-9０-９]+)?\s*(?:%|％|倍|元|块|克|千克|kg|g|cm|mm|件|张|页)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/；{2,}/g, "；")
    .trim()
    .slice(0, max);
}

export function sanitizeCommerceImageGeneratorPrompt(value: string) {
  let next = value.replace(/https?:\/\/\S+/gi, "");
  for (const [pattern, replacement] of SAFE_REPLACEMENTS) next = next.replace(pattern, replacement);
  for (const pattern of REMOVED_GENERATOR_TERMS) next = next.replace(pattern, "");
  next = next
    .replace(/#[0-9a-f]{3,8}\b/gi, "指定品牌色")
    .replace(/(?:x|y)\s*=\s*\d+(?:\.\d+)?%?(?:\s*[-~至]\s*\d+(?:\.\d+)?%?)?/gi, "")
    .replace(/\b\d+\s*[x×*]\s*\d+\b/gi, "")
    .replace(/第\s*\d+\s*\/\s*\d+\s*张/g, "当前画面")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([。；，])/g, "$1")
    .trim();
  return next;
}

export function findBannedGeneratorTerms(value: string) {
  return BANNED_TERM_CHECKS.filter(({ pattern }) => pattern.test(value)).map(({ label }) => label);
}

function regionPosition(region: { x: number; y: number; width: number; height: number }) {
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  const horizontal = centerX < 0.38 ? "左侧" : centerX > 0.62 ? "右侧" : "中部";
  const vertical = centerY < 0.34 ? "上方" : centerY > 0.66 ? "下方" : "中段";
  return `${horizontal}${vertical}`;
}

function hexColorName(value: string) {
  const match = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return "品牌色";
  const number = Number.parseInt(match[1], 16);
  const r = (number >> 16) & 255;
  const g = (number >> 8) & 255;
  const b = number & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 510;
  const prefix = lightness < 0.3 ? "深" : lightness > 0.78 ? "浅" : "";
  if (max - min < 24) return `${prefix}${lightness > 0.65 ? "暖灰" : "中性灰"}`;
  if (r >= g * 1.2 && r >= b * 1.2) return `${prefix}${g > b * 1.45 ? "橙红" : b > g * 1.3 ? "酒红" : "红色"}`;
  if (g >= r * 1.15 && g >= b * 1.08) return `${prefix}${b > r ? "青绿" : "绿色"}`;
  if (b >= r * 1.12 && b >= g * 1.08) return `${prefix}${r > g * 1.15 ? "紫蓝" : "蓝色"}`;
  if (r > b * 1.2 && g > b * 1.2) return `${prefix}暖黄色`;
  return `${prefix}品牌色`;
}
