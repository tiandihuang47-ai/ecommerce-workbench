/**
 * 爆款复刻的集中配置。
 *
 * 目标视频模型不会出现在用户界面。模型供应商或模型名称变化时，只需要
 * 修改环境变量，不需要在页面、提示词和 API 路由里散落替换字符串。
 * 当前视觉理解走豆包（火山方舟），语音转写走豆包多模态模型的音频输入。
 */
import { resolveRoute } from "@/lib/model-router";

export interface ReplicaConfig {
  targetVideoModel: string;
  promptProfile: string;
  visionModel: string;
  visionBaseUrl: string;
  cacheRoot: string;
  shotBoundaryThreshold: number;
  maxFrames: number;
  batchSize: number;
  maxProductImages: number;
  maxPromptChars: number;
}

export function getReplicaConfig(): ReplicaConfig {
  return {
    targetVideoModel: process.env.REPLICA_TARGET_VIDEO_MODEL || "Seedance 2.5",
    promptProfile: process.env.REPLICA_PROMPT_PROFILE || "timeline-first-reference-fidelity",
    // 视觉理解的模型与连接都来自中央模型路由的 video_understanding Route。
    visionModel: resolveRoute("video_understanding").modelId,
    visionBaseUrl: resolveRoute("video_understanding").provider.baseUrl,
    cacheRoot: process.env.REPLICA_CACHE_DIR || `${process.env.TEMP_FILE_DIR || "/tmp/director-platform"}/replica-cache`,
    shotBoundaryThreshold: clampNumber(process.env.REPLICA_SHOT_THRESHOLD, 0.28, 0.12, 0.65),
    maxFrames: clampNumber(process.env.REPLICA_MAX_FRAMES, 180, 24, 240),
    batchSize: clampNumber(process.env.REPLICA_FRAME_BATCH_SIZE, 10, 4, 16),
    maxProductImages: clampNumber(process.env.REPLICA_MAX_PRODUCT_IMAGES, 8, 1, 8),
    maxPromptChars: clampNumber(process.env.REPLICA_MAX_PROMPT_CHARS, 60000, 16000, 120000)
  };
}

function clampNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function formatTimestamp(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
}

export function parseTimestamp(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parts = trimmed.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return fallback;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
