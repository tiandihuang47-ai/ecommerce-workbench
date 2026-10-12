import type { LinkAnalyzeAttempt, LinkAnalyzeResult } from "@/services/link-analyzer/types";
import type { VideoPlatform } from "@/lib/video-link-parser";

export function emptyAnalyzeResult(input: {
  platform: VideoPlatform;
  url: string;
  normalizedUrl: string;
  parser: string;
  status?: "success" | "failed";
  error?: string;
  attempts?: LinkAnalyzeAttempt[];
}): LinkAnalyzeResult {
  return {
    platform: input.platform,
    url: input.url,
    normalizedUrl: input.normalizedUrl,
    title: "",
    author: "",
    description: "",
    coverUrl: "",
    videoUrl: "",
    audioUrl: "",
    videoPath: "",
    audioPath: "",
    duration: "",
    publishTime: "",
    comments: [],
    rawText: "",
    transcript: "",
    status: input.status || "failed",
    error: input.error || "",
    parser: input.parser,
    attempts: input.attempts || [],
    structuredJson: {}
  };
}

export function mergeAnalyzeResult(base: LinkAnalyzeResult, patch: Partial<LinkAnalyzeResult>): LinkAnalyzeResult {
  return {
    ...base,
    ...patch,
    comments: patch.comments || base.comments,
    attempts: patch.attempts || base.attempts,
    structuredJson: {
      ...base.structuredJson,
      ...(patch.structuredJson || {})
    }
  };
}

export function resultToStructuredJson(result: LinkAnalyzeResult) {
  return {
    platform: result.platform,
    url: result.url,
    normalizedUrl: result.normalizedUrl,
    title: result.title,
    author: result.author,
    description: result.description,
    coverUrl: result.coverUrl,
    videoUrl: result.videoUrl,
    audioUrl: result.audioUrl,
    duration: result.duration,
    publishTime: result.publishTime,
    comments: result.comments,
    rawText: result.rawText,
    transcript: result.transcript,
    status: result.status,
    error: result.error,
    parser: result.parser
  };
}
