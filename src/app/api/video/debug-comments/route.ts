import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { normalizeCommentRecords } from "@/lib/comment-insights";
import { checkCrawlerServiceHealth, resolveCommentsWithCrawlerService } from "@/lib/crawler-service-client";
import {
  detectCommentPlatform,
  extractDouyinVideoId,
  extractFirstUrlFromText,
  normalizeVideoUrl,
  resolveShortVideoUrl,
  type CommentDebugStep
} from "@/lib/douyin-comment-debug";
import type { SimpleDeconstructionRecord } from "@/lib/pipeline-types";

export const runtime = "nodejs";
const crawlerServiceUrl = process.env.CRAWLER_SERVICE_URL || "http://127.0.0.1:8787";

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  const steps: CommentDebugStep[] = [];
  let rawError = "";

  try {
    const body = await request.json().catch(() => ({}));
    const input = typeof body.url === "string" ? body.url : "";
    const extracted = extractFirstUrlFromText(input);
    const cleanUrl = normalizeVideoUrl(extracted || input);

    if (cleanUrl) {
      steps.push({ name: "提取纯链接", status: "success", message: cleanUrl });
    } else {
      steps.push({ name: "提取纯链接", status: "failed", message: "没有从输入中提取到 http 链接。" });
      return buildResult({ steps, cleanUrl: "", platform: "unknown", videoId: "", rawError, comments: [], suggestion: "请粘贴完整抖音链接或分享文案里的 http 链接。" });
    }

    const platform = detectCommentPlatform(cleanUrl);
    steps.push({
      name: "识别平台",
      status: platform === "unknown" ? "failed" : "success",
      message: platform === "unknown" ? "未识别到支持的平台。" : `识别为 ${platform}。`
    });

    const redirect = await resolveShortVideoUrl(cleanUrl);
    const normalizedUrl = redirect.finalUrl || cleanUrl;
    steps.push({
      name: "解析短链跳转",
      status: normalizedUrl ? "success" : "failed",
      message: redirect.message || normalizedUrl
    });

    const videoId = platform === "douyin" ? extractDouyinVideoId(normalizedUrl) || extractDouyinVideoId(cleanUrl) : "";
    steps.push({
      name: "提取视频 ID",
      status: platform === "douyin" ? videoId ? "success" : "failed" : "skipped",
      message: platform === "douyin" ? videoId || "未从链接中提取到 aweme_id / item_id。" : "非抖音链接暂不需要 aweme_id。"
    });

    const health = await checkCrawlerServiceHealth();
    steps.push({
      name: "检查 crawler-service",
      status: health.success ? "success" : "failed",
      message: health.message
    });

    if (!health.success) {
      return buildResult({
        steps,
        cleanUrl,
        platform,
        videoId,
        stage: "crawler-service",
        message: health.message,
        fallbackRequired: true,
        rawError: health.message,
        comments: [],
        inputUrl: input,
        crawlerServiceHealth: false,
        suggestion: "crawler-service 未启动，请运行 npm run crawler:dev；或手动粘贴评论继续分析。"
      });
    }

    const result = await resolveCommentsWithCrawlerService({
      url: normalizedUrl || cleanUrl,
      platform,
      limit: 10,
      sortBy: "likeCount"
    });
    rawError = result.message || "";
    steps.push({
      name: "调用评论抓取接口",
      status: result.success ? "success" : "failed",
      message: result.message || (result.success ? "评论接口调用成功。" : "评论接口调用失败。")
    });

    const comments = normalizeCommentRecords(result.comments || [], { platform, videoUrl: normalizedUrl || cleanUrl, limit: 10 });
    steps.push({
      name: "解析评论字段",
      status: comments.length ? "success" : "failed",
      message: comments.length ? `解析到 ${comments.length} 条有效评论。` : "接口未返回可用评论字段，或字段映射后内容为空。"
    });

    const sorted = comments.every((item, index, list) => index === 0 || list[index - 1].likeCount >= item.likeCount);
    steps.push({
      name: "点赞量排序",
      status: comments.length ? sorted ? "success" : "failed" : "skipped",
      message: comments.length ? sorted ? "已按点赞量从高到低排序。" : "评论存在，但点赞量排序异常。" : "没有评论可排序。"
    });

    return buildResult({
      steps,
      cleanUrl,
      platform,
      videoId: videoId || String(result.videoId || ""),
      rawError,
      comments,
      source: result.source || "unsupported",
      strategy: result.strategy || "",
      attempts: result.attempts || [],
      stage: result.success ? "" : result.stage || "comments",
      message: result.message || rawError,
      inputUrl: input,
      crawlerServiceHealth: health.success,
      needsLogin: Boolean(result.needsLogin),
      needsCookie: Boolean(result.needsCookie),
      fallbackRequired: !comments.length,
      suggestion: comments.length
        ? "评论抓取链路已跑通。"
        : buildSuggestion(result.stage || "", result.message || rawError)
    });
  } catch (error) {
    rawError = error instanceof Error ? error.message : "评论诊断接口异常。";
    steps.push({ name: "调用评论抓取接口", status: "failed", message: rawError });
    return buildResult({
      steps,
      cleanUrl: "",
      platform: "unknown",
      videoId: "",
      rawError,
      comments: [],
      suggestion: "诊断接口异常，请查看服务端日志；也可以手动粘贴评论继续分析。"
    }, 500);
  }
}

