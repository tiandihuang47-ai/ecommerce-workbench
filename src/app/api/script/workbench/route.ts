import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getDeepSeekErrorMessage, safeJsonParse } from "@/lib/deepseek";
import { generateCopywritingText } from "@/lib/copywriting-service";
import { copySection, toCopyOnlyDocument } from "@/lib/script-workbench";
import { detectScriptIntent, intentDirective } from "@/lib/script-intent";
import { sanitizeScriptCopy } from "@/lib/script-copy";
import type { DirectionOption, ScriptDocument } from "@/lib/script-workbench";

export const runtime = "nodejs";
export const maxDuration = 120;

const legacyPictureTerm = `b${"roll"}`;
const maxPromptChars = 20000;

type ReferencePayload = {
  kind?: "video" | "text" | "document";
  name?: string;
  summary?: string;
  analysis?: string;
  transcript?: string;
  extractedText?: string;
  facts?: string[];
  inferences?: string[];
};

type WorkbenchBody = {
  action?: string;
  productText?: string;
  brief?: string;
  references?: ReferencePayload[];
  previous?: string[];
  direction?: DirectionOption | null;
  mode?: "natural" | "impact" | "replace" | "custom";
  instruction?: string;
  label?: string;
  content?: string;
  context?: string;
  document?: ScriptDocument;
  /** 没有脚本时的底稿（抖音逐字稿）：AI 助手可以直接在它上面仿写/优化。 */
  baseText?: string;
  baseTitle?: string;
  /** generate 的路径：adapt=以 baseText 为底稿仿写；fresh=重新创作一条。不传时按 brief 的意图自动判定。 */
  generateMode?: "adapt" | "fresh";
  /** 观众评论洞察 + 代表性原评论（客户端用 buildCommentContextBlock 生成，已做采样，不是 200 条原文）。 */
  commentContext?: string;
  name?: string;
  transcript?: string;
  text?: string;
  /** 创作档案文本块（服务端原样注入提示词，不解析） */
  profileBlock?: string;
  /** 已确认经验文本块（selectExperiencesForTask 的确定性筛选结果） */
  experienceBlock?: string;
  /** 锁定内容块：全局改稿/重新生成时必须逐字保留 */
  lockBlock?: string;
  /** 同档案最近选题/稿件标题（去重提醒，最多 30 条） */
  recentTitles?: string[];
  /** revise：选区字符区间（含头不含尾）与正文哈希 */
  selectionStart?: number;
  selectionEnd?: number;
  baseContentHash?: string;
};

/** 底稿类修改（仿写/优化/换产品/局部）与整份脚本修改共用的输出约束。 */
const copyOnlyOutputRule = [
  "输出纯 JSON：{\"title\":\"\",\"sections\":[{\"key\":\"script\",\"label\":\"文案\",\"content\":\"\"}]}。",
  "content 里只写能照着念的台词，一行一句；两个人对话时每行用「女生：」「男生：」开头，只有一个人说话就不加前缀。",
  "严禁括号里的动作、表情、语气提示，不要写镜头、画面、分镜、动作、拍摄等说明。",
  "不要写解释、创作理论或 Markdown。"
].join("\n");

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: WorkbenchBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "recommend":
        return handleRecommend(body);
      case "generate":
        return handleGenerate(body);
      case "revise":
        return handleRevise(body);
      case "extractExperience":
        return handleExtractExperience(body);
      case "editSection":
        return handleEditSection(body);
      case "compose":
        return handleCompose(body);
      case "ask":
        return handleAsk(body);
      case "assistant":
        return handleAssistant(body);
      case "analyzeVideo":
        return handleAnalyzeVideo(body);
      case "analyzeText":
        return handleAnalyzeText(body);
      case "analyzeDocument":
        return handleAnalyzeDocument(body);
      default:
        return NextResponse.json({ success: false, message: "不支持的操作类型。" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, message: getDeepSeekErrorMessage(error) || "AI 请求失败，请稍后重试。" },
      { status: 502 }
    );
  }
}

/** 文本生成统一出口：主模型 claude-opus-5-5，失败自动回退 DeepSeek；返回真实来源。 */
async function callAi(systemPrompt: string, userPrompt: string, temperature: number, purpose: string) {
  const result = await generateCopywritingText({ purpose, system: systemPrompt, user: userPrompt, temperature });
  const text = result.text.replace(new RegExp(`\\bb[\\s-]?${"roll"}\\b`, "gi"), "画中画");
  return { text, source: result.source };
}

function extractJson(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return value;
  return value.slice(start, end + 1);
}

function clip(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > maxPromptChars ? text.slice(0, maxPromptChars) : text;
}

/**
 * 「评论怎么用」的硬规则。四个入口（推荐方向 / 生成 / 仿写 / AI 助手）共用一份，
 * 避免模型拿到评论只是"看到"而不用，或者反过来被评论带偏产品事实。
 */
const commentUsageRule = [
  "如果输入里有【观众评论洞察】：",
  "1. 它是观众看完原视频后的真实反馈，用来决定这一条的角度：优先回应出现频率最高的问题和最大的购买阻力。",
  "2. 一条内容只解决一个主要问题。评论里有多个问题也不要把它们塞进同一条脚本，选最值得放大的那一个。",
  "3. 评论只能影响角度、选题和表达方式；产品参数、价格、材质、功效一律以【产品资料】为准，评论里的说法不能当成事实写进内容。",
  "4. 可以短引用代表性评论的原话，但不要改写后冒充消费者真实评价。"
].join("\n");

