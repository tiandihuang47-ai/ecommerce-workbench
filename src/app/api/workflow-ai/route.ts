import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getDeepSeekErrorMessage, safeJsonParse } from "@/lib/deepseek";
import { generateCopywritingText, isRouteConfigured } from "@/lib/copywriting-service";

const allowedActions = new Set([
  "productInsights",
  "taskTopic",
  "taskScript",
  "shotList",
  "editBrief",
  "reviewConclusion",
  "assetFromReview",
  "nextTopicFromReview",
  "reviewAttribution"
]);

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "请求参数不能为空" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const action = record.action;
  const input = record.input;

  if (typeof action !== "string" || !allowedActions.has(action)) {
    return NextResponse.json({ error: "AI 动作不合法" }, { status: 400 });
  }

  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "input 必须是对象" }, { status: 400 });
  }

  if (!isRouteConfigured("workflow_ai")) {
    return NextResponse.json({ error: "当前未配置文本模型接口密钥" }, { status: 500 });
  }

  try {
    const copy = await generateCopywritingText({
      purpose: "workflow_ai",
      temperature: 0.4,
      system: [
            "你是公司内部短视频内容生产中台的 AI 工作流助手。",
            "你必须输出严格 JSON，不要使用 Markdown，不要加解释。",
            "所有内容必须结构化，能直接写入业务模块。",
            "不要编造价格、销量、检测报告、明星背书等事实。",
            `辅助画面统一叫“画中画”，不要出现 b${"roll"}。`
      ].join("\n"),
      user: JSON.stringify({ action, input, schemaHint: schemaHint(action) }, null, 2)
    });

    const content = copy.text;
    const parsed = safeJsonParse<Record<string, unknown>>(content.replace(/^```json\s*/i, "").replace(/```$/i, ""));

    if (!parsed) {
      return NextResponse.json({ error: "文本模型没有返回可写入的结构化结果" }, { status: 502 });
    }

    return NextResponse.json({ result: parsed, source: copy.source });
  } catch (error) {
    return NextResponse.json({ error: getDeepSeekErrorMessage(error) }, { status: 502 });
  }
}

function schemaHint(action: string) {
  switch (action) {
    case "productInsights":
      return { sellingPoints: "核心卖点", painPoints: "用户痛点", forbiddenRisk: "禁忌词与表达风险" };
    case "taskTopic":
      return { title: "选题标题", hook: "开头钩子", angle: "选题角度", reason: "为什么值得做" };
    case "taskScript":
      return { title: "标题", hook: "开头3秒钩子", copy: "完整口播", rhythm: "节奏", pictureInPicture: "画中画建议", ending: "结尾转化" };
    case "shotList":
      return { rows: [{ spokenLine: "对应口播", visualContent: "画面内容", shotSize: "景别", movement: "镜头运动", pictureInPicture: "画中画素材" }] };
    case "editBrief":
      return { openingTreatment: "开头处理方式", subtitleHighlights: "字幕重点", pictureInPicturePositions: "画中画插入位置", conversionGuidePosition: "成交引导位置" };
    case "reviewConclusion":
    case "reviewAttribution":
      return { primaryCause: "主因", secondaryCause: "次因", evidence: "证据", nextAction: "下次动作", autoConclusion: "复盘结论" };
    case "assetFromReview":
      return { title: "资产标题", effectivenessReason: "为什么有效或无效", reusableMethod: "可复用方法", tags: "标签" };
    case "nextTopicFromReview":
      return { title: "下一条优化选题", reason: "基于失败复盘的优化理由", hook: "开头钩子" };
    default:
      return {};
  }
}
