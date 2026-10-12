import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import {
  buildAnalysisSample,
  buildFallbackCommentInsights,
  cleanComments,
  commentInsightPromptVersion,
  commentsHash,
  douyinCommentConfig,
  normalizeDouyinComments,
  type CommentInsights,
  type CommentSignalType
} from "@/lib/douyin-comments";
import { getDeepSeekErrorMessage, safeJsonParse } from "@/lib/deepseek";
import { generateCopywritingText, isRouteConfigured } from "@/lib/copywriting-service";

export const runtime = "nodejs";
export const maxDuration = 240;

/**
 * 评论洞察（CommentInsightAnalyzer 的服务端入口）。
 *
 * 重点不是舆情情感分析，而是回答：用户最关心/最怕什么、为什么还没买、哪些问题值得下一条视频回答（§十九）。
 * 输入只取「采样后的评论 + 原逐字稿摘要 + 产品上下文」，输出结构化、可追溯的 CommentInsights（§四十五/§四十六）。
 */
export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  const awemeId = typeof body.awemeId === "string" ? body.awemeId : "";
  const comments = cleanComments(normalizeDouyinComments(
    Array.isArray(body.comments) ? body.comments as Array<Record<string, unknown>> : [],
    { awemeId }
  ));
  const transcript = typeof body.transcript === "string" ? body.transcript.slice(0, 6000) : "";
  const productContext = typeof body.productContext === "string" ? body.productContext.slice(0, 4000) : "";

  if (!comments.length) {
    return NextResponse.json({
      success: false,
      message: "没有可分析的评论。",
      insights: buildFallbackCommentInsights([])
    }, { status: 400 });
  }

  const hash = commentsHash(comments);
  const sample = buildAnalysisSample(comments, douyinCommentConfig.analysisSampleSize);
  const fallback = buildFallbackCommentInsights(comments);

  if (!isRouteConfigured("douyin_comment_insight")) {
    return NextResponse.json({
      success: true,
      source: "fallback",
      promptVersion: commentInsightPromptVersion,
      commentsHash: hash,
      sampleSize: sample.length,
      message: "DeepSeek 未配置，已使用本地规则归纳评论。",
      insights: fallback
    });
  }

  const systemPrompt = `
你是电商短视频的评论区洞察分析师，服务中小电商内容团队。
你的任务不是做舆情情感分析（不要输出“正面 60% 负面 30%”这种结论），而是回答：
1. 用户最关心什么？2. 用户最怕什么？3. 用户为什么还没买？
4. 用户最常问什么？5. 用户觉得原视频哪里没讲清楚？
6. 哪些问题值得下一条视频单独回答？7. 哪些评论可以直接变成新 Hook？8. 哪些评论透露了新的消费场景？

硬性要求：
1. 只输出严格 JSON，不要 Markdown，不要解释。
2. 必须区分「产品事实」与「观众看法」：评论里的说法一律是观众观点，**不能**当成产品参数。如果评论质疑参数，写成“用户对 X 存在疑虑”，不要写成事实。
3. 不要编造价格、销量、检测报告、明星代言、认证或功效。
4. 必须有样本量意识：样本少于 10 条时说“现有 N 条评论中出现…”，不要写成“用户普遍认为……”。
5. 每个结论尽量给出 evidenceCommentIds（来自输入的 commentId）。
6. 内容机会要能直接变成短视频选题，不要写空话。
7. 涉及辅助画面统一写“画中画”，不要出现 broll。
`.trim();

  const userPrompt = [
    "请基于下面的信息输出评论洞察 JSON。",
    `JSON 字段：{"summary":"","highFrequencyTopics":[{"topic":"","count":0,"evidenceCommentIds":[]}],"highFrequencyQuestions":[],"painPoints":[],"purchaseBarriers":[],"desiredOutcomes":[],"productConcerns":[],"positiveSignals":[],"negativeSignals":[],"contentOpportunities":[{"angle":"","reason":"","evidenceCommentIds":[]}],"representativeComments":[{"commentId":"","text":"","reason":"","signalType":"question|pain_point|purchase_barrier|positive|negative|content_opportunity"}],"confidence":"low|medium|high"}`,
    "除 highFrequencyTopics / contentOpportunities / representativeComments 外，其余数组的元素必须是**字符串**（一句完整的中文短语或句子），不要用对象。",
    `样本量：${sample.length} 条（本次共采集 ${comments.length} 条）`,
    "【原视频逐字稿摘要】",
    transcript || "（未提供）",
    "【当前产品资料（事实来源，仅供参考，不能反推评论）】",
    productContext || "（未提供）",
    "【评论样本（含点赞/回复数）】",
    sample.map((item) => `- ${item.commentId}｜${item.likeCount}赞/${item.replyCount}回复｜${item.text}`).join("\n")
  ].join("\n\n");

  try {
    const copy = await generateCopywritingText({
      purpose: "douyin_comment_insight",
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.4
    });
    const content = copy.text;
    const parsed = safeJsonParse<Record<string, unknown>>(content) || safeJsonParse<Record<string, unknown>>(extractJson(content));
    if (!parsed) throw new Error("AI 没有返回有效 JSON。");
    return NextResponse.json({
      success: true,
      source: copy.source,
      promptVersion: commentInsightPromptVersion,
      commentsHash: hash,
      sampleSize: sample.length,
      message: `已根据 ${sample.length} 条评论生成洞察。`,
      insights: mergeInsights(parsed, fallback, hash, sample.length)
    });
  } catch (error) {
    console.error("[SCRIPT_COMMENT_INSIGHTS] FAILED detail=" + (error instanceof Error ? error.message : "unknown"));
    return NextResponse.json({
      success: true,
      source: "fallback",
      promptVersion: commentInsightPromptVersion,
      commentsHash: hash,
      sampleSize: sample.length,
      message: `${getDeepSeekErrorMessage(error) || "AI 分析失败"}，已改用本地规则归纳评论。`,
      insights: fallback
    });
  }
}

