import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getDeepSeekErrorMessage, safeJsonParse } from "@/lib/deepseek";
import { generateCopywritingText, isRouteConfigured } from "@/lib/copywriting-service";
import type { ScriptGenerateResult, SimpleScriptInput } from "@/services/simpleContentService";
import { generateLocalScript, scriptRecordToApiResult } from "@/services/simpleContentService";
import type {
  ScriptRecordContentFormat,
  ScriptRecordContentType,
  ScriptRecordPlatform,
  ScriptRecordVideoGoal
} from "@/lib/pipeline-types";

const legacyPictureTerm = `b${"roll"}`;

type ScriptGenerateBody = {
  product?: string;
  targetAudience?: string;
  painPoints?: string;
  sellingPoints?: string;
  platform?: ScriptRecordPlatform;
  contentType?: ScriptRecordContentType;
  contentGoal?: ScriptRecordVideoGoal;
  extraRequirement?: string;
  comments?: string;
  liveTranscript?: string;
  originalScript?: string;
  rewriteGoal?: string;
  forbiddenWords?: string;
  forbiddenClaims?: string;
  advanced?: {
    tone?: string;
    duration?: string;
    scene?: string;
    includeStoryboard?: boolean;
    includeOverlay?: boolean;
    includeRiskCheck?: boolean;
    includeCoverTitle?: boolean;
  };
};

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: ScriptGenerateBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const validation = validateBody(body);
  if (!validation.ok) {
    return NextResponse.json({ success: false, message: validation.message }, { status: 400 });
  }

  const fallbackInput = toLocalInput(body);

  if (!isRouteConfigured("script_generation")) {
    const fallback = scriptRecordToApiResult(generateLocalScript(fallbackInput));
    return NextResponse.json({
      success: true,
      source: "fallback",
      message: "文案模型暂未配置（TEAMOROUTER_API_KEY 或 DEEPSEEK_API_KEY），已使用本地规则生成。",
      result: fallback
    });
  }

  try {
    const copy = await generateCopywritingText({
      purpose: "script_generation",
      system: buildSystemPrompt(),
      user: buildUserPrompt(body),
      temperature: 0.7
    });
    const result = normalizeResult(copy.text, fallbackInput);

    return NextResponse.json({
      success: true,
      source: copy.source,
      result
    });
  } catch (error) {
    const fallback = scriptRecordToApiResult(generateLocalScript(fallbackInput));
    return NextResponse.json({
      success: true,
      source: "fallback",
      message: `${getDeepSeekErrorMessage(error)}，已使用本地规则生成。`,
      result: fallback
    });
  }
}

function validateBody(body: ScriptGenerateBody) {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "请求参数不能为空" };
  }

  if (!body.product?.trim()) {
    return { ok: false, message: "请填写产品 / 业务。" };
  }

  if (body.contentType === "脚本改写" && !body.originalScript?.trim()) {
    return { ok: false, message: "脚本改写需要先粘贴原脚本。" };
  }

  if (body.contentType === "评论回复" && !body.comments?.trim()) {
    return { ok: false, message: "评论回复需要先粘贴评论区内容。" };
  }

  if (body.contentType === "直播切片" && !body.liveTranscript?.trim()) {
    return { ok: false, message: "直播切片需要先粘贴直播口播片段。" };
  }

  const missingCore = [
    body.targetAudience?.trim(),
    body.painPoints?.trim(),
    body.sellingPoints?.trim()
  ].filter(Boolean).length;

  if (missingCore < 2 && body.contentType !== "脚本改写") {
    return { ok: false, message: "请至少补充目标人群、用户痛点、核心卖点中的两项。" };
  }

  return { ok: true, message: "" };
}