/**
 * 观众评论上下文块：告诉模型「观众听完以后在想什么」（§二十六）。
 * 明确标注它不是产品事实，避免评论里的说法被写进产品参数（§二十一/§二十二）。
 */
function buildCommentBlock(commentContext?: string) {
  const text = clip(commentContext);
  if (!text) return "";
  return [
    "【观众评论洞察】（观众真实反馈，用来判断选题与购买阻力；**不是产品事实**，不能当作参数、价格或功效的依据）",
    text
  ].join("\n");
}

function buildReferenceBlock(references: ReferencePayload[] = []) {
  if (references.length === 0) return "【参考资料】无";
  return [
    "【参考资料】",
    ...references.map((item) => {
      const kindLabel = item.kind === "video" ? "参考视频" : item.kind === "text" ? "参考文案" : "产品文档";
      return [
        `- 类型：${kindLabel}；名称：${item.name || "未命名"}`,
        item.summary ? `摘要：${clip(item.summary)}` : "",
        item.analysis ? `分析：${clip(item.analysis)}` : "",
        item.transcript ? `逐字稿：${clip(item.transcript)}` : "",
        item.extractedText ? `原文：${clip(item.extractedText)}` : "",
        item.facts?.length ? `产品事实：${item.facts.join("；")}` : "",
        item.inferences?.length ? `AI 推测：${item.inferences.join("；")}` : ""
      ].filter(Boolean).join("\n");
    })
  ].join("\n");
}

