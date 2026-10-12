import { fetchPublicMetadata } from "@/lib/video-link-parser";
import { emptyAnalyzeResult, mergeAnalyzeResult } from "@/services/link-analyzer/result";
import type { LinkAnalyzeContext, LinkParser } from "@/services/link-analyzer/types";

export const genericParser: LinkParser = {
  name: "通用网页解析器",
  platforms: ["douyin", "kuaishou", "xiaohongshu", "bilibili", "youtube", "tiktok", "wechat_channels", "generic", "unknown"],
  async parse(context: LinkAnalyzeContext) {
    const base = emptyAnalyzeResult({
      platform: context.platform,
      url: context.originalInput,
      normalizedUrl: context.normalizedUrl,
      parser: "通用网页解析器"
    });

    const metadata = await fetchPublicMetadata(context.normalizedUrl);
    const hasInfo = Boolean(metadata.title || metadata.description || metadata.cover);

    return mergeAnalyzeResult(base, {
      normalizedUrl: metadata.finalUrl || context.normalizedUrl,
      title: metadata.title,
      author: metadata.author,
      description: metadata.description,
      coverUrl: metadata.cover,
      publishTime: metadata.publishTime,
      rawText: [metadata.title, metadata.description].filter(Boolean).join("\n"),
      status: hasInfo ? "success" : "failed",
      error: hasInfo ? "" : "普通网页解析器没有读取到公开标题、描述或封面。",
      attempts: [{
        parser: "通用网页解析器",
        stage: "parse_link",
        success: hasInfo,
        message: hasInfo ? "已读取公开网页元信息。" : "未读取到有效网页元信息。"
      }]
    });
  }
};
