import type { CommentRecord, SimpleDeconstructionRecord } from "@/lib/pipeline-types";

const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface CommentDebugStep {
  name: string;
  status: "success" | "failed" | "skipped";
  message: string;
}

export function extractFirstUrlFromText(value: string) {
  const text = String(value || "").trim();
  const direct = text.match(/https?:\/\/[^\s，。；;）)\]}]+/i)?.[0] || "";
  return cleanSharedUrl(direct);
}

export function normalizeVideoUrl(value: string) {
  const extracted = extractFirstUrlFromText(value) || String(value || "").trim();
  if (!extracted) return "";
  return /^https?:\/\//i.test(extracted) ? cleanSharedUrl(extracted) : `https://${cleanSharedUrl(extracted)}`;
}

export function detectCommentPlatform(url: string): SimpleDeconstructionRecord["platform"] {
  try {
    const host = new URL(normalizeVideoUrl(url)).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("douyin.com") || host.includes("iesdouyin.com")) return "douyin";
    if (host.includes("kuaishou.com")) return "kuaishou";
    if (host.includes("xiaohongshu.com") || host.includes("xhslink.com")) return "xiaohongshu";
    if (host.includes("weixin.qq.com") || host.includes("channels.weixin.qq.com")) return "wechat_channels";
    if (host.includes("bilibili.com") || host.includes("b23.tv")) return "bilibili";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
    if (host.includes("tiktok.com")) return "tiktok";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function resolveShortVideoUrl(url: string) {
  const normalized = normalizeVideoUrl(url);
  if (!normalized) return { finalUrl: "", message: "没有可跳转的链接。" };

  try {
    const response = await fetch(normalized, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(12000)
    });
    return {
      finalUrl: response.url || normalized,
      message: response.url && response.url !== normalized ? "短链跳转成功。" : "链接无需跳转或未返回新地址。"
    };
  } catch (error) {
    return {
      finalUrl: normalized,
      message: `短链跳转失败，继续使用原链接：${summarizeError(error)}`
    };
  }
}

export function extractDouyinVideoId(url: string) {
  const normalized = normalizeVideoUrl(url);
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    const candidates = [
      parsed.searchParams.get("modal_id"),
      parsed.searchParams.get("aweme_id"),
      parsed.searchParams.get("item_id"),
      parsed.pathname.match(/\/video\/(\d+)/)?.[1],
      parsed.pathname.match(/\/share\/video\/(\d+)/)?.[1],
      parsed.pathname.match(/\/note\/(\d+)/)?.[1],
      parsed.pathname.match(/\/(\d{10,})\/?$/)?.[1]
    ];
    return candidates.find((item) => item && /^\d{10,}$/.test(item)) || "";
  } catch {
    const matched = normalized.match(/(?:video|share\/video|modal_id|aweme_id|item_id)[=/](\d{10,})/);
    return matched?.[1] || "";
  }
}

export function normalizeRawComments(
  rawComments: unknown[],
  options: { platform: SimpleDeconstructionRecord["platform"]; videoUrl: string; limit?: number }
) {
  const now = new Date().toISOString();
  return rawComments
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item, index): CommentRecord => {
      const user = isRecord(item.user) ? item.user : {};
      const cid = stringValue(item.cid) || stringValue(item.comment_id) || stringValue(item.id) || `comment_${index + 1}`;
      return {
        id: cid,
        platform: options.platform,
        videoUrl: options.videoUrl,
        commentId: cid,
        content: stringValue(item.text) || stringValue(item.content) || stringValue(item.comment_text) || stringValue(item.desc) || stringValue(item.comment),
        likeCount: numberValue(item.digg_count ?? item.like_count ?? item.likeCount ?? item.likes ?? item.like_cnt),
        authorName: stringValue(user.nickname) || stringValue(item.nickname) || stringValue(item.authorName) || stringValue(item.author),
        createdAt: timestampValue(item.create_time ?? item.created_at ?? item.createdAt) || now,
        rawData: {
          cid: item.cid,
          comment_id: item.comment_id,
          digg_count: item.digg_count,
          like_count: item.like_count,
          create_time: item.create_time
        }
      };
    })
    .filter((item) => item.content)
    .sort((left, right) => right.likeCount - left.likeCount)
    .slice(0, Math.max(1, Math.min(Number(options.limit || 10), 30)));
}

