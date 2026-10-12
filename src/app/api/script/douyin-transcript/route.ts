import { denyIfUnauthenticated } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { DouyinTranscriptError, transcribeDouyinVideo } from "@/lib/video-import/douyin-transcript";
import type { DouyinTranscriptStage } from "@/lib/video-import/douyin-transcript";

export const runtime = "nodejs";
export const maxDuration = 300;

const statusByStage: Record<DouyinTranscriptStage, number> = {
  INVALID_URL: 400,
  VIDEO_IMPORT_FAILED: 502,
  AUDIO_EXTRACT_FAILED: 502,
  ASR_FAILED: 502,
  ASR_ACCOUNT_ISSUE: 402,
  NO_SPEECH: 422
};

/** 账户类问题重试没有意义，前端不要显示「重试」。 */
const nonRetryableStages: DouyinTranscriptStage[] = ["ASR_ACCOUNT_ISSUE"];

/**
 * 脚本页「抖音链接 → 逐字稿」。
 *
 * 复用爆款复刻同一条导入链路（importDouyinVideo）+ 现有阿里云 ASR，
 * 只返回逐字稿，不创建 replica task，不改动爆款复刻的任何流程。
 */
export async function POST(request: Request) {
  const deny = await denyIfUnauthenticated(request);
  if (deny) return deny;
  let body: { input?: unknown };
  try {
    body = await request.json();
  } catch {
    return failure("INVALID_URL", "未识别到有效抖音链接");
  }

  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) return failure("INVALID_URL", "未识别到有效抖音链接");

  try {
    const result = await transcribeDouyinVideo(input);
    return NextResponse.json({
      success: true,
      transcript: result.transcript,
      title: result.title,
      authorName: result.authorName,
      durationSeconds: result.durationSeconds,
      sourceUrl: result.sourceUrl,
      resolvedUrl: result.resolvedUrl,
      awemeId: result.awemeId,
      videoPath: result.videoPath,
      videoHash: result.videoHash,
      importedAt: result.importedAt
    });
  } catch (error) {
    if (error instanceof DouyinTranscriptError) {
      console.error("[SCRIPT_DOUYIN_TRANSCRIPT] FAILED stage=" + error.stage + " detail=" + error.detail);
      return failure(error.stage, error.message, !nonRetryableStages.includes(error.stage));
    }
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[SCRIPT_DOUYIN_TRANSCRIPT] FAILED stage=VIDEO_IMPORT_FAILED detail=" + message);
    return failure("VIDEO_IMPORT_FAILED", "视频解析失败，请重试");
  }
}

function failure(stage: DouyinTranscriptStage, message: string, retryable = true) {
  // 真实底层错误只写服务端日志，不展示给用户，方便排查。
  return NextResponse.json(
    { success: false, stage, message, retryable },
    { status: statusByStage[stage] || 502 }
  );
}
