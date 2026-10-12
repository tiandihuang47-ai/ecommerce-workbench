import type { LinkAnalyzeAttempt } from "@/services/link-analyzer/types";

const crawlerServiceUrl = process.env.CRAWLER_SERVICE_URL || "http://127.0.0.1:8787";
const crawlerServiceTimeout = Number(process.env.CRAWLER_SERVICE_TIMEOUT_MS || 45000);

export interface CrawlerServiceDouyinResult {
  success: boolean;
  platform?: "douyin" | "unknown";
  sourceUrl?: string;
  cleanUrl?: string;
  title?: string;
  author?: string;
  description?: string;
  cover?: string;
  videoUrl?: string;
  downloadUrl?: string;
  rawData?: Record<string, unknown>;
  stage?: string;
  message?: string;
  fallbackRequired?: boolean;
  stderrSummary?: string;
}

export interface CrawlerServiceCommentItem {
  id?: string;
  commentId?: string;
  content: string;
  likeCount?: number;
  authorName?: string;
  createdAt?: string;
  rawData?: Record<string, unknown>;
}

export interface CrawlerServiceCommentsResult {
  success: boolean;
  platform?: string;
  cleanUrl?: string;
  normalizedUrl?: string;
  videoId?: string;
  source?: "crawler-service" | "unsupported";
  strategy?: string;
  comments?: CrawlerServiceCommentItem[];
  stage?: string;
  message?: string;
  fallbackRequired?: boolean;
  needsLogin?: boolean;
  needsCookie?: boolean;
  attempts?: LinkAnalyzeAttempt[];
}

export async function checkCrawlerServiceHealth() {
  try {
    const response = await fetch(`${crawlerServiceUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000)
    });
    const payload = await response.json().catch(() => ({}));
    return {
      success: response.ok && Boolean(payload.success),
      message: String(payload.message || (response.ok ? "crawler-service 可用。" : "crawler-service 不可用。"))
    };
  } catch (error) {
    return {
      success: false,
      message: `crawler-service 未启动或无法连接：${error instanceof Error ? error.message : "未知错误"}`
    };
  }
}

export async function resolveDouyinWithCrawlerService(url: string, options?: { useBrowserCookies?: boolean }) {
  const health = await checkCrawlerServiceHealth();
  const attempts: LinkAnalyzeAttempt[] = [{
    parser: "crawler-service",
    stage: "parse_link",
    success: health.success,
    message: health.message
  }];

  if (!health.success) {
    return { success: false, attempts, message: health.message } satisfies CrawlerServiceDouyinResult & { attempts: LinkAnalyzeAttempt[] };
  }

  try {
    const response = await fetch(`${crawlerServiceUrl}/resolve-douyin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        useBrowserCookies: Boolean(options?.useBrowserCookies)
      }),
      signal: AbortSignal.timeout(crawlerServiceTimeout)
    });
    const payload = await response.json().catch(() => ({})) as CrawlerServiceDouyinResult;
    attempts.push({
      parser: "crawler-service",
      stage: "parse_link",
      success: response.ok && Boolean(payload.success),
      message: payload.message || (payload.success ? "crawler-service 解析成功。" : "crawler-service 解析失败。"),
      detail: payload.stderrSummary
    });
    return { ...payload, success: response.ok && Boolean(payload.success), attempts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "crawler-service 请求失败。";
    attempts.push({
      parser: "crawler-service",
      stage: "parse_link",
      success: false,
      message
    });
    return { success: false, attempts, message } satisfies CrawlerServiceDouyinResult & { attempts: LinkAnalyzeAttempt[] };
  }
}

export async function resolveCommentsWithCrawlerService(params: {
  url: string;
  platform: string;
  limit?: number;
  sortBy?: "likeCount" | "default";
}) {
  const health = await checkCrawlerServiceHealth();
  const attempts: LinkAnalyzeAttempt[] = [{
    parser: "crawler-service",
    stage: "parse_link",
    success: health.success,
    message: health.message
  }];

  if (!health.success) {
    return {
      success: false,
      source: "unsupported",
      comments: [],
      stage: "crawler-service",
      attempts,
      message: health.message,
      fallbackRequired: true
    } satisfies CrawlerServiceCommentsResult;
  }

  try {
    const response = await fetch(`${crawlerServiceUrl}/resolve-comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(crawlerServiceTimeout)
    });
    const payload = await response.json().catch(() => ({})) as CrawlerServiceCommentsResult;
    attempts.push({
      parser: "crawler-service",
      stage: "parse_link",
      success: response.ok && Boolean(payload.success),
      message: payload.message || (payload.success ? "评论抓取成功。" : "评论抓取失败。")
    });
    const serviceAttempts = Array.isArray(payload.attempts) ? payload.attempts : [];
    return {
      ...payload,
      success: response.ok && Boolean(payload.success),
      attempts: [...attempts, ...serviceAttempts]
    } satisfies CrawlerServiceCommentsResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "crawler-service 评论接口请求失败。";
    attempts.push({
      parser: "crawler-service",
      stage: "parse_link",
      success: false,
      message
    });
    return {
      success: false,
      source: "unsupported",
      comments: [],
      stage: "crawler-service",
      attempts,
      message,
      fallbackRequired: true
    } satisfies CrawlerServiceCommentsResult;
  }
}
