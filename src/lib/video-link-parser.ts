export type VideoPlatform =
  | "douyin"
  | "kuaishou"
  | "xiaohongshu"
  | "bilibili"
  | "youtube"
  | "tiktok"
  | "wechat_channels"
  | "generic"
  | "unknown";

export interface ParsedVideoLink {
  success: boolean;
  platform: VideoPlatform;
  url: string;
  normalizedUrl: string;
  title: string;
  description: string;
  author: string;
  cover: string;
  publishTime: string;
  needManualInput: boolean;
  message: string;
}

export function detectPlatform(url: string): VideoPlatform {
  const normalized = normalizeUrl(url);

  try {
    const host = new URL(normalized).hostname.replace(/^www\./, "").toLowerCase();

    if (host.includes("douyin.com") || host.includes("iesdouyin.com")) return "douyin";
    if (host.includes("kuaishou.com")) return "kuaishou";
    if (host.includes("xiaohongshu.com") || host.includes("xhslink.com")) return "xiaohongshu";
    if (host.includes("bilibili.com") || host.includes("b23.tv")) return "bilibili";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("weixin.qq.com") || host.includes("channels.weixin.qq.com")) return "wechat_channels";
    if (/^https?:\/\//i.test(normalized)) return "generic";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function normalizeUrl(url: string) {
  const trimmed = extractUrlFromText(url).trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function extractUrlFromText(value: string) {
  const text = value.trim();
  if (!text) return "";

  const directUrl = text.match(/https?:\/\/[^\s，。；;）)\]}]+/i)?.[0];
  if (directUrl) return cleanSharedUrl(directUrl);

  const domainUrl = text.match(/(?:www\.)?(?:v\.)?(?:douyin\.com|iesdouyin\.com|kuaishou\.com|xiaohongshu\.com|xhslink\.com|bilibili\.com|b23\.tv|youtube\.com|youtu\.be|tiktok\.com|weixin\.qq\.com|channels\.weixin\.qq\.com)\/[^\s，。；;）)\]}]+/i)?.[0];
  if (domainUrl) return cleanSharedUrl(domainUrl);

  if (/\s|[\u4e00-\u9fa5]/.test(text)) return "";
  return cleanSharedUrl(text);
}

export const extractFirstUrl = extractUrlFromText;

function cleanSharedUrl(value: string) {
  return value
    .replace(/[，。；;、,.!?！？）)\]}]+$/g, "")
    .trim();
}

export async function parseVideoLink(url: string): Promise<ParsedVideoLink> {
  const normalizedUrl = normalizeUrl(url);
  const platform = detectPlatform(normalizedUrl);

  if (!normalizedUrl) {
    return buildParserResult({
      success: false,
      platform: "unknown",
      url,
      normalizedUrl,
      message: "没有检测到可解析的视频链接。请复制分享内容里的 http 链接，或改用上传视频。"
    });
  }

  try {
    new URL(normalizedUrl);
  } catch {
    return buildParserResult({
      success: false,
      platform,
      url,
      normalizedUrl,
      message: "链接格式不正确，请检查是否包含完整域名。"
    });
  }

  if (platform === "unknown") {
    return buildParserResult({
      success: false,
      platform,
      url,
      normalizedUrl,
      message: "暂未识别该链接平台，可以继续补充标题、文案或内容描述后手动拆片。"
    });
  }

  const metadata = await fetchPublicMetadata(normalizedUrl);
  const hasPublicInfo = Boolean(metadata.title || metadata.description || metadata.cover);

  return {
    success: hasPublicInfo,
    platform,
    url,
    normalizedUrl: metadata.finalUrl || normalizedUrl,
    title: metadata.title,
    description: metadata.description,
    author: metadata.author,
    cover: metadata.cover,
    publishTime: metadata.publishTime,
    needManualInput: true,
    message: hasPublicInfo
      ? buildManualInputTip(platform)
      : `当前平台链接无法稳定解析完整视频内容，请补充视频标题、文案或截图后继续拆片。${buildManualInputTip(platform)}`
  };
}

export async function fetchPublicMetadata(url: string) {
  const empty = {
    finalUrl: "",
    title: "",
    description: "",
    author: "",
    cover: "",
    publishTime: ""
  };

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DirectorPlatform/1.0; +https://localhost)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return empty;
    }

    const html = await response.text();
    return {
      finalUrl: response.url || url,
      title: cleanMeta(extractMeta(html, ["og:title", "twitter:title"]) || extractTitle(html)),
      description: cleanMeta(extractMeta(html, ["description", "og:description", "twitter:description"])),
      author: cleanMeta(extractMeta(html, ["author", "article:author"])),
      cover: cleanMeta(extractMeta(html, ["og:image", "twitter:image"])),
      publishTime: cleanMeta(extractMeta(html, ["article:published_time", "publish_time", "pubdate"]))
    };
  } catch {
    return empty;
  }
}

export function buildManualInputTip(platform: VideoPlatform) {
  const platformName = platformLabels[platform];
  if (platform === "wechat_channels") {
    return "视频号链接通常无法公开解析完整内容，请补充视频标题、逐字稿、画面描述或截图内容。";
  }
  if (platform === "xiaohongshu") {
    return "小红书可能是图文/视频混合内容，请补充笔记正文、画面描述和高赞评论。";
  }
  if (platform === "bilibili" || platform === "youtube" || platform === "tiktok") {
    return `${platformName}通常可通过 yt-dlp 解析公开视频；如果失败，多半是地区、登录、版权或平台风控限制，请改用上传视频或手动输入。`;
  }
  if (platform === "douyin" || platform === "kuaishou") {
    return `${platformName}短链可能多层跳转或需要动态渲染，请补充视频文案、逐字稿、高赞评论或大概内容。`;
  }
  if (platform === "generic") {
    return "普通网页会优先尝试读取公开网页元信息和 yt-dlp 通用解析，解析不到时请补充文案或上传视频。";
  }
  return "该链接无法稳定解析完整内容，请补充视频标题、文案、逐字稿或截图描述。";
}

export const platformLabels: Record<VideoPlatform, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  xiaohongshu: "小红书",
  bilibili: "B站",
  youtube: "YouTube",
  tiktok: "TikTok",
  wechat_channels: "视频号",
  generic: "普通网页",
  unknown: "未知平台"
};

function buildParserResult(input: Partial<ParsedVideoLink> & Pick<ParsedVideoLink, "success" | "platform" | "url" | "normalizedUrl" | "message">): ParsedVideoLink {
  return {
    title: "",
    description: "",
    author: "",
    cover: "",
    publishTime: "",
    needManualInput: true,
    ...input
  };
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtml(match?.[1] || "");
}

function extractMeta(html: string, names: string[]) {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const propertyPattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
    const contentFirstPattern = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i");
    const match = html.match(propertyPattern) || html.match(contentFirstPattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function cleanMeta(value: string) {
  return decodeHtml(value)
    .replace(/\s+/g, " ")
    .replace(/\|?抖音.*$/i, "")
    .trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
