import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { buildFallbackCommentInsights, normalizeCommentRecords } from "@/lib/comment-insights";
import { getDeepSeekErrorMessage } from "@/lib/deepseek";
import { generateCopywritingText, isRouteConfigured } from "@/lib/copywriting-service";
import type { HighLikeCommentInsights, SimpleDeconstructionRecord } from "@/lib/pipeline-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const videoInfo = isRecord(body.videoInfo) ? body.videoInfo : {};
    const productContext = isRecord(body.productContext) ? body.productContext : {};
    const platform = normalizePlatform(String(videoInfo.platform || body.platform || "unknown"));
    const videoUrl = String(videoInfo.url || videoInfo.sourceUrl || body.url || "");
    const comments = normalizeCommentRecords(Array.isArray(body.comments) ? body.comments : [], { platform, videoUrl, limit: 10 });

    if (!comments.length) {
      return NextResponse.json({
        success: false,
        message: "暂未获取到高赞评论，可手动粘贴评论继续分析。",
        insights: buildFallbackCommentInsights([], productContext)
      }, { status: 400 });
    }

    const fallback = buildFallbackCommentInsights(comments, productContext);

    if (!isRouteConfigured("comment_insight")) {
      return NextResponse.json({
        success: true,
        source: "fallback",
        message: "文本模型暂未配置，已使用本地规则生成评论洞察。",
        insights: fallback
      });
    }

    try {
      const copy = await generateCopywritingText({
        purpose: "comment_insight",
        temperature: 0.45,
        system: [
              "你是电商短视频评论区洞察专家，服务中小电商内容团队。",
              "你要从高赞评论里提炼用户真实关注点、痛点、购买顾虑、拍摄建议、选题方向、开头钩子、脚本方向和成交机会。",
              "不要编造产品价格、销量、检测报告、明星代言或平台背书。",
              `涉及辅助画面时一律使用“画中画”，不要使用 b${"roll"} 这个词。`,
              "只输出严格 JSON，不要输出 Markdown。"
        ].join("\n"),
        user: [
              "请基于以下视频信息、产品上下文和高赞评论，输出结构化 JSON。",
              "JSON 字段必须包含：topConcerns, userPainPoints, purchaseObjections, contentAngles, shootingSuggestions, topicIdeas, hookIdeas, scriptDirections, conversionOpportunities, riskNotes, commentTags。",
              "每个数组建议 3-8 条，commentTags 结构为 [{commentId, tags: []}]。",
              "",
              "【视频信息】",
              JSON.stringify(videoInfo, null, 2),
              "",
              "【产品上下文】",
              JSON.stringify(productContext, null, 2),
              "",
              "【高赞评论】",
              JSON.stringify(comments.map((item) => ({
                commentId: item.commentId,
                content: item.content,
                likeCount: item.likeCount,
                authorName: item.authorName
              })), null, 2)
        ].join("\n")
      });
      const content = copy.text;
      const parsed = parseJsonBlock(content);
      const insights = mergeInsights(fallback, parsed);
      return NextResponse.json({
        success: true,
        source: copy.source,
        message: "已根据高赞评论生成拍摄建议。",
        insights
      });
    } catch (error) {
      return NextResponse.json({
        success: true,
        source: "fallback",
        message: `${getDeepSeekErrorMessage(error)}，已使用本地规则生成评论洞察。`,
        insights: fallback
      });
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "评论洞察分析失败。",
      insights: buildFallbackCommentInsights([])
    }, { status: 500 });
  }
}

function parseJsonBlock(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced || value).trim();
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mergeInsights(fallback: HighLikeCommentInsights, parsed: Record<string, unknown>): HighLikeCommentInsights {
  return {
    topConcerns: stringArray(parsed.topConcerns, fallback.topConcerns),
    userPainPoints: stringArray(parsed.userPainPoints, fallback.userPainPoints),
    purchaseObjections: stringArray(parsed.purchaseObjections, fallback.purchaseObjections),
    contentAngles: stringArray(parsed.contentAngles, fallback.contentAngles),
    shootingSuggestions: stringArray(parsed.shootingSuggestions, fallback.shootingSuggestions),
    topicIdeas: stringArray(parsed.topicIdeas, fallback.topicIdeas),
    hookIdeas: stringArray(parsed.hookIdeas, fallback.hookIdeas),
    scriptDirections: stringArray(parsed.scriptDirections, fallback.scriptDirections),
    conversionOpportunities: stringArray(parsed.conversionOpportunities, fallback.conversionOpportunities),
    riskNotes: stringArray(parsed.riskNotes, fallback.riskNotes),
    commentTags: Array.isArray(parsed.commentTags) ? parsed.commentTags.filter(isRecord).map((item) => ({
      commentId: String(item.commentId || ""),
      tags: stringArray(item.tags, [])
    })).filter((item) => item.commentId) : fallback.commentTags
  };
}

function stringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item) => String(item || "").trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePlatform(value: string): SimpleDeconstructionRecord["platform"] {
  if (["douyin", "kuaishou", "xiaohongshu", "wechat_channels", "bilibili", "youtube", "tiktok"].includes(value)) {
    return value as SimpleDeconstructionRecord["platform"];
  }
  return "unknown";
}
