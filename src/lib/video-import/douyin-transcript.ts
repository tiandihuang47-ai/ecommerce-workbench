import { extractAudioFromVideo } from "@/lib/audio-extractor";
import { transcribeAudio } from "@/lib/doubao-asr";
import { DouyinImportError, importDouyinVideo } from "@/lib/video-import/douyin-import";
import { detectPlatform, extractUrlFromText, normalizeUrl } from "@/lib/video-link-parser";

/**
 * 抖音视频 → 逐字稿 的共享服务。
 *
 * 这里不重新实现抖音解析，而是复用「爆款复刻」已经在用的导入链路：
 *   script 逐字稿 / 爆款复刻 → importDouyinVideo（external-tools/douyin-importer sidecar）
 *   → 本地 MP4 → extractAudioFromVideo（ffmpeg）→ transcribeAudio（豆包语音转写）
 *
 * 爆款复刻的 API 路由负责 replica task 记录，本模块只负责「拿到视频 + 拿到逐字稿」，
 * 两个功能共用同一套底层导入与转写能力。
 */

export type DouyinTranscriptStage =
  | "INVALID_URL"
  | "VIDEO_IMPORT_FAILED"
  | "AUDIO_EXTRACT_FAILED"
  | "ASR_FAILED"
  /** 方舟模型未开通 / Key 失效：重试无用，必须让用户去控制台处理。 */
  | "ASR_ACCOUNT_ISSUE"
  | "NO_SPEECH";

export interface DouyinTranscriptResult {
  transcript: string;
  title: string;
  authorName: string;
  durationSeconds: number;
  hasAudio: boolean;
  videoPath: string;
  videoHash: string;
  sourceUrl: string;
  resolvedUrl: string;
  awemeId: string;
  importedAt: string;
}

export class DouyinTranscriptError extends Error {
  stage: DouyinTranscriptStage;
  /** 真实底层错误，只写日志和接口返回，不直接展示给用户。 */
  detail: string;

  constructor(stage: DouyinTranscriptStage, message: string, detail = "") {
    super(message);
    this.name = "DouyinTranscriptError";
    this.stage = stage;
    this.detail = detail;
  }
}

/** 从纯链接或整段抖音分享文案里提取真正的抖音 URL。 */
export function extractDouyinUrl(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const candidate = extractUrlFromText(raw);
  if (!candidate) return "";
  const normalized = normalizeUrl(candidate);
  if (detectPlatform(normalized) !== "douyin") return "";
  try {
    const parsed = new URL(normalized);
    if (!/^(?:[\w-]+\.)*douyin\.com$|^(?:[\w-]+\.)*iesdouyin\.com$/i.test(parsed.hostname)) return "";
  } catch {
    return "";
  }
  return normalized;
}

/** 去掉只有空白或纯标点的 ASR 结果。 */
export function hasSpeechContent(text: string) {
  return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(text || "");
}

function normalizeTranscript(text: string) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

export async function transcribeDouyinVideo(input: string): Promise<DouyinTranscriptResult> {
  const url = extractDouyinUrl(input);
  if (!url) {
    console.info("[DOUYIN_TRANSCRIPT] URL_EXTRACT FAILED invalid_douyin_url");
    throw new DouyinTranscriptError("INVALID_URL", "未识别到有效抖音链接", "invalid_douyin_url");
  }
  console.info("[DOUYIN_TRANSCRIPT] URL_EXTRACT SUCCESS host=" + safeHost(url));

  let imported: Awaited<ReturnType<typeof importDouyinVideo>>;
  try {
    imported = await importDouyinVideo(url);
  } catch (error) {
    const stage = error instanceof DouyinImportError ? error.stage : "UNKNOWN";
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[DOUYIN_TRANSCRIPT] VIDEO_IMPORT FAILED stage=" + stage + " message=" + message);
    throw new DouyinTranscriptError("VIDEO_IMPORT_FAILED", "视频解析失败，请重试", stage + "：" + message);
  }
  console.info(
    "[DOUYIN_TRANSCRIPT] VIDEO_IMPORT SUCCESS awemeId=" + imported.source.awemeId
    + " duration=" + imported.metadata.duration.toFixed(3)
    + " hasAudio=" + imported.metadata.hasAudio
  );

  const base = {
    title: imported.source.title || "",
    authorName: imported.source.authorName || "",
    durationSeconds: imported.metadata.duration || 0,
    hasAudio: Boolean(imported.metadata.hasAudio),
    videoPath: imported.videoPath,
    videoHash: imported.videoHash,
    sourceUrl: imported.source.sourceUrl || url,
    resolvedUrl: imported.source.resolvedUrl || url,
    awemeId: imported.source.awemeId || "",
    importedAt: imported.source.importedAt
  };

  if (!imported.metadata.hasAudio) {
    console.info("[DOUYIN_TRANSCRIPT] NO_SPEECH video_has_no_audio_track");
    throw new DouyinTranscriptError("NO_SPEECH", "未识别到有效语音", "video_has_no_audio_track");
  }

  const audio = await extractAudioFromVideo(imported.videoPath);
  if (!audio.success) {
    console.error("[DOUYIN_TRANSCRIPT] AUDIO_EXTRACT FAILED message=" + audio.message);
    throw new DouyinTranscriptError("AUDIO_EXTRACT_FAILED", "视频解析失败，请重试", audio.message);
  }
  console.info("[DOUYIN_TRANSCRIPT] AUDIO_EXTRACT SUCCESS");

  const asr = await transcribeAudio(audio.audioPath);
  const transcript = normalizeTranscript(asr.transcript);
  if (!asr.success || !hasSpeechContent(transcript)) {
    const detail = asr.message || "asr_empty";
    console.error("[DOUYIN_TRANSCRIPT] ASR FAILED success=" + asr.success + " code=" + (asr.code || "-") + " message=" + detail);
    // 方舟没开通模型 / Key 失效：重试无用，直接告诉用户去控制台处理。
    if (!asr.success && (asr.code === "MODEL_NOT_OPEN" || asr.code === "AUTH")) {
      throw new DouyinTranscriptError(
        "ASR_ACCOUNT_ISSUE",
        asr.code === "MODEL_NOT_OPEN"
          ? "火山方舟语音转写模型未开通，请到方舟控制台开通后再试"
          : "火山方舟 API Key 无效，请检查配置后再试",
        detail
      );
    }
    if (!asr.success && /没有返回有效逐字稿|未识别|no valid|empty/i.test(detail)) {
      throw new DouyinTranscriptError("NO_SPEECH", "未识别到有效语音", detail);
    }
    throw new DouyinTranscriptError("ASR_FAILED", "语音转写失败，请重试", detail);
  }

  console.info("[DOUYIN_TRANSCRIPT] ASR SUCCESS chars=" + transcript.replace(/\s/g, "").length);
  return { transcript, ...base };
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