function extractJson(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return value;
  return value.slice(start, end + 1);
}

function mergeInsights(parsed: Record<string, unknown>, fallback: CommentInsights, hash: string, sampleSize: number): CommentInsights {
  const signalTypes: CommentSignalType[] = ["question", "pain_point", "purchase_barrier", "positive", "negative", "content_opportunity"];
  // 模型偶尔会把数组元素写成对象（例如 {barrier:"..."}），这里统一抽成一句人话，
  // 否则界面上会出现 "[object Object]"。
  const toLine = (item: unknown): string => {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const keys = ["text", "value", "label", "title", "barrier", "point", "need", "concern", "question", "reason", "summary", "signal"];
      for (const key of keys) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      }
      const firstString = Object.values(record).find((value) => typeof value === "string" && value.trim());
      if (typeof firstString === "string") return firstString.trim();
    }
    return "";
  };
  const stringList = (value: unknown, alt: string[]) => {
    if (!Array.isArray(value)) return alt;
    const items = Array.from(new Set(value.map(toLine).filter(Boolean))).slice(0, 10);
    return items.length ? items : alt;
  };
  const idList = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8) : [];

  const topics = Array.isArray(parsed.highFrequencyTopics)
    ? parsed.highFrequencyTopics.filter(isRecord).map((item) => ({
      topic: String(item.topic || "").trim(),
      count: Number(item.count || 0) || 0,
      evidenceCommentIds: idList(item.evidenceCommentIds)
    })).filter((item) => item.topic).slice(0, 10)
    : fallback.highFrequencyTopics;

  const opportunities = Array.isArray(parsed.contentOpportunities)
    ? parsed.contentOpportunities.filter(isRecord).map((item) => ({
      angle: String(item.angle || "").trim(),
      reason: String(item.reason || "").trim(),
      evidenceCommentIds: idList(item.evidenceCommentIds)
    })).filter((item) => item.angle).slice(0, 8)
    : fallback.contentOpportunities;

  const representatives = Array.isArray(parsed.representativeComments)
    ? parsed.representativeComments.filter(isRecord).map((item, index) => {
      const signalType = String(item.signalType || "") as CommentSignalType;
      return {
        commentId: String(item.commentId || `rep_${index + 1}`),
        text: String(item.text || "").trim().slice(0, 300),
        reason: String(item.reason || "").trim().slice(0, 120),
        signalType: signalTypes.includes(signalType) ? signalType : "question" as CommentSignalType
      };
    }).filter((item) => item.text).slice(0, douyinCommentConfig.representativeCount)
    : fallback.representativeComments;

  const confidence = String(parsed.confidence || "");
  return {
    ...fallback,
    sampleSize,
    summary: String(parsed.summary || fallback.summary).trim().slice(0, 600),
    highFrequencyTopics: topics,
    highFrequencyQuestions: stringList(parsed.highFrequencyQuestions, fallback.highFrequencyQuestions),
    painPoints: stringList(parsed.painPoints, fallback.painPoints),
    purchaseBarriers: stringList(parsed.purchaseBarriers, fallback.purchaseBarriers),
    desiredOutcomes: stringList(parsed.desiredOutcomes, fallback.desiredOutcomes),
    productConcerns: stringList(parsed.productConcerns, fallback.productConcerns),
    positiveSignals: stringList(parsed.positiveSignals, fallback.positiveSignals),
    negativeSignals: stringList(parsed.negativeSignals, fallback.negativeSignals),
    contentOpportunities: opportunities,
    representativeComments: representatives,
    confidence: confidence === "low" || confidence === "medium" || confidence === "high" ? confidence : fallback.confidence,
    promptVersion: commentInsightPromptVersion,
    commentsHash: hash,
    generatedAt: new Date().toISOString(),
    source: "deepseek"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