export async function fetchDouyinPublicComments(params: { videoId: string; refererUrl: string; limit?: number }) {
  const limit = Math.max(1, Math.min(Number(params.limit || 10), 30));
  const endpoints = buildDouyinCommentEndpoints(params.videoId, limit);
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": userAgent,
          Referer: params.refererUrl || `https://www.douyin.com/video/${params.videoId}`,
          Accept: "application/json,text/plain,*/*"
        },
        signal: AbortSignal.timeout(12000)
      });
      const text = await response.text();
      if (!response.ok) {
        errors.push(`${new URL(endpoint).hostname} ${response.status}: ${text.slice(0, 180)}`);
        continue;
      }
      const data = safeJsonParse(text);
      if (!data) {
        errors.push(`${new URL(endpoint).hostname}: 返回不是 JSON`);
        continue;
      }
      const rawComments = extractCommentsArray(data);
      const comments = normalizeRawComments(rawComments, {
        platform: "douyin",
        videoUrl: params.refererUrl,
        limit
      });
      if (comments.length) {
        return {
          success: true,
          comments,
          endpoint,
          rawStatus: Number(isRecord(data) ? data.status_code || data.statusCode || 0 : 0),
          message: `抖音公开评论接口返回 ${comments.length} 条评论。`
        };
      }
      errors.push(`${new URL(endpoint).hostname}: JSON 中没有 comments 数组或评论为空`);
    } catch (error) {
      errors.push(summarizeError(error));
    }
  }

  return {
    success: false,
    comments: [],
    endpoint: "",
    rawStatus: 0,
    message: errors.join("；") || "抖音公开评论接口未返回评论。"
  };
}

export function extractCommentsArray(data: unknown): unknown[] {
  if (!isRecord(data)) return [];
  if (Array.isArray(data.comments)) return data.comments;
  if (Array.isArray(data.comment)) return data.comment;
  if (isRecord(data.data)) {
    if (Array.isArray(data.data.comments)) return data.data.comments;
    if (Array.isArray(data.data.comment)) return data.data.comment;
    if (Array.isArray(data.data.items)) return data.data.items;
  }
  if (Array.isArray(data.items)) return data.items;
  return [];
}

export function summarizeError(error: unknown) {
  if (error instanceof Error) return error.message.replace(/\s+/g, " ").slice(0, 500);
  return String(error || "未知错误").replace(/\s+/g, " ").slice(0, 500);
}

function buildDouyinCommentEndpoints(videoId: string, limit: number) {
  const query = new URLSearchParams({
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    aweme_id: videoId,
    cursor: "0",
    count: String(Math.max(limit, 20)),
    item_type: "0",
    insert_ids: "",
    whale_cut_token: "",
    cut_version: "1",
    rcFT: "",
    pc_client_type: "1",
    version_code: "170400",
    version_name: "17.4.0",
    cookie_enabled: "true",
    screen_width: "1440",
    screen_height: "900",
    browser_language: "zh-CN",
    browser_platform: "MacIntel",
    browser_name: "Chrome",
    browser_version: "125.0.0.0",
    browser_online: "true",
    engine_name: "Blink",
    os_name: "Mac OS",
    os_version: "10.15.7",
    platform: "PC"
  });
  return [
    `https://www.douyin.com/aweme/v1/web/comment/list/?${query.toString()}`,
    `https://www.iesdouyin.com/web/api/v2/aweme/comment/?aweme_id=${encodeURIComponent(videoId)}&cursor=0&count=${Math.max(limit, 20)}`
  ];
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanSharedUrl(value: string) {
  return String(value || "").replace(/[，。；;、,.!?！？）)\]}]+$/g, "").trim();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const matched = value.trim().match(/^(\d+(?:\.\d+)?)(万|w|W|k|K)?/);
    if (!matched) return 0;
    const base = Number(matched[1] || 0);
    const unit = matched[2] || "";
    return Math.round(base * (/万|w/i.test(unit) ? 10000 : /k/i.test(unit) ? 1000 : 1));
  }
  return 0;
}

function timestampValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 100000000000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return stringValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
