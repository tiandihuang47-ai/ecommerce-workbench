import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { douyinCommentConfig, cleanComments, createCommentsState } from "@/lib/douyin-comments";
import { extractDouyinUrl } from "@/lib/video-import/douyin-transcript";
import { fetchDouyinComments } from "@/lib/video-import/douyin-comments";

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * 脚本页「抖音评论」采集入口。
 *
 * 只做三件事：解析链接 → 调 DouyinCommentAdapter → 返回归一化后的评论。
 * Cookie、签名、cursor、分页全部在 Adapter / crawler-service 内部，脚本 UI 不感知。
 */
export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "请求体必须是合法 JSON。", comments: [] }, { status: 400 });
  }

  const rawInput = typeof body.input === "string" ? body.input.trim() : "";
  const awemeId = typeof body.awemeId === "string" ? body.awemeId.trim() : "";
  const maxComments = Number(body.maxComments || 0) || douyinCommentConfig.defaultMaxComments;
  const includeReplies = typeof body.includeReplies === "boolean" ? body.includeReplies : douyinCommentConfig.includeReplies;

  const url = rawInput ? extractDouyinUrl(rawInput) : "";
  if (!url && !awemeId) {
    return NextResponse.json({
      success: false,
      stage: "INVALID_URL",
      message: "未识别到有效抖音链接，无法获取评论。",
      comments: []
    }, { status: 400 });
  }

  const result = await fetchDouyinComments({ url, awemeId, maxComments, includeReplies });
  const comments = cleanComments(result.comments);
  const state = createCommentsState(url || `https://www.douyin.com/video/${awemeId}`, result.awemeId);

  if (!result.success) {
    // 评论失败是「可降级」的：逐字稿与脚本生成照常，只是评论区显示提示（§三十七）。
    console.error("[SCRIPT_DOUYIN_COMMENTS] FAILED detail=" + (result.error || result.message));
    return NextResponse.json({
      ...state,
      status: "failed",
      stage: "COMMENTS_FAILED",
      error: result.message,
      comments: [],
      message: result.message
    }, { status: 200 });
  }

  return NextResponse.json({
    ...state,
    status: comments.length ? "success" : "partial",
    comments,
    totalFetched: comments.length,
    totalReported: result.totalReported,
    hasMore: result.hasMore,
    fetchedAt: result.fetchedAt,
    includeReplies,
    strategy: result.strategy,
    source: result.source,
    rawFetched: result.totalFetched,
    message: comments.length
      ? `已获取 ${comments.length} 条评论`
      : "暂时未获取到评论"
  });
}