async function handleRecommend(body: WorkbenchBody) {
  if (!body.brief?.trim() && !body.productText?.trim()) {
    return NextResponse.json({ success: false, message: "请先填写“这次想怎么拍？”或选择产品资料。" }, { status: 400 });
  }

  const previous = Array.isArray(body.previous) ? body.previous : [];
  const recentTitles = (Array.isArray(body.recentTitles) ? body.recentTitles : []).filter(Boolean).slice(0, 30);
  const experienceBlock = typeof body.experienceBlock === "string" ? body.experienceBlock : "";
  const profileBlock = typeof body.profileBlock === "string" ? body.profileBlock : "";
  const systemPrompt = `
你是「中小企业 AI 内容生产中台」的电商内容编导。你需要基于产品资料、用户的自然语言需求和参考素材，动态推荐 3 个创作方向。
要求：
1. 三个方向必须是三种真正不同的创意角度，不是换个标题。
2. 每个方向都要有明确的核心玩法和推荐理由。
3. 优先利用用户上传的参考视频 / 参考文案的结构和转化逻辑。
4. 不要编造价格、销量、检测报告、明星代言、全网最低价等没有依据的信息。
5. 输出纯 JSON，每个方向都要填齐这些字段：
{"directions":[{
  "name":"方向名","play":"一句话玩法","reason":"为什么值得拍（对应观众问题/卖点/评论反馈）",
  "audience":"目标观众及具体问题","sellingPoint":"对应的商品卖点（必须来自产品资料）",
  "basis":"推荐依据摘要","sources":[{"name":"来源名","quote":"可定位的原句摘录","kind":"product|comment|reference|experience"}],
  "proofMethods":["可用证明方式"],"requirements":["人员/场地/素材要求"],"missing":["还缺什么"],
  "difference":"与近期内容的区别","status":"ready|needs_material|needs_conditions"
}]}
不要 Markdown。
6. status 判定：产品和条件齐备=ready；缺资料=needs_material；拍摄条件不足=needs_conditions。
7. sources 只能引用本次实际提供的来源：产品资料用 name="产品资料"，评论用 name="观众评论"，参考素材用其名称，经验用 name="创作经验"。没有依据支撑的判断不要硬造来源，写进 missing。
8. 评论是观众观点，不是产品事实；参考作品的商品参数不能迁移成本商品的参数。
9. 方向只描述内容玩法、人物关系和观众感受，不要写镜头、分镜、画面、动作、拍摄方式。
10. ${commentUsageRule}
   如果给了评论洞察，三个方向里至少要有两个是直接回应观众最集中的问题或购买阻力，并在推荐理由里点明对应的是哪条反馈。
`.trim();
  const userPrompt = [
    "请根据以下信息推荐 3 个创作方向。",
    profileBlock || "",
    "【产品资料】",
    clip(body.productText),
    "【这次想怎么拍】",
    clip(body.brief) || "未填写",
    experienceBlock || "",
    buildCommentBlock(body.commentContext),
    buildReferenceBlock(body.references),
    previous.length ? `【已经推荐过、这次要避开的方向】${previous.join("、")}` : "",
    recentTitles.length ? `【同账号近期已做过（不要重复）】${recentTitles.join("；")}` : ""
  ].filter(Boolean).join("\n\n");

  // 可引用来源名单：用于校验模型返回的 sources 是否真实存在
  const knownSources = new Set<string>(["产品资料", "观众评论", "创作经验"]);
  for (const item of body.references || []) {
    if (item?.name) knownSources.add(String(item.name));
  }

  try {
    const copy = await callAi(systemPrompt, userPrompt, 0.9, "script_direction_recommendation");
    const raw = copy.text;
    const parsed = safeJsonParse<{ directions?: Array<Record<string, unknown>> }>(raw) || safeJsonParse<{ directions?: Array<Record<string, unknown>> }>(extractJson(raw));
    const directions = Array.isArray(parsed?.directions) ? parsed.directions.slice(0, 3).map((item, index) => {
      const sources = Array.isArray(item.sources)
        ? (item.sources as Array<Record<string, unknown>>).map((source) => {
          const name = String(source.name || "");
          const valid = knownSources.has(name);
          return {
            name: name || "未知来源",
            quote: String(source.quote || ""),
            kind: String(source.kind || ""),
            valid
          };
        })
        : [];
      const hasValidSource = sources.some((source) => source.valid);
      const status = ["ready", "needs_material", "needs_conditions"].includes(String(item.status))
        ? String(item.status) : "needs_material";
      return {
        id: `direction_${Date.now()}_${index}`,
        name: String(item.name || `创作方向 ${index + 1}`),
        play: String(item.play || ""),
        reason: String(item.reason || ""),
        audience: String(item.audience || ""),
        sellingPoint: String(item.sellingPoint || ""),
        basis: String(item.basis || ""),
        sources,
        proofMethods: Array.isArray(item.proofMethods) ? item.proofMethods.map(String) : [],
        requirements: Array.isArray(item.requirements) ? item.requirements.map(String) : [],
        missing: Array.isArray(item.missing) ? item.missing.map(String) : [],
        difference: String(item.difference || ""),
        status,
        /** 没有任何有效来源 = 待验证设想，不得显示成已验证 */
        verified: hasValidSource
      };
    }) : [];
    if (directions.length >= 3) {
      return NextResponse.json({ success: true, source: copy.source, directions });
    }
    throw new Error("AI 返回的方向数量不足。");
  } catch (error) {
    const fallback = fallbackDirections(body.productText || "", body.brief || "").map((item) => ({
      ...item,
      sources: [],
      proofMethods: [],
      requirements: [],
      missing: [],
      status: "needs_material",
      verified: false
    }));
    return NextResponse.json({
      success: true,
      source: "fallback",
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，已基于输入生成本地方向。`,
      directions: fallback
    });
  }
}

function fallbackDirections(productText: string, brief: string): DirectionOption[] {
  const productName = productText.split("\n").find((line) => line.startsWith("产品名称："))?.replace("产品名称：", "").trim() || "产品";
  const briefHint = brief.trim() || "围绕产品卖点和目标人群";
  const shortBrief = briefHint.length > 18 ? `${briefHint.slice(0, 18)}…` : briefHint;
  return [
    {
      id: "fallback_1",
      name: "自然对话型",
      play: `围绕“${shortBrief}”设计一段像朋友聊天的真实口播，弱化广告感。`,
      reason: "更接近真人聊天，用户信任感更强。"
    },
    {
      id: "fallback_2",
      name: "反差冲突型",
      play: `用“${productName}”的价格或效果反差制造开头冲突，再引出真实卖点。`,
      reason: "开头冲突强，更容易留住前 3 秒。"
    },
    {
      id: "fallback_3",
      name: "卖点直给型",
      play: `把“${shortBrief}”里的核心卖点用大白话直接讲清楚，不绕弯子。`,
      reason: "信息密度高，适合直接促进成交。"
    }
  ];
}

/** 底稿仿写时，把「同一条逐字稿」从参考资料里剔除，避免底稿和参考重复注入让模型混淆。 */
function referencesWithoutBaseTranscript(references: ReferencePayload[] = [], baseText: string) {
  const base = baseText.replace(/\s/g, "");
  return references.filter((item) => {
    const transcript = String(item.transcript || "").replace(/\s/g, "");
    if (base && transcript && transcript === base) return false;
    if (/^抖音视频逐字稿/.test(String(item.name || ""))) return false;
    return true;
  });
}

async function handleGenerate(body: WorkbenchBody) {
  const brief = String(body.brief || "");
  const baseText = String(body.baseText || "").trim();
  const intent = detectScriptIntent(brief);
  // 有底稿且用户没说「重新创作」→ 走仿写；显式传 generateMode 时以显式为准。
  const adaptMode = Boolean(baseText)
    && (body.generateMode === "adapt" || (body.generateMode !== "fresh" && intent !== "rewrite"));

  // 只要有产品资料、创作想法、底稿或任何一份参考资料（例如抖音逐字稿）就能生成。
  if (!body.productText?.trim() && !brief.trim() && !baseText && !(body.references || []).length) {
    return NextResponse.json({ success: false, message: "请先选择产品资料、填写创作想法，或先解析一份参考资料。" }, { status: 400 });
  }

  const direction = body.direction;
  const directionBlock = direction
    ? `${direction.name}：${direction.play}\n推荐理由：${direction.reason}`
    : adaptMode ? "未选择（按底稿本来的结构走）" : "未选择，请自行判断";

  const systemPrompt = adaptMode
    ? `
你是电商短视频的脚本编辑器（编导助手）。用户给的是一份现成底稿（例如抖音逐字稿），你要在这份底稿上改，而不是重新创作一条不相干的新脚本。
要求：
1. ${copyOnlyOutputRule}
2. ${intentDirective[intent]}
3. 底稿的结构、句数、顺序、人物关系和节奏必须保留；只按【这次想怎么拍】里的要求改动，不要顺手大改。
4. 产品、卖点、场景、人群一律替换成【产品资料】里的真实信息；资料里没有的（价格、销量、检测报告、明星代言等）一律不写，也不要把底稿里的旧产品信息照搬过来。
5. 参考资料只用来参考表达方式，不得照抄原句。
6. 严禁出现 ${legacyPictureTerm} 等词。
7. ${commentUsageRule}
`.trim()
    : `
你是「中小企业 AI 内容生产中台」的短视频文案编导。你只产出能照着念的口播文案，不产出任何拍摄或画面说明。
硬性要求：
1. 输出纯 JSON：{"title":"","sections":[{"key":"script","label":"文案","content":""}]}。
2. sections 只允许这一项（key="script"、label="文案"）。严禁输出镜头、画面、分镜、动作、拍摄、机位、运镜、画中画、字幕、音效等任何段落。
3. content 里只写“人物张口说出来的话”，一行一句，像真人正常聊天，不要广告腔，不重复卖点，一句话能说清就不写三句。
4. 如果是两个人在对话，每行用“女生：”“男生：”开头；只有一个人说话就完全不写前缀。
5. 严禁任何括号里的动作、表情、语气提示（例如“（摸了摸衣服）”“（看向镜头）”），也不要写任何描述性文字。
6. 不要写创作原理、策略分析、营销理论、小标题或解释。
7. 不要编造价格、销量、检测报告、明星代言、全网最低价、历史原价等没有依据的信息；资料里没有的写“资料中未提供”。
8. 产品资料属于长期知识；参考资料里出现的具体价格、承诺、案例不能照搬，必须先按产品资料核实。
9. ${commentUsageRule}
`.trim();

  const userPrompt = [
    adaptMode ? "请按下面的要求，在这份底稿上改出一版（结构保留，不要重新创作）。" : "请生成一份可以直接照着念的口播文案。",
    typeof body.profileBlock === "string" && body.profileBlock.trim() ? body.profileBlock.trim() : "",
    "【产品资料】",
    clip(body.productText),
    "【这次想怎么拍】（本次明确要求，优先级高于创作档案默认要求）",
    clip(brief) || (adaptMode ? "未填写：按底稿仿写一版，产品信息替换成当前产品资料。" : "未填写"),
    typeof body.experienceBlock === "string" && body.experienceBlock.trim() ? body.experienceBlock.trim() : "",
    typeof body.lockBlock === "string" && body.lockBlock.trim()
      ? `${body.lockBlock.trim()}\n除锁定内容外，其余部分按本次要求改写；锁定段落必须逐字保留，不得改写、删除或挪动位置。`
      : "",
    "【选定的创作方向】",
    directionBlock,
    buildCommentBlock(body.commentContext),
    adaptMode ? "【底稿】\n" + baseText : "",
    buildReferenceBlock(adaptMode ? referencesWithoutBaseTranscript(body.references, baseText) : body.references)
  ].filter(Boolean).join("\n\n");

  try {
    const copy = await callAi(systemPrompt, userPrompt, adaptMode ? 0.75 : 0.8, "script_generation");
    const raw = copy.text;
    const parsed = safeJsonParse<ScriptDocument>(raw) || safeJsonParse<ScriptDocument>(extractJson(raw));
    const sections = normalizeSections(parsed?.sections);
    if (sections.length === 0) throw new Error("AI 没有返回有效脚本段落。");
    return NextResponse.json({
      success: true,
      source: copy.source,
      mode: adaptMode ? "adapt" : "fresh",
      intent,
      document: {
        title: String(parsed?.title || fallbackDocumentTitle(body)).trim(),
        sections
      }
    });
  } catch (error) {
    // 仿写失败时绝不丢底稿：原样返回底稿，用户还能继续手工改。
    return NextResponse.json({
      success: true,
      source: "fallback",
      mode: adaptMode ? "adapt" : "fresh",
      intent,
      message: `${error instanceof Error ? error.message : "AI 请求失败"}${adaptMode ? "，已保留原底稿。" : "，已使用本地规则生成基础脚本。"}`,
      document: adaptMode
        ? { title: (body.baseTitle || "").trim() || "未命名脚本", sections: [{ key: copySection.key, label: copySection.label, content: baseText }] }
        : fallbackDocument(body)
    });
  }
}

/**
 * 可控改稿（文档 §三.C2）：只对选区生成替换内容，返回"修改建议"而不是直接覆盖。
 * 选区外文本由客户端程序拼装保留；锁定范围随请求下发，模型不得改写。
 */
async function handleRevise(body: WorkbenchBody) {
  const baseText = String(body.baseText ?? "");
  const start = Number(body.selectionStart);
  const end = Number(body.selectionEnd);
  if (!baseText.trim()) {
    return NextResponse.json({ success: false, message: "当前没有可修改的正文。" }, { status: 400 });
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > baseText.length) {
    return NextResponse.json({ success: false, message: "选区无效，请重新选中要修改的文字。" }, { status: 400 });
  }
  const instruction = String(body.instruction || "").trim();
  if (!instruction) {
    return NextResponse.json({ success: false, message: "请填写你想怎么改这一段。" }, { status: 400 });
  }
  const selection = baseText.slice(start, end);

  const systemPrompt = `
你是电商短视频文案编辑。用户选中了正文中的一小段，你**只重写这一段**，其余内容一律不要输出。
要求：
1. 输出纯 JSON：{"content":"替换后的这段文案"}。
2. 只输出能照着念的台词；不加括号动作提示，不写镜头、画面、分镜、拍摄等说明。
3. 保持与上下文衔接：开头不要凭空打招呼，结尾不要凭空收束，因为这段前后还有别的句子。
4. 不编造价格、销量、检测报告等没有依据的信息；产品参数以【产品资料】为准，资料里没有的不写。
5. 严禁出现 ${legacyPictureTerm} 等词。
6. 不写解释或 Markdown。
`.trim();
  const userPrompt = [
    "请只重写【选中的原文】这一段。",
    typeof body.profileBlock === "string" && body.profileBlock.trim() ? body.profileBlock.trim() : "",
    "【产品资料】",
    clip(body.productText) || "未提供",
    `【修改要求】${instruction}`,
    typeof body.experienceBlock === "string" && body.experienceBlock.trim() ? body.experienceBlock.trim() : "",
    body.context ? `【前后文】\n${clip(body.context)}` : "",
    `【选中的原文】\n${selection}`
  ].filter(Boolean).join("\n\n");

  try {
    const copy = await callAi(systemPrompt, userPrompt, 0.7, "script_rewrite");
    const raw = copy.text;
    const parsed = safeJsonParse<{ content?: string }>(raw) || safeJsonParse<{ content?: string }>(extractJson(raw));
    const replacement = sanitizeScriptCopy(typeof parsed?.content === "string" ? parsed.content.trim() : raw.trim());
    if (!replacement) throw new Error("AI 没有返回有效文案。");
    return NextResponse.json({ success: true, source: copy.source, replacement, selectionLength: selection.length });
  } catch (error) {
    return NextResponse.json({
      success: false,
      source: "fallback",
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，未生成修改建议，正文未改动。`
    });
  }
}

