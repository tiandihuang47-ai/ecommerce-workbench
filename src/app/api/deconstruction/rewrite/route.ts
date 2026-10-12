import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { generateWithDeepSeek, getDeepSeekErrorMessage } from "@/lib/deepseek";
import { isRouteConfigured } from "@/lib/copywriting-service";
import type { ToolInput } from "@/lib/generators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。", fallback: buildFallback({}) }, { status: 400 });
  }

  const input = normalizeRewriteInput(body);
  const contentSource = [input.transcript, input.manualDescription, input.sourceTitle].join("").trim();
  if (contentSource.length < 8) {
    return NextResponse.json({
      success: false,
      message: "用于拆片的内容太少，请补充逐字稿、视频标题或内容描述。",
      fallback: buildFallback(input)
    }, { status: 400 });
  }

  if (!input.targetProduct.trim() || !input.targetAudience.trim()) {
    return NextResponse.json({
      success: false,
      message: "请填写目标产品 / 业务和目标人群，再开始仿写。",
      fallback: buildFallback(input)
    }, { status: 400 });
  }

  if (!isRouteConfigured("link_deconstruction_rewrite")) {
    return NextResponse.json({
      success: false,
      message: "当前未配置文本模型接口密钥，已返回本地基础拆片模板。",
      analysis: buildFallback(input),
      rewrittenScript: buildFallbackRewrite(input),
      source: "fallback"
    });
  }

  try {
    const content = await generateWithDeepSeek({
      type: "link_deconstruction_rewrite",
      input: buildToolInput(input)
    });

    return NextResponse.json({
      success: true,
      analysis: content,
      rewrittenScript: content,
      source: "route"
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: `${getDeepSeekErrorMessage(error)}。已返回本地基础拆片模板。`,
      analysis: buildFallback(input),
      rewrittenScript: buildFallbackRewrite(input),
      source: "fallback"
    }, { status: 502 });
  }
}

function normalizeRewriteInput(body: unknown) {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    transcript: stringValue(record.transcript),
    sourceTitle: stringValue(record.sourceTitle),
    sourceUrl: stringValue(record.sourceUrl),
    platform: stringValue(record.platform),
    manualDescription: stringValue(record.manualDescription),
    comments: stringValue(record.comments),
    targetIndustry: stringValue(record.targetIndustry),
    targetProduct: stringValue(record.targetProduct),
    targetAudience: stringValue(record.targetAudience),
    rewriteGoal: stringValue(record.rewriteGoal),
    rewriteStyle: stringValue(record.rewriteStyle),
    extraRequirement: stringValue(record.extraRequirement)
  };
}

function buildToolInput(input: ReturnType<typeof normalizeRewriteInput>): ToolInput {
  return {
    platform: input.platform,
    sourceUrl: input.sourceUrl,
    sourceTitle: input.sourceTitle,
    transcript: input.transcript,
    manualDescription: input.manualDescription,
    comments: input.comments,
    targetIndustry: input.targetIndustry,
    targetProduct: input.targetProduct,
    targetAudience: input.targetAudience,
    rewriteGoal: input.rewriteGoal,
    rewriteStyle: input.rewriteStyle,
    extraRequirement: input.extraRequirement,
    instruction: "请基于逐字稿拆结构、钩子、情绪、节奏、画面逻辑和转化路径，再为用户产品生成原创脚本。不要复制原视频文案。"
  };
}

function buildFallback(input: Partial<ReturnType<typeof normalizeRewriteInput>>) {
  const targetProduct = input.targetProduct || "目标产品";
  const targetAudience = input.targetAudience || "目标人群";
  const title = input.sourceTitle || "原视频";

  return [
    "# 拆片结果",
    "",
    "## 1. 视频核心主题",
    `${title}的核心是先点出用户正在纠结的问题，再用判断标准或真实场景建立信任。`,
    "",
    "## 2. 目标人群",
    targetAudience,
    "",
    "## 3. 开头钩子",
    "用一句话点破目标人群最容易忽略的误区，让用户觉得这条内容和自己有关。",
    "",
    "## 4. 爆款元素",
    "人群圈定、反差、避坑、成本感。",
    "",
    "## 5. 内容结构",
    "开头抛冲突 → 中段拆判断标准 → 插入证据画面 → 结尾给行动建议。",
    "",
    "## 6. 情绪变化",
    "困惑 → 被点破 → 看到标准 → 建立信任 → 想继续咨询。",
    "",
    "## 7. 节奏设计",
    "前 3 秒直接抛问题，中段每 8-12 秒切换一次画面或证据，结尾回到转化动作。",
    "",
    "## 8. 画中画/画面辅助逻辑",
    "痛点段放用户评论或错误示范，卖点段放产品细节和对比画面，结尾放咨询或直播间承接。",
    "",
    "## 9. 转化路径",
    "先建立专业判断，再引导评论、私信或直播间进一步承接。",
    "",
    "## 10. 可迁移结构",
    `迁移到${targetProduct}：点破误区 → 给出 3 个判断标准 → 用产品细节证明 → 引导用户留下需求。`,
    "",
    buildFallbackRewrite(input)
  ].join("\n");
}

function buildFallbackRewrite(input: Partial<ReturnType<typeof normalizeRewriteInput>>) {
  const targetProduct = input.targetProduct || "目标产品";
  const targetAudience = input.targetAudience || "目标人群";

  return [
    "# 仿写结果",
    "",
    "## 1. 新选题",
    `${targetAudience}选择${targetProduct}前，先看懂这 3 个隐藏标准`,
    "",
    "## 2. 新标题",
    `${targetProduct}别只看表面，真正影响结果的是这 3 点`,
    "",
    "## 3. 开头 3 秒钩子",
    `${targetAudience}如果正在看${targetProduct}，先别急着决定，很多人踩坑就是因为忽略了这 3 个细节。`,
    "",
    "## 4. 完整口播脚本",
    `如果你是${targetAudience}，正在纠结${targetProduct}，这条先听完。\n很多人不是不会选，而是一上来就看错重点。\n第一，看它能不能解决你最真实的使用问题。\n第二，看卖点有没有具体画面和真实证据，而不是只听一句口号。\n第三，看后续承接是否清楚，出了问题有没有人能把话说明白。\n所以这条内容不是让你马上下单，而是先把判断标准搞清楚。\n如果你也在纠结，把你的情况留在评论区，我按真实需求帮你判断。`,
    "",
    "## 5. 分镜建议",
    "镜头 1：人物中近景直视镜头说钩子。\n镜头 2：切产品或业务真实场景。\n镜头 3：展示细节、流程或对比。\n镜头 4：放评论、反馈或案例。\n镜头 5：回到人物做结尾引导。",
    "",
    "## 6. 画中画建议",
    "用户痛点、评论截图、产品细节、对比画面、咨询入口。",
    "",
    "## 7. 拍摄提醒",
    "不要复制原视频文案和画面，只复用结构。所有证据都用自己的产品、自己的场景、自己的案例。",
    "",
    "## 8. 结尾引导",
    "把你的情况留在评论区，我按真实需求帮你判断。",
    "",
    "## 9. 延展选题",
    `1. ${targetProduct}最容易被忽略的 3 个成本\n2. ${targetAudience}买${targetProduct}前必须问清楚的问题\n3. 为什么便宜的${targetProduct}可能更贵\n4. ${targetProduct}怎么选才不踩坑\n5. 从真实案例看${targetProduct}的判断标准`
  ].join("\n");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
