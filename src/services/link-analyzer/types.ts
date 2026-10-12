import type { VideoPlatform } from "@/lib/video-link-parser";

export type LinkAnalyzeStage =
  | "platform_detect"
  | "parse_link"
  | "video_download"
  | "audio_extract"
  | "asr"
  | "deconstruction"
  | "done";

export type LinkAnalyzeStatus = "success" | "failed";

export interface LinkAnalyzeComment {
  author?: string;
  content: string;
  likeCount?: string;
  publishTime?: string;
}

export interface LinkAnalyzeResult {
  platform: VideoPlatform;
  url: string;
  normalizedUrl: string;
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  videoUrl: string;
  audioUrl: string;
  videoPath: string;
  audioPath: string;
  duration: string;
  publishTime: string;
  comments: LinkAnalyzeComment[];
  rawText: string;
  transcript: string;
  status: LinkAnalyzeStatus;
  error: string;
  parser: string;
  attempts: LinkAnalyzeAttempt[];
  structuredJson: Record<string, unknown>;
}

export interface LinkAnalyzeAttempt {
  parser: string;
  stage: LinkAnalyzeStage;
  success: boolean;
  message: string;
  detail?: string;
}

export interface LinkAnalyzeContext {
  originalInput: string;
  url: string;
  normalizedUrl: string;
  platform: VideoPlatform;
  useBrowserCookies?: boolean;
}

export interface LinkParser {
  name: string;
  platforms: VideoPlatform[];
  parse(context: LinkAnalyzeContext): Promise<LinkAnalyzeResult>;
}

export interface LinkAnalyzeJobInput {
  url: string;
  targetProduct?: string;
  targetAudience?: string;
  rewriteGoal?: string;
  rewriteStyle?: string;
  extraRequirement?: string;
  useBrowserCookies?: boolean;
}

export interface LinkAnalyzeJob {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  createdAt: string;
  updatedAt: string;
  input: LinkAnalyzeJobInput;
  stage: LinkAnalyzeStage;
  progress: Array<{ stage: LinkAnalyzeStage; label: string; status: "pending" | "running" | "done" | "error"; message: string }>;
  result: LinkAnalyzeResult | null;
  deconstructionMarkdown: string;
  rewriteMarkdown: string;
  error: string;
  /** 创建者用户 ID（网页模式下按账号隔离；桌面端没有标记） */
  userId?: string;
}