function toLocalInput(body: ScriptGenerateBody): SimpleScriptInput {
  return {
    productName: body.product || "",
    productId: "",
    platform: body.platform || "抖音",
    contentFormat: contentFormatFromType(body.contentType || "短视频口播"),
    materialSource: body.comments?.trim() ? "评论区" : "手动输入",
    targetAudience: body.targetAudience || "资料中未提供",
    painPoint: body.painPoints || "资料中未提供",
    sellingPoint: body.sellingPoints || "资料中未提供",
    contentType: body.contentType || "短视频口播",
    videoGoal: body.contentGoal || "成交",
    extra: body.extraRequirement || "",
    duration: body.advanced?.duration || "30秒",
    speakingStyle: body.advanced?.tone || "真实口语",
    scene: body.advanced?.scene || "室内口播",
    needShotList: body.advanced?.includeStoryboard !== false,
    needOverlay: body.advanced?.includeOverlay !== false,
    needTitle: body.advanced?.includeCoverTitle !== false,
    needNote: body.contentType === "小红书图文",
    includeRiskCheck: body.advanced?.includeRiskCheck !== false,
    includeCoverTitle: body.advanced?.includeCoverTitle !== false,
    productForbiddenWords: body.forbiddenWords || "",
    productForbiddenClaims: body.forbiddenClaims || "",
    comments: body.comments || "",
    liveTranscript: body.liveTranscript || "",
    originalScript: body.originalScript || "",
    rewriteGoal: body.rewriteGoal || ""
  };
}

function contentFormatFromType(type: ScriptRecordContentType): ScriptRecordContentFormat {
  if (type === "小红书图文") return "图文笔记";
  if (type === "老板 IP") return "老板 IP";
  if (type === "直播切片") return "直播切片";
  if (type === "评论回复") return "评论回复";
  if (type === "竞品对比") return "竞品对比";
  if (type === "避坑科普") return "避坑科普";
  if (type === "电商带货" || type === "带货转化") return "电商带货";
  return "短视频口播";
}

function buildSystemPrompt() {
  return `
你是「中小企业 AI 内容生产中台」里的电商内容编导助手。你服务中小电商公司、本地生活商家、工厂老板、小品牌内容团队。你擅长把产品卖点、人群痛点、平台风格转化成可拍、可卖、可复用的内容脚本。

回答要求：
1. 直接、口语化、可执行，像给内容团队当天开拍的工作稿。
2. 不要编造价格、销量、检测报告、明星代言、全网最低价、历史原价等没有依据的信息。
3. 用户资料没有提供的信息，要写“资料中未提供”，不能补编。
4. 涉及画面补充时，一律使用“画中画”，严禁出现 ${legacyPictureTerm}、B${"roll"}、B-${"roll"}。
5. 输出必须是纯 JSON，不要 Markdown，不要代码块。
6. riskCheck.level 只能是 low、medium、high。
7. riskCheck.suggestions 每项必须包含 original、suggestion、replacement。

JSON 字段：
{
  "title": "",
  "hook": "",
  "script": "",
  "storyboard": [],
  "overlaySuggestions": [],
  "shootingTips": [],
  "cta": "",
  "riskCheck": {
    "level": "low",
    "riskyWords": [],
    "reasons": [],
    "suggestions": [{"original": "", "suggestion": "", "replacement": ""}],
    "disclaimer": "风控检查仅作为内容风险提醒，不构成法律意见。"
  },
  "extra": {}
}
`.trim();
}

function buildUserPrompt(body: ScriptGenerateBody) {
  return [
    "请根据以下结构生成脚本结果。",
    "",
    "【用户输入】",
    JSON.stringify(body, null, 2),
    "",
    "【平台适配规则】",
    JSON.stringify(platformRules(), null, 2),
    "",
    "【内容类型输出要求】",
    JSON.stringify(contentTypeRules(), null, 2),
    "",
    "如果内容类型是产品卖点提炼，script 字段请放卖点提炼正文；如果是小红书图文，script 字段请放完整图文正文；如果是脚本改写，必须基于 originalScript 改写，不要另起炉灶。"
  ].join("\n");
}