function buildResult(input: {
  steps: CommentDebugStep[];
  cleanUrl: string;
  platform: SimpleDeconstructionRecord["platform"];
  videoId: string;
  rawError: string;
  comments: ReturnType<typeof normalizeCommentRecords>;
  source?: string;
  strategy?: string;
  attempts?: unknown[];
  stage?: string;
  message?: string;
  inputUrl?: string;
  crawlerServiceHealth?: boolean;
  needsLogin?: boolean;
  needsCookie?: boolean;
  fallbackRequired?: boolean;
  suggestion: string;
}, status = 200) {
  const topComments = input.comments.slice(0, 10);
  return NextResponse.json({
    success: topComments.length > 0,
    inputUrl: input.inputUrl || "",
    platform: input.platform,
    cleanUrl: input.cleanUrl,
    videoId: input.videoId,
    crawlerServiceUrl,
    crawlerServiceHealth: Boolean(input.crawlerServiceHealth),
    steps: input.steps,
    source: input.source || "unsupported",
    strategy: input.strategy || "",
    attempts: input.attempts || [],
    stage: input.stage || "",
    message: input.message || "",
    fallbackRequired: input.fallbackRequired ?? topComments.length === 0,
    needsLogin: Boolean(input.needsLogin),
    needsCookie: Boolean(input.needsCookie),
    commentsCount: input.comments.length,
    topComments,
    rawError: input.rawError,
    suggestion: input.suggestion
  }, { status });
}

function buildSuggestion(stage: string, message: string) {
  if (/登录|风控|验证码|a_bogus|verify|权限|cookie|DOUYIN_COOKIE|403|401/i.test(message)) return "抖音可能要求登录态或授权 Cookie；默认模式不会读取浏览器 Cookie。请手动粘贴评论，或后续在高级模式中手动配置授权登录态。";
  if (stage === "crawler-service" || /crawler-service.*未启动|crawler-service.*无法连接|ECONNREFUSED/i.test(message)) return "crawler-service 未启动，请运行 npm run crawler:dev；或手动粘贴评论继续分析。";
  if (/fetch failed/i.test(message)) return "平台公开评论接口请求失败，可能是网络、接口变更或风控限制；请手动粘贴评论继续分析。";
  if (stage === "video_id") return "没有提取到抖音视频 ID，请尝试完整视频链接或先运行链接分析。";
  return "当前自动评论抓取没有拿到评论；可手动粘贴评论继续分析。";
}
