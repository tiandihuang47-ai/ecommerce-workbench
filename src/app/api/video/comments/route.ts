import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { normalizeCommentRecords } from "@/lib/comment-insights";
import { resolveCommentsWithCrawlerService } from "@/lib/crawler-service-client";
import { detectCommentPlatform, extractDouyinVideoId, normalizeVideoUrl, resolveShortVideoUrl } from "@/lib/douyin-comment-debug";
import type { SimpleDeconstructionRecord } from "@/lib/pipeline-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const cleanUrl = normalizeVideoUrl(url);
    const redirect = cleanUrl ? await resolveShortVideoUrl(cleanUrl) : { finalUrl: "", message: "" };
    const normalizedUrl = redirect.finalUrl || cleanUrl;
    const detectedPlatform = normalizePlatform(detectCommentPlatform(normalizedUrl || cleanUrl));
    const requestedPlatform = normalizePlatform(typeof body.platform === "string" ? body.platform : "");
    const platform = requestedPlatform === "unknown" ? detectedPlatform : requestedPlatform;
    const limit = Math.max(1, Math.min(Number(body.limit || 10), 10));
    const sortBy = body.sortBy === "default" ? "default" : "likeCount";

    if (!url) {
      return NextResponse.json({
        success: false,
        platform,
        cleanUrl: "",
        videoId: "",
        comments: [],
        source: "unsupported",
        stage: "input",
        message: "链接不能为空，请先输入视频链接。",
        suggestion: "请粘贴完整视频链接；如果只有评论文本，可直接使用手动粘贴评论。",
        fallbackRequired: true
      }, { status: 400 });
    }

    if (platform === "unknown") {
      return NextResponse.json({
        success: false,
        platform,
        cleanUrl,
        videoId: "",
        comments: [],
        source: "unsupported",
        stage: "platform_detect",
        message: "暂未识别到支持的平台，可手动粘贴评论区内容继续分析。",
        suggestion: "当前链接平台未识别，自动评论抓取已跳过；可以手动粘贴高赞评论继续生成洞察。",
        fallbackRequired: true
      }, { status: 200 });
    }

    const result = await resolveCommentsWithCrawlerService({ url: normalizedUrl || cleanUrl || url, platform, limit, sortBy });
    const comments = normalizeCommentRecords(result.comments || [], { platform, videoUrl: normalizedUrl || cleanUrl || url, limit });

    if (!result.success || !comments.length) {
      return NextResponse.json({
        success: false,
        platform,
        cleanUrl,
        normalizedUrl,
        videoId: platform === "douyin" ? extractDouyinVideoId(normalizedUrl || cleanUrl) : "",
        comments: [],
        source: result.source || "unsupported",
        stage: result.stage || "comments",
        message: result.message || "当前平台评论抓取暂未成功，可手动粘贴评论区内容继续分析。",
        suggestion: buildSuggestion(result.stage || "comments", result.message || ""),
        fallbackRequired: true,
        needsLogin: Boolean(result.needsLogin),
        needsCookie: Boolean(result.needsCookie),
        attempts: result.attempts || []
      }, { status: 200 });
    }

    return NextResponse.json({
      success: true,
      platform,
      cleanUrl,
      normalizedUrl,
      videoId: platform === "douyin" ? extractDouyinVideoId(normalizedUrl || cleanUrl) : "",
      comments,
      source: result.source || "crawler-service",
      message: `已获取点赞量最高的 ${comments.length} 条评论。`,
      needsLogin: false,
      needsCookie: false,
      attempts: result.attempts || []
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      platform: "unknown",
      cleanUrl: "",
      videoId: "",
      comments: [],
      source: "unsupported",
      stage: "comments",
      message: error instanceof Error ? error.message : "评论抓取失败，可手动粘贴评论继续分析。",
      suggestion: "系统内部抓取异常，不影响主拆片流程；请手动粘贴评论继续分析。",
      fallbackRequired: true,
      needsLogin: false,
      needsCookie: false
    }, { status: 500 });
  }
}

function buildSuggestion(stage: string, message: string) {
  if (/登录|风控|验证码|a_bogus|verify|权限|cookie|DOUYIN_COOKIE/i.test(message)) return "平台可能要求登录态或授权 Cookie；默认模式不会读取浏览器 Cookie。请手动粘贴评论，或后续在高级模式中手动配置授权登录态。";
  if (stage === "crawler-service" || /crawler-service.*未启动|crawler-service.*无法连接|ECONNREFUSED/i.test(message)) return "评论抓取服务未启动。请运行 npm run crawler:dev，或手动粘贴评论继续分析。";
  if (/fetch failed/i.test(message)) return "平台公开评论接口请求失败，可能是网络、接口变更或风控限制；请手动粘贴评论继续分析。";
  if (stage === "video_id") return "没有提取到抖音视频 ID，请换完整视频链接，或先用链接分析解析视频信息。";
  return "自动评论抓取失败不影响拆片，可手动粘贴评论继续生成洞察。";
}

function normalizePlatform(value: string): SimpleDeconstructionRecord["platform"] {
  if (["douyin", "kuaishou", "xiaohongshu", "wechat_channels", "bilibili", "youtube", "tiktok"].includes(value)) {
    return value as SimpleDeconstructionRecord["platform"];
  }
  return "unknown";
}