/**
 * 经验提炼（文档 §三.A3）：对比基础稿与采用稿，返回待确认的经验候选。
 * 候选默认 pending，不自动成为长期规则；商品事实不得进入经验。
 */
async function handleExtractExperience(body: WorkbenchBody) {
  const baseText = String(body.baseText || "").trim();
  const adoptedText = String(body.text || "").trim();
  if (!baseText || !adoptedText) {
    return NextResponse.json({ success: false, message: "需要基础稿和采用稿两份内容才能提炼经验。" }, { status: 400 });
  }

  const systemPrompt = `
你是短视频创作方法研究员。对比同一份口播稿的「修改前」和「用户最终采用」两个版本，提炼可复用的表达经验。
输出纯 JSON：{"rules":["","",""]}，最多 3 条。
要求：
1. 只提炼「表达与结构层面」的稳定偏好（例如：开头直接点痛点、少用形容词、多用提问、口语短句）。
2. 不要把具体商品参数、价格、卖点事实当成经验；不要复述脚本内容本身。
3. 每条经验一句话、可执行、可迁移到同账号其他视频；模糊的不要输出。
4. 若两版差异不构成可复用经验，返回 {"rules":[]}。
`.trim();
  const userPrompt = [
    body.instruction ? `用户本次的修改要求：${clip(body.instruction)}` : "",
    "【修改前（基础稿）】",
    clip(baseText),
    "【用户最终采用】",
    clip(adoptedText)
  ].filter(Boolean).join("\n\n");

  try {
    const copy = await callAi(systemPrompt, userPrompt, 0.4, "script_analysis");
    const raw = copy.text;
    const parsed = safeJsonParse<{ rules?: string[] }>(raw) || safeJsonParse<{ rules?: string[] }>(extractJson(raw));
    const rules = Array.isArray(parsed?.rules) ? parsed.rules.map((item) => String(item).trim()).filter(Boolean).slice(0, 3) : [];
    return NextResponse.json({ success: true, source: copy.source, rules });
  } catch (error) {
    return NextResponse.json({
      success: false,
      source: "fallback",
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，未能提炼经验候选。`
    });
  }
}

/**
 * 不论模型返回什么段落结构，最终只保留一段「文案」：
 * 合并能念的内容，丢掉镜头/画面/动作等描述段落，并做一次清洗。
 */
function normalizeSections(value: unknown): ScriptDocument["sections"] {
  if (!Array.isArray(value)) return [];
  const sections = value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        key: typeof record.key === "string" ? record.key : "",
        label: typeof record.label === "string" ? record.label : "",
        content: typeof record.content === "string" ? record.content : ""
      };
    });
  return toCopyOnlyDocument({ title: "", sections }).sections;
}

function fallbackDocumentTitle(body: WorkbenchBody) {
  const productName = (body.productText || "").split("\n").find((line) => line.startsWith("产品名称："))?.replace("产品名称：", "").trim();
  const directionName = body.direction?.name || "";
  return [directionName, productName].filter(Boolean).join(" · ") || "短视频脚本";
}

function fallbackDocument(body: WorkbenchBody): ScriptDocument {
  const productName = (body.productText || "").split("\n").find((line) => line.startsWith("产品名称："))?.replace("产品名称：", "").trim() || "产品";
  const selling = (body.productText || "").split("\n").find((line) => line.startsWith("核心卖点："))?.replace("核心卖点：", "").trim() || "核心卖点";
  const brief = (body.brief || "").trim();
  const direction = body.direction;

  const content = [
    `${direction?.name || "先说重点"}：${brief ? `“${brief}”` : productName}，这大概是最多人关心的一点。`,
    brief
      ? `说白了就一句话：${selling}。`
      : `${productName}，${selling}，用得上的人都懂。`,
    "想细看的，点进直播间或者评论区留个话，我一个个回。"
  ].join("\n");

  return toCopyOnlyDocument({
    title: fallbackDocumentTitle(body),
    sections: [{ key: copySection.key, label: copySection.label, content }]
  });
}

async function handleEditSection(body: WorkbenchBody) {
  if (!body.content?.trim()) {
    return NextResponse.json({ success: false, message: "当前段落没有可修改的内容。" }, { status: 400 });
  }

  const mode = body.mode || "natural";
  const instruction = mode === "custom" ? body.instruction : modeInstruction(mode);
  if (!instruction?.trim()) {
    return NextResponse.json({ success: false, message: "请填写你想怎么改这一段。" }, { status: 400 });
  }

  const systemPrompt = `
你是电商短视频文案编辑。只修改用户给出的这一段文案，不要动其他内容。
要求：
1. 输出纯 JSON：{"content":"修改后的文案"}。
2. 保留原文的有效信息，语气自然、口语、可以直接照着念。
3. 只输出台词本身：不要加入括号里的动作、表情、语气提示，也不要写镜头、画面、分镜、动作、拍摄、机位、运镜、画中画等说明。
4. 不写解释、理由或 Markdown；不要编造价格、销量、检测报告等没有依据的信息。
5. 严禁出现 ${legacyPictureTerm} 等词。
`.trim();
  const userPrompt = [
    `段落标签：${body.label || "段落"}`,
    `修改要求：${instruction}`,
    body.context ? `上下文：${clip(body.context)}` : "",
    `当前段落：\n${clip(body.content)}`
  ].filter(Boolean).join("\n\n");

  try {
    const copy = await callAi(systemPrompt, userPrompt, 0.7, "script_rewrite");
    const raw = copy.text;
    const parsed = safeJsonParse<{ content?: string }>(raw) || safeJsonParse<{ content?: string }>(extractJson(raw));
    const content = sanitizeScriptCopy(typeof parsed?.content === "string" ? parsed.content.trim() : raw.trim());
    if (!content) throw new Error("AI 没有返回有效文案。");
    return NextResponse.json({ success: true, source: copy.source, content });
  } catch (error) {
    return NextResponse.json({
      success: true,
      source: "fallback",
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，已保留原段落。`,
      content: body.content
    });
  }
}

