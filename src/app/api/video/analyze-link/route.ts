import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { platformLabels } from "@/lib/video-link-parser";
import { analyzePlatformLink } from "@/services/link-analyzer/analyzer";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return failure("platform_detect", "请求体必须是合法 JSON。");
  }

  const url = typeof (body as Record<string, unknown>)?.url === "string" ? String((body as Record<string, unknown>).url).trim() : "";
  if (!url) {
    return failure("platform_detect", "链接不能为空，请先粘贴平台视频链接。");
  }

  const result = await analyzePlatformLink({ url });
  if (result.status !== "success") {
    return NextResponse.json({
      success: false,
      stage: result.videoPath ? "asr" : "video_download",
      platform: result.platform,
      message: result.error || "链接分析失败，请改用上传视频或手动输入逐字稿。",
      attempts: result.attempts,
      fallbackRequired: true
    }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    platform: result.platform,
    platformLabel: platformLabels[result.platform],
    title: result.title,
    author: result.author,
    description: result.description,
    coverUrl: result.coverUrl,
    videoUrl: result.videoUrl,
    audioUrl: result.audioUrl,
    comments: result.comments,
    rawText: result.rawText,
    normalizedUrl: result.normalizedUrl,
    videoPath: result.videoPath,
    audioPath: result.audioPath,
    transcript: result.transcript,
    structuredJson: result.structuredJson,
    attempts: result.attempts,
    message: result.transcript ? "转写成功" : "已解析到公开信息，但未获得完整逐字稿。"
  });
}

function failure(stage: string, message: string, status = 400) {
  return NextResponse.json({
    success: false,
    stage,
    message,
    fallbackRequired: true
  }, { status });
}