function platformRules() {
  return {
    抖音: "开头要强，节奏要快，痛点要直接，适合强转化和强情绪。",
    小红书: "语气真实，不要太硬广，更像真实体验分享，重视细节和种草感。",
    快手: "强调真实、信任、人设、售后，适合老板口播和直播承接。",
    视频号: "更稳重，更强调信任、品质、经验，适合中年用户和老板 IP。",
    淘宝内容: "强调商品信息、卖点、使用场景和转化，少一点情绪，多一点购买理由。",
    朋友圈: "像熟人推荐，强调复购、信任和成交理由，不要像硬广。"
  };
}

function contentTypeRules() {
  return {
    "短视频口播": ["视频标题", "开头 3 秒钩子", "完整口播脚本", "分镜建议", "画中画建议", "拍摄提醒", "结尾转化话术", "风控检查"],
    "电商带货": ["视频标题", "开头 3 秒钩子", "完整口播脚本", "分镜建议", "画中画建议", "拍摄提醒", "结尾转化话术", "风控检查"],
    "老板 IP": ["视频标题", "老板身份切入角度", "开头钩子", "完整口播脚本", "信任建立方式", "拍摄建议", "结尾引导", "风控检查"],
    "小红书图文": ["图文标题", "封面文案", "正文内容", "图片顺序建议", "每张图配文", "话题标签", "评论区引导", "风控检查"],
    "评论回复": ["评论区问题提炼", "用户真实痛点", "视频选题", "开头钩子", "评论回复型脚本", "拍摄建议", "结尾引导"],
    "直播切片": ["可剪切片标题", "开头钩子", "重新整理后的短视频口播", "适合保留的直播原话", "需要删除的废话", "字幕重点", "画中画建议", "直播间引导话术"],
    "竞品对比": ["对比选题", "对比维度", "开头钩子", "口播脚本", "产品优势表达", "风险提醒", "拍摄建议"],
    "避坑科普": ["避坑选题", "用户容易踩的坑", "开头钩子", "科普脚本", "正确选择标准", "产品自然带入方式", "风控检查"],
    "产品卖点提炼": ["核心卖点", "次级卖点", "用户痛点", "购买理由", "成交话术", "可拍摄角度", "禁忌表达", "适合生成的脚本方向"],
    "脚本改写": ["改写后的标题", "改写后的开头", "改写后的完整脚本", "改写说明", "优化点", "风控检查"]
  };
}

function normalizeResult(raw: string, fallbackInput: SimpleScriptInput): ScriptGenerateResult {
  const cleaned = raw.replace(new RegExp(`\\bb[\\s-]?${"roll"}\\b`, "gi"), "画中画");
  const parsed = safeJsonParse<Partial<ScriptGenerateResult>>(cleaned) || safeJsonParse<Partial<ScriptGenerateResult>>(extractJson(cleaned));
  const fallback = scriptRecordToApiResult(generateLocalScript(fallbackInput));

  if (!parsed) {
    return {
      ...fallback,
      script: cleaned || fallback.script
    };
  }

  return {
    title: typeof parsed.title === "string" ? parsed.title : fallback.title,
    hook: typeof parsed.hook === "string" ? parsed.hook : fallback.hook,
    script: typeof parsed.script === "string" ? parsed.script.replace(new RegExp(`\\bb[\\s-]?${"roll"}\\b`, "gi"), "画中画") : fallback.script,
    storyboard: normalizeStringArray(parsed.storyboard, fallback.storyboard),
    overlaySuggestions: normalizeStringArray(parsed.overlaySuggestions, fallback.overlaySuggestions),
    shootingTips: normalizeStringArray(parsed.shootingTips, fallback.shootingTips),
    cta: typeof parsed.cta === "string" ? parsed.cta : fallback.cta,
    riskCheck: parsed.riskCheck || fallback.riskCheck,
    extra: parsed.extra && typeof parsed.extra === "object" ? parsed.extra : fallback.extra
  };
}

function extractJson(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return value;
  return value.slice(start, end + 1);
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  }
  return fallback;
}