function modeInstruction(mode: string) {
  if (mode === "natural") return "把这段改得更自然、更像真人聊天，去掉广告腔。";
  if (mode === "impact") return "把这段改得更有冲击力和记忆点，保留原意，不夸张造假。";
  if (mode === "replace") return "换一种完全不同的写法表达同一段内容。";
  return "";
}

async function handleAssistant(body: WorkbenchBody) {
  if (!body.instruction?.trim()) {
    return NextResponse.json({ success: false, message: "请告诉 AI 你想怎么改这份脚本。" }, { status: 400 });
  }
  if (!body.document) {
    return NextResponse.json({ success: false, message: "当前没有可修改的脚本，请先生成脚本。" }, { status: 400 });
  }

  const intent = detectScriptIntent(body.instruction);
  const systemPrompt = `
你是电商短视频的脚本编辑器（编导助手），不是「重新写一条新脚本」的生成器。
用户在改一份已有的口播文案，你要按他说的改，而不是替他重写。
要求：
1. 结构必须和输入完全一致：{"title":"","sections":[{"key":"script","label":"文案","content":""}]}，只改 title 和这一段 content。
2. ${intentDirective[intent]}
3. 除非用户明确要求重写，否则不要改变段落结构、信息顺序和信息量。
4. 台词接近真人聊天，不要广告腔，不编造价格、销量、检测报告等无依据信息。
5. 严禁出现 ${legacyPictureTerm} 等词。
6. ${commentUsageRule}
7. 用户如果直接问评论区的情况（例如"评论区大家最关心什么"），就直接根据【观众评论洞察】回答，不要假装没有这份数据。
`.trim();
  const userPrompt = [
    `修改指令：${body.instruction.trim()}`,
    `执行强度：${intentDirective[intent]}`,
    body.context ? `补充上下文：${clip(body.context)}` : "",
    buildCommentBlock(body.commentContext),
    `当前脚本 JSON：\n${JSON.stringify(body.document)}`
  ].filter(Boolean).join("\n\n");

  try {
    const copy = await callAi(systemPrompt, userPrompt, 0.7, "script_rewrite");
    const raw = copy.text;
    const parsed = safeJsonParse<ScriptDocument>(raw) || safeJsonParse<ScriptDocument>(extractJson(raw));
    const sections = normalizeSections(parsed?.sections);
    if (sections.length === 0) throw new Error("AI 没有返回有效脚本。");
    return NextResponse.json({
      success: true,
      source: copy.source,
      document: {
        title: String(parsed?.title || body.document.title).trim(),
        sections
      }
    });
  } catch (error) {
    return NextResponse.json({
      success: true,
      source: "fallback",
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，脚本保持原样。`,
      document: body.document
    });
  }
}

/**
 * 「只问不改」：用户在 AI 助手里问问题（评论区、逐字稿、脚本诊断），
 * 只返回一段回答，**不产出脚本、不改动现有稿件**。
 */
async function handleAsk(body: WorkbenchBody) {
  const question = String(body.instruction || "").trim();
  if (!question) {
    return NextResponse.json({ success: false, message: "请先写下你的问题。" }, { status: 400 });
  }

  const scriptText = (body.document?.sections || []).map((item) => item.content).filter(Boolean).join("\n");
  const transcript = clip(body.transcript);
  if (!scriptText && !transcript && !body.commentContext && !body.productText) {
    return NextResponse.json({ success: false, message: "还没有可参考的资料：先解析抖音链接或生成脚本，再来提问。" }, { status: 400 });
  }

  const systemPrompt = `
你是电商短视频编导助手。用户在问你问题，你**只回答**，不要改稿、不要输出脚本 JSON、不要输出 Markdown 标题。
要求：
1. 只依据下面给的资料回答；资料里没有的不要编造，明确说"资料里没有"。
2. 区分「观众看法」与「产品事实」：评论里的说法只能当作观众观点，不能当成产品参数、价格或功效的证据。
3. 回答要短：先给结论，再给 2-4 条依据或建议，总长度控制在 150 字以内。
4. 如果用户问的是评论区，就直接根据【观众评论洞察】回答最集中的关注点、购买阻力和可以拍的内容机会。
5. 如果用户问的是当前脚本的问题，指出具体位置并给一个可执行的改法。
6. 不要出现 ${legacyPictureTerm} 这类词。
`.trim();

  const userPrompt = [
    `问题：${question}`,
    body.context ? `【上下文】${clip(body.context)}` : "",
    "【产品资料（事实来源）】",
    clip(body.productText) || "未提供",
    buildCommentBlock(body.commentContext),
    transcript ? `【原视频逐字稿】\n${transcript}` : "",
    scriptText ? `【当前脚本】\n${clip(scriptText)}` : ""
  ].filter(Boolean).join("\n\n");

  try {
    const copy = await callAi(systemPrompt, userPrompt, 0.5, "script_qa");
    const answer = copy.text.trim();
    if (!answer) throw new Error("AI 没有返回内容。");
    return NextResponse.json({ success: true, source: copy.source, answer });
  } catch (error) {
    console.error("[SCRIPT_ASK] FAILED detail=" + (error instanceof Error ? error.message : "unknown"));
    const fallback = body.commentContext
      ? `AI 暂时不可用。已采集到的观众反馈摘要：\n${clip(body.commentContext).slice(0, 400)}`
      : `AI 暂时不可用：${error instanceof Error ? error.message : "请求失败"}。请稍后重试。`;
    return NextResponse.json({
      success: true,
      source: "fallback",
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，已返回本地摘要。`,
      answer: fallback
    });
  }
}

