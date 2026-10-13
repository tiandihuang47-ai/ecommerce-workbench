import { adminGuardFailure, requireAdminFromRequest } from "@/lib/auth/guard";
import { access, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { extractAudioFromVideo } from "@/lib/audio-extractor";
import { getAsrProviderStatus, transcribeAudio } from "@/lib/doubao-asr";
import { checkFfmpegInstalled, checkRequiredTools } from "@/lib/system-check";
import { resolveVideoLink } from "@/lib/video-resolver";
import { detectPlatform, normalizeUrl } from "@/lib/video-link-parser";

export const runtime = "nodejs";
export const maxDuration = 600;

type StepStatus = "success" | "failed" | "skipped";

interface TranscriptDebugStep {
  name: string;
  status: StepStatus;
  message: string;
}

interface DebugResultInput {
  success: boolean;
  transcript?: string;
  sourceType: "link" | "upload" | "manual";
  cleanUrl?: string;
  platform?: string;
  videoPath?: string;
  audioPath?: string;
  steps: TranscriptDebugStep[];
  rawError?: string;
  suggestion: string;
}

export async function POST(request: Request) {
  const adminFailure = await adminGuardFailure(await requireAdminFromRequest(request));
  if (adminFailure) return adminFailure;
  const steps: TranscriptDebugStep[] = [];
  let rawError = "";
  let sourceType: DebugResultInput["sourceType"] = "link";

  try {
    const body = await request.json().catch(() => ({}));
    sourceType = normalizeSourceType(body.sourceType);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const filePath = typeof body.filePath === "string" ? body.filePath.trim() : "";
    const manualTranscript = typeof body.transcript === "string" ? body.transcript.trim() : "";

    steps.push({
      name: "检查输入",
      status: sourceType === "manual"
        ? manualTranscript ? "success" : "failed"
        : sourceType === "upload"
          ? filePath ? "success" : "failed"
          : url ? "success" : "failed",
      message: sourceType === "manual"
        ? manualTranscript ? `已收到手动逐字稿，长度 ${manualTranscript.length} 字。` : "手动模式需要传入 transcript。"
        : sourceType === "upload"
          ? filePath ? `已收到本地视频路径：${filePath}` : "上传/本地文件诊断需要传入 filePath。"
          : url ? "已收到链接输入。" : "链接模式需要传入 url。"
    });

    if (sourceType === "manual") {
      if (!manualTranscript) {
        return buildResult({
          success: false,
          sourceType,
          steps,
          rawError: "manual_transcript_empty",
          suggestion: "请粘贴逐字稿后再进入拆片；手动模式不需要 ASR。"
        }, 400);
      }

      markSkipped(steps, ["解析链接", "下载视频", "检查 ffmpeg", "提取音频", "检查 ASR 配置", "调用 ASR"]);
      steps.push({ name: "解析逐字稿", status: "success", message: "手动逐字稿可直接用于拆片。" });
      return buildResult({
        success: true,
        transcript: manualTranscript,
        sourceType,
        steps,
        suggestion: "手动逐字稿链路正常。"
      });
    }

    let videoPath = "";
    let cleanUrl = "";
    let platform = "unknown";

    if (sourceType === "link") {
      cleanUrl = normalizeUrl(url);
      platform = detectPlatform(cleanUrl);
      steps.push({
        name: "解析链接",
        status: cleanUrl && platform !== "unknown" ? "success" : "failed",
        message: cleanUrl
          ? platform === "unknown"
            ? "已提取链接，但暂未识别平台。"
            : `已识别为 ${platform}：${cleanUrl}`
          : "没有从输入中提取到有效链接。"
      });

      if (!cleanUrl || platform === "unknown") {
        markSkipped(steps, ["下载视频", "检查 ffmpeg", "提取音频", "检查 ASR 配置", "调用 ASR", "解析逐字稿"]);
        return buildResult({
          success: false,
          sourceType,
          cleanUrl,
          platform,
          steps,
          rawError: cleanUrl ? "platform_unknown" : "url_empty",
          suggestion: "请粘贴完整平台视频链接；如果链接平台限制解析，请改用上传视频或手动输入逐字稿。"
        }, 400);
      }

      const tools = await checkRequiredTools();
      steps.push({
        name: "检查 ffmpeg",
        status: tools.tools.find((tool) => tool.name === "ffmpeg")?.installed ? "success" : "failed",
        message: tools.tools.find((tool) => tool.name === "ffmpeg")?.message || tools.message
      });

      const resolved = await resolveVideoLink(cleanUrl);
      videoPath = resolved.videoPath;
      steps.push({
        name: "下载视频",
        status: resolved.success && resolved.videoPath ? "success" : "failed",
        message: resolved.videoPath
          ? `视频已下载：${resolved.videoPath}`
          : `${resolved.message}${resolved.attempts?.length ? `；尝试策略：${resolved.attempts.map((item) => `${item.strategy}${item.success ? "成功" : "失败"}`).join("，")}` : ""}`
      });

      if (!videoPath) {
        markSkipped(steps, ["提取音频", "检查 ASR 配置", "调用 ASR", "解析逐字稿"]);
        return buildResult({
          success: false,
          sourceType,
          cleanUrl,
          platform,
          steps,
          rawError: resolved.message,
          suggestion: "链接下载失败通常是平台登录、风控、短链跳转或 yt-dlp 支持问题。请优先改用上传视频；也可以手动粘贴逐字稿。"
        }, 200);
      }
    }

    if (sourceType === "upload") {
      markSkipped(steps, ["解析链接", "下载视频"]);
      try {
        await access(filePath);
        const fileStat = await stat(filePath);
        videoPath = filePath;
        steps.push({
          name: "检查本地文件",
          status: "success",
          message: `本地视频文件存在，大小 ${formatSize(fileStat.size)}。`
        });
      } catch (error) {
        markSkipped(steps, ["提取音频", "检查 ASR 配置", "调用 ASR", "解析逐字稿"]);
        return buildResult({
          success: false,
          sourceType,
          videoPath: filePath,
          steps,
          rawError: summarizeError(error),
          suggestion: "请确认传入的是服务端本机可访问的视频文件路径；网页上传请使用页面里的上传视频入口。"
        }, 400);
      }
    }

    const ffmpeg = await checkFfmpegInstalled();
    if (!steps.some((step) => step.name === "检查 ffmpeg")) {
      steps.push({ name: "检查 ffmpeg", status: ffmpeg.installed ? "success" : "failed", message: ffmpeg.message });
    }
    if (!ffmpeg.installed) {
      markSkipped(steps, ["提取音频", "检查 ASR 配置", "调用 ASR", "解析逐字稿"]);
      return buildResult({
        success: false,
        sourceType,
        cleanUrl,
        platform,
        videoPath,
        steps,
        rawError: ffmpeg.message,
        suggestion: "请先安装 ffmpeg：brew install ffmpeg。"
      }, 500);
    }

    const audio = await extractAudioFromVideo(videoPath);
    steps.push({
      name: "提取音频",
      status: audio.success ? "success" : "failed",
      message: audio.success ? `音频已生成：${audio.audioPath}` : audio.message
    });
    if (!audio.success) {
      markSkipped(steps, ["检查 ASR 配置", "调用 ASR", "解析逐字稿"]);
      return buildResult({
        success: false,
        sourceType,
        cleanUrl,
        platform,
        videoPath,
        steps,
        rawError: audio.message,
        suggestion: "音频提取失败，请换 mp4/mov/webm 文件，或手动输入逐字稿。"
      }, 500);
    }

    const asrStatus = getAsrProviderStatus();
    steps.push({
      name: "检查语音转写配置",
      status: asrStatus.configured ? "success" : "failed",
      message: asrStatus.message
    });
    if (!asrStatus.configured) {
      markSkipped(steps, ["调用 ASR", "解析逐字稿"]);
      return buildResult({
        success: false,
        sourceType,
        cleanUrl,
        platform,
        videoPath,
        audioPath: audio.audioPath,
        steps,
        rawError: asrStatus.message,
        suggestion: "请在 .env.local 中配置 ARK_API_KEY（火山方舟），然后重启服务；或手动粘贴逐字稿继续拆片。"
      }, 200);
    }

    const asr = await transcribeAudio(audio.audioPath);
    steps.push({
      name: "调用语音转写",
      status: asr.success ? "success" : "failed",
      message: asr.message
    });
    steps.push({
      name: "解析逐字稿",
      status: asr.success && asr.transcript.trim() ? "success" : "failed",
      message: asr.transcript.trim()
        ? `已获得逐字稿，长度 ${asr.transcript.trim().length} 字。`
        : "ASR 没有返回有效逐字稿。"
    });

    return buildResult({
      success: asr.success && Boolean(asr.transcript.trim()),
      transcript: asr.transcript,
      sourceType,
      cleanUrl,
      platform,
      videoPath,
      audioPath: audio.audioPath,
      steps,
      rawError: asr.success ? "" : asr.message,
      suggestion: asr.success
        ? "逐字稿读取链路正常。"
        : "ASR 失败时，可改用更短视频、上传更清晰音频，或手动粘贴逐字稿继续拆片。"
    }, 200);
  } catch (error) {
    rawError = summarizeError(error);
    steps.push({ name: "解析逐字稿", status: "failed", message: rawError });
    return buildResult({
      success: false,
      sourceType,
      steps,
      rawError,
      suggestion: "逐字稿诊断接口异常，请查看服务端日志；也可以上传视频或手动输入逐字稿继续。"
    }, 500);
  }
}

function buildResult(input: DebugResultInput, status = 200) {
  return NextResponse.json({
    success: input.success,
    sourceType: input.sourceType,
    cleanUrl: input.cleanUrl || "",
    platform: input.platform || "unknown",
    videoPath: input.videoPath || "",
    audioPath: input.audioPath || "",
    transcript: input.transcript || "",
    transcriptPreview: input.transcript ? input.transcript.slice(0, 300) : "",
    steps: input.steps,
    rawError: input.rawError || "",
    suggestion: input.suggestion
  }, { status });
}

function normalizeSourceType(value: unknown): "link" | "upload" | "manual" {
  return value === "upload" || value === "manual" ? value : "link";
}

function markSkipped(steps: TranscriptDebugStep[], names: string[]) {
  for (const name of names) {
    if (!steps.some((step) => step.name === name)) {
      steps.push({ name, status: "skipped", message: "前置步骤未完成，已跳过。" });
    }
  }
}

function summarizeError(error: unknown) {
  if (error instanceof Error) return error.message.replace(/\s+/g, " ").slice(0, 500);
  return String(error || "未知错误").replace(/\s+/g, " ").slice(0, 500);
}

function formatSize(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.ceil(value / 1024)}KB`;
}
