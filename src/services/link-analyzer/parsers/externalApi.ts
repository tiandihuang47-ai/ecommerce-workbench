import { emptyAnalyzeResult, mergeAnalyzeResult } from "@/services/link-analyzer/result";
import type { LinkAnalyzeContext, LinkAnalyzeResult } from "@/services/link-analyzer/types";

export async function tryExternalApiParser(context: LinkAnalyzeContext, parserName: string, baseUrl: string | undefined) {
  const base = emptyAnalyzeResult({
    platform: context.platform,
    url: context.originalInput,
    normalizedUrl: context.normalizedUrl,
    parser: parserName
  });

  if (!baseUrl) {
    return mergeAnalyzeResult(base, {
      error: `${parserName} 未配置外部 API 地址，已跳过。`,
      attempts: [{
        parser: parserName,
        stage: "parse_link",
        success: false,
        message: "未配置外部 API 地址。"
      }]
    });
  }

  try {
    const endpoint = new URL(baseUrl);
    endpoint.searchParams.set("url", context.normalizedUrl);
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30000)
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(extractMessage(payload) || response.statusText);
    }

    return mergeAnalyzeResult(base, {
      title: stringValue(payload.title) || stringValue(payload.desc),
      author: stringValue(payload.author) || stringValue(payload.nickname),
      description: stringValue(payload.description) || stringValue(payload.desc),
      coverUrl: stringValue(payload.cover) || stringValue(payload.coverUrl),
      videoUrl: stringValue(payload.videoUrl) || stringValue(payload.url),
      audioUrl: stringValue(payload.audioUrl),
      duration: payload.duration ? String(payload.duration) : "",
      publishTime: stringValue(payload.publishTime) || stringValue(payload.createTime),
      comments: Array.isArray(payload.comments) ? payload.comments.slice(0, 30).map((item: unknown) => {
        const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return { author: stringValue(record.author), content: stringValue(record.content) || stringValue(record.text) };
      }).filter((item: { content: string }) => item.content) : [],
      rawText: stringValue(payload.text) || stringValue(payload.desc) || stringValue(payload.description),
      status: "success",
      error: "",
      attempts: [{
        parser: parserName,
        stage: "parse_link",
        success: true,
        message: "外部平台 API 解析成功。"
      }],
      structuredJson: { externalApiPayload: payload }
    });
  } catch (error) {
    return mergeAnalyzeResult(base, {
      error: `${parserName} 外部 API 解析失败。`,
      attempts: [{
        parser: parserName,
        stage: "parse_link",
        success: false,
        message: "外部平台 API 解析失败。",
        detail: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 500) : "未知错误"
      }]
    });
  }
}

function extractMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  return stringValue(record.message) || stringValue(record.error) || stringValue(record.msg);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