/**
 * 底稿类修改：没有「已生成的脚本」时，直接拿抖音逐字稿当底稿改。
 * 这是「解析完逐字稿就能直接仿写/优化/换产品」的关键入口——不依赖「分析并推荐方向」。
 */
async function handleCompose(body: WorkbenchBody) {
  const base = clip(body.baseText);
  if (!base.trim()) {
    return NextResponse.json({ success: false, message: "没有可用的底稿，请先解析抖音逐字稿，或先生成脚本。" }, { status: 400 });
  }
  const instruction = String(body.instruction || "").trim();
  if (!instruction) {
    return NextResponse.json({ success: false, message: "请告诉我要怎么改这份底稿。" }, { status: 400 });
  }

  // 简报（本次想怎么拍）和即时指令一起决定改动强度；简报里说"重新创作"也按重写处理。
  const briefIntent = detectScriptIntent(String(body.brief || ""));
  const intent = briefIntent === "rewrite" ? "rewrite" : detectScriptIntent(instruction);
  const fallbackTitle = (body.baseTitle || "").trim() || "未命名脚本";
  const systemPrompt = `
你是电商短视频的脚本编辑器（编导助手）。用户给的是一份现成底稿（例如抖音逐字稿），你要按他的指令在底稿上改，而不是重新创作一条不相干的新脚本。
要求：
1. ${copyOnlyOutputRule}
2. ${intentDirective[intent]}
3. 除非用户明确要求重写，否则不要改变结构、信息顺序和信息量；不要删掉底稿里的真实信息。
4. 台词接近真人聊天，不要广告腔；不要编造价格、销量、检测报告、明星代言等没有依据的信息，资料里没有的参数一律不写。
5. 严禁出现 ${legacyPictureTerm} 等词。
6. ${commentUsageRule}
`.trim();
  const userPrompt = [
    "请按下面的指令修改这份底稿。",
    "【当前产品资料】",
    clip(body.productText) || "未选择产品（只基于底稿处理，不要引入新产品信息）",
    "【这次想怎么拍】（本次任务的顶层要求，优先级高于参考资料）",
    clip(body.brief) || "未填写",
    buildCommentBlock(body.commentContext),
    buildReferenceBlock(referencesWithoutBaseTranscript(body.references, base)),
    `【用户指令】${instruction}`,
    `【执行强度】${intentDirective[intent]}`,
    "【底稿】",
    base
  ].join("\n\n");

  try {
    const copy = await callAi(systemPrompt, userPrompt, 0.75, "script_rewrite");
    const raw = copy.text;
    const parsed = safeJsonParse<ScriptDocument>(raw) || safeJsonParse<ScriptDocument>(extractJson(raw));
    const sections = normalizeSections(parsed?.sections);
    if (sections.length === 0) throw new Error("AI 没有返回有效文案。");
    return NextResponse.json({
      success: true,
      source: copy.source,
      intent,
      document: {
        title: String(parsed?.title || fallbackTitle).trim(),
        sections
      }
    });
  } catch (error) {
    // 失败时绝不能丢底稿：原样回到底稿，让用户可以继续手工改。
    return NextResponse.json({
      success: true,
      source: "fallback",
      intent,
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，已保留原底稿。`,
      document: {
        title: fallbackTitle,
        sections: [{ key: copySection.key, label: copySection.label, content: base }]
      }
    });
  }
}

async function handleAnalyzeVideo(body: WorkbenchBody) {
  const transcript = clip(body.transcript);
  if (!transcript) {
    return NextResponse.json({ success: false, message: "视频没有解析出文案。" }, { status: 400 });
  }

  const systemPrompt = `
你是短视频拆片分析助手。根据视频逐字稿提取可复用的创作特征。
输出纯 JSON：{"summary":"","analysis":""}。
analysis 用短行列出：开头钩子、人物关系、对话方式、场景、镜头、人物动作、节奏、内容结构、转化逻辑，每项一句话。
不要照抄文案，不要编造信息。
`.trim();

  try {
    const copy = await callAi(systemPrompt, `视频名称：${body.name || "未命名"}\n逐字稿：\n${transcript}`, 0.5, "script_analysis");
    const raw = copy.text;
    const parsed = safeJsonParse<{ summary?: string; analysis?: string }>(raw) || safeJsonParse<{ summary?: string; analysis?: string }>(extractJson(raw));
    return NextResponse.json({
      success: true,
      source: copy.source,
      summary: String(parsed?.summary || "").trim(),
      analysis: String(parsed?.analysis || raw).trim()
    });
  } catch (error) {
    return NextResponse.json({
      success: true,
      source: "fallback",
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，已保留视频逐字稿。`,
      summary: `已读取视频逐字稿（${transcript.length} 字）`,
      analysis: "逐字稿已保存，生成脚本时会作为参考。"
    });
  }
}

async function handleAnalyzeText(body: WorkbenchBody) {
  const text = clip(body.text);
  if (!text) {
    return NextResponse.json({ success: false, message: "参考文案没有读取到内容。" }, { status: 400 });
  }

  const systemPrompt = `
你是短视频文案分析助手。从参考文案中提取可复用的写法。
输出纯 JSON：{"summary":"","analysis":""}。
analysis 用短行列出：开头方式、结构、语言风格、人物关系、节奏、卖点表达、转化逻辑、可复用特点，每项一句话。
`.trim();

  try {
    const copy = await callAi(systemPrompt, `文案名称：${body.name || "未命名"}\n文案内容：\n${text}`, 0.5, "script_analysis");
    const raw = copy.text;
    const parsed = safeJsonParse<{ summary?: string; analysis?: string }>(raw) || safeJsonParse<{ summary?: string; analysis?: string }>(extractJson(raw));
    return NextResponse.json({
      success: true,
      source: copy.source,
      summary: String(parsed?.summary || "").trim(),
      analysis: String(parsed?.analysis || raw).trim()
    });
  } catch (error) {
    return NextResponse.json({
      success: true,
      source: "fallback",
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，已保留文案原文。`,
      summary: `已读取参考文案（${text.length} 字）`,
      analysis: "文案已保存，生成脚本时会作为参考。"
    });
  }
}

async function handleAnalyzeDocument(body: WorkbenchBody) {
  const text = clip(body.text);
  if (!text) {
    return NextResponse.json({ success: false, message: "产品文档没有读取到内容。" }, { status: 400 });
  }

  const systemPrompt = `
你是产品资料整理助手。从产品文档中提取脚本可用的信息。
输出纯 JSON：{"summary":"","facts":[],"inferences":[]}。
必须严格区分：
- facts：文档里明确写出的产品事实（名称、参数、事实、人群、卖点、购买理由、品牌要求、禁止事项）。
- inferences：AI 自己的推测或创作建议，每一项都必须以“推测：”开头。
禁止把推测写进 facts，禁止编造文档里没有的内容。
`.trim();

  try {
    const copy = await callAi(systemPrompt, `文档名称：${body.name || "未命名"}\n文档内容：\n${text}`, 0.4, "script_analysis");
    const raw = copy.text;
    const parsed = safeJsonParse<{ summary?: string; facts?: string[]; inferences?: string[] }>(raw)
      || safeJsonParse<{ summary?: string; facts?: string[]; inferences?: string[] }>(extractJson(raw));
    return NextResponse.json({
      success: true,
      source: copy.source,
      summary: String(parsed?.summary || "").trim(),
      facts: Array.isArray(parsed?.facts) ? parsed.facts.map((item) => String(item).trim()).filter(Boolean) : [],
      inferences: Array.isArray(parsed?.inferences) ? parsed.inferences.map((item) => String(item).trim()).filter(Boolean) : []
    });
  } catch (error) {
    return NextResponse.json({
      success: true,
      source: "fallback",
      message: `${error instanceof Error ? error.message : "AI 请求失败"}，已保留文档原文。`,
      summary: `已读取产品文档（${text.length} 字）`,
      facts: ["已读取产品文档，未做 AI 结构化提取。"],
      inferences: []
    });
  }
}
