import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";

loadLocalEnv();

const execFileAsync = promisify(execFile);
const port = Number(process.env.CRAWLER_SERVICE_PORT || 8787);
const timeout = Number(process.env.CRAWLER_SERVICE_TIMEOUT_MS || 45000);

const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const server = createServer(async (request, response) => {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      success: true,
      message: "crawler-service running",
      features: {
        douyinComments: true,
        douyinCommentsDefaultMode: "public_api_and_yt_dlp",
        douyinCommentsCookieMode: Boolean(process.env.DOUYIN_COOKIE || process.env.DOUYIN_COMMENT_COOKIE)
      }
    });
    return;
  }

  if (request.method === "POST" && request.url === "/resolve-douyin") {
    try {
      const body = await readJson(request);
      const sourceUrl = stringValue(body.url);
      const useBrowserCookies = Boolean(body.useBrowserCookies);
      const result = await resolveDouyin(sourceUrl, { useBrowserCookies });
      sendJson(response, result.success ? 200 : 422, result);
    } catch (error) {
      sendJson(response, 500, {
        success: false,
        stage: "service",
        message: error instanceof Error ? error.message : "crawler-service 处理异常。",
        fallbackRequired: true
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/resolve-comments") {
    try {
      const body = await readJson(request);
      const result = await resolveComments({
        url: stringValue(body.url),
        platform: stringValue(body.platform),
        limit: Number(body.limit || 10),
        sortBy: stringValue(body.sortBy) || "likeCount",
        useBrowserSession: Boolean(body.useBrowserSession),
        // 评论专供：允许调用方（脚本模块）传入条数上限、每页大小、是否抓回复，
        // 以及从 App cookie jar 生成的 Cookie 头（避免依赖服务启动时的环境变量）。
        maxComments: Number(body.maxComments || 0) || undefined,
        pageSize: Number(body.pageSize || 0) || undefined,
        includeReplies: Boolean(body.includeReplies),
        cookie: stringValue(body.cookie)
      });
      sendJson(response, result.success ? 200 : 422, result);
    } catch (error) {
      sendJson(response, 500, {
        success: false,
        stage: "comments",
        message: error instanceof Error ? error.message : "评论抓取服务异常。",
        comments: [],
        needsLogin: false,
        needsCookie: false,
        fallbackRequired: true
      });
    }
    return;
  }

  sendJson(response, 404, { success: false, message: "接口不存在。" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`crawler-service running at http://127.0.0.1:${port}`);
});

function loadLocalEnv() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function resolveDouyin(input, options) {
  const cleanUrl = extractFirstUrl(input);
  if (!cleanUrl) {
    return failure("input", "没有从输入内容中提取到抖音链接。请粘贴 https://v.douyin.com/... 或 https://www.douyin.com/video/...。", input, "");
  }

  if (!isDouyinUrl(cleanUrl)) {
    return failure("platform", "该链接不是抖音链接，请确认域名包含 douyin.com 或 iesdouyin.com。", input, cleanUrl);
  }

  const args = [
    "--dump-json",
    "--no-playlist",
    "--user-agent",
    userAgent,
    "--referer",
    "https://www.douyin.com/",
    cleanUrl
  ];

  if (options.useBrowserCookies) {
    const browser = stringValue(process.env.YTDLP_COOKIES_FROM_BROWSER) || "chrome";
    const profile = stringValue(process.env.YTDLP_CHROME_PROFILE);
    args.unshift(profile ? `${browser}:${profile}` : browser);
    args.unshift("--cookies-from-browser");
  }

  if (!options.useBrowserCookies && process.env.YTDLP_COOKIES_FILE) {
    args.unshift(process.env.YTDLP_COOKIES_FILE);
    args.unshift("--cookies");
  }

  try {
    const { stdout, stderr } = await execFileAsync("yt-dlp", args, {
      timeout,
      maxBuffer: 1024 * 1024 * 24
    });
    const rawData = JSON.parse(stdout);
    const videoUrl = stringValue(rawData.url) || firstFormatUrl(rawData.formats);
    return {
      success: true,
      platform: "douyin",
      sourceUrl: input,
      cleanUrl,
      title: stringValue(rawData.title),
      author: stringValue(rawData.uploader) || stringValue(rawData.channel) || stringValue(rawData.creator),
      description: stringValue(rawData.description),
      cover: stringValue(rawData.thumbnail),
      videoUrl,
      downloadUrl: videoUrl,
      rawData: trimRawData(rawData),
      stderrSummary: summarize(stderr)
    };
  } catch (error) {
    return failure(
      "resolve",
      `抖音链接解析失败：${summarizeProcessError(error)}。请改用上传视频模式，或在高级模式中手动启用浏览器登录态解析。`,
      input,
      cleanUrl
    );
  }
}

async function resolveComments({ url, platform, limit, sortBy, maxComments, pageSize, includeReplies, cookie }) {
  const commentOptions = { maxComments, pageSize, includeReplies, cookie };
  const cleanUrl = extractFirstUrl(url);
  if (!cleanUrl) {
    return {
      success: false,
      platform: platform || "unknown",
      source: "unsupported",
      comments: [],
      stage: "input",
      message: "没有从输入内容中提取到可用链接。",
      needsLogin: false,
      needsCookie: false,
      fallbackRequired: true
    };
  }

  const redirected = await resolveRedirectUrl(cleanUrl);
  const normalizedUrl = redirected.finalUrl || cleanUrl;
  const detectedPlatform = platform && platform !== "unknown"
    ? platform
    : detectPlatform(normalizedUrl);
  const videoId = detectedPlatform === "douyin" ? extractDouyinVideoId(normalizedUrl) || extractDouyinVideoId(cleanUrl) : "";
  const attempts = [];

  if (detectedPlatform === "douyin" && videoId) {
    const authorized = await fetchDouyinSignedComments({
      videoId,
      refererUrl: normalizedUrl,
      limit,
      sortBy,
      ...commentOptions
    });
    attempts.push({
      strategy: "DouyinComments 授权 Cookie 签名接口",
      success: authorized.success,
      message: authorized.message
    });
    if (authorized.success) {
      return {
        success: true,
        platform: "douyin",
        cleanUrl,
        normalizedUrl,
        videoId,
        source: "DouyinComments",
        strategy: "douyin-signed-comment-api",
        comments: authorized.comments,
        message: authorized.message,
        attempts
      };
    }

    const direct = await fetchDouyinPublicComments({
      videoId,
      refererUrl: normalizedUrl,
      limit,
      sortBy
    });
    attempts.push({
      strategy: "抖音公开评论接口",
      success: direct.success,
      message: direct.message
    });
    if (direct.success) {
      return {
        success: true,
        platform: "douyin",
        cleanUrl,
        normalizedUrl,
        videoId,
        source: "crawler-service",
        strategy: "douyin-public-comment-api",
        comments: direct.comments,
        message: direct.message,
        attempts
      };
    }
  }

  const args = [
    "--dump-json",
    "--no-playlist",
    "--write-comments",
    "--no-update",
    "--user-agent",
    userAgent,
    normalizedUrl
  ];

  try {
    const { stdout, stderr } = await execFileAsync("yt-dlp", args, {
      timeout,
      maxBuffer: 1024 * 1024 * 48
    });
    const rawData = JSON.parse(stdout);
    const rawComments = Array.isArray(rawData.comments) ? rawData.comments : Array.isArray(rawData.comment) ? rawData.comment : [];
    const comments = normalizeComments(rawComments, limit, sortBy);

    if (!comments.length) {
      attempts.push({
        strategy: "yt-dlp comments",
        success: false,
        message: summarize(stderr) || "yt-dlp 未返回 comments 字段。"
      });
      return {
        success: false,
        platform: detectedPlatform,
        cleanUrl,
        normalizedUrl,
        videoId,
        source: "unsupported",
        comments: [],
        stage: "comments",
        message: `当前平台未返回公开评论数据。${attempts.map((item) => `${item.strategy}：${item.message}`).join("；")}。可手动粘贴评论继续分析。`,
        needsLogin: detectedPlatform === "douyin",
        needsCookie: detectedPlatform === "douyin",
        fallbackRequired: true,
        attempts
      };
    }
    attempts.push({
      strategy: "yt-dlp comments",
      success: true,
      message: `yt-dlp 返回 ${comments.length} 条评论。`
    });

    return {
      success: true,
      platform: detectedPlatform,
      cleanUrl,
      normalizedUrl,
      videoId,
      source: "crawler-service",
      strategy: "yt-dlp-comments",
      comments,
      message: `已获取 ${comments.length} 条评论。`,
      attempts
    };
  } catch (error) {
    attempts.push({
      strategy: "yt-dlp comments",
      success: false,
      message: summarizeProcessError(error)
    });
    return {
      success: false,
      platform: detectedPlatform,
      cleanUrl,
      normalizedUrl,
      videoId,
      source: "unsupported",
      comments: [],
      stage: "comments",
      message: `评论抓取失败：${attempts.map((item) => `${item.strategy}：${item.message}`).join("；")}。${videoId ? "已提取视频 ID，但自动策略未返回评论。" : "未提取到视频 ID。"}可手动粘贴评论继续分析。`,
      needsLogin: detectedPlatform === "douyin",
      needsCookie: detectedPlatform === "douyin",
      fallbackRequired: true,
      attempts
    };
  }
}

function failure(stage, message, sourceUrl, cleanUrl) {
  return {
    success: false,
    stage,
    message,
    fallbackRequired: true,
    platform: cleanUrl ? "douyin" : "unknown",
    sourceUrl,
    cleanUrl
  };
}

function extractFirstUrl(value) {
  const text = stringValue(value);
  const direct = text.match(/https?:\/\/[^\s，。；;）)\]}]+/i)?.[0] || "";
  return cleanSharedUrl(direct);
}

function cleanSharedUrl(value) {
  return stringValue(value).replace(/[，。；;、,.!?！？）)\]}]+$/g, "");
}

function isDouyinUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    return host.includes("douyin.com") || host.includes("iesdouyin.com");
  } catch {
    return false;
  }
}

async function resolveRedirectUrl(value) {
  const cleanUrl = extractFirstUrl(value) || cleanSharedUrl(value);
  if (!cleanUrl) return { finalUrl: "", message: "没有可跳转链接。" };
  try {
    const response = await fetch(cleanUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(12000)
    });
    return {
      finalUrl: response.url || cleanUrl,
      message: response.url && response.url !== cleanUrl ? "短链跳转成功。" : "链接无需跳转或未返回新地址。"
    };
  } catch (error) {
    return {
      finalUrl: cleanUrl,
      message: `短链跳转失败，继续使用原链接：${summarizeProcessError(error)}`
    };
  }
}

function extractDouyinVideoId(value) {
  const cleanUrl = extractFirstUrl(value) || cleanSharedUrl(value);
  if (!cleanUrl) return "";
  try {
    const parsed = new URL(cleanUrl);
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
    const matched = cleanUrl.match(/(?:video|share\/video|modal_id|aweme_id|item_id)[=/](\d{10,})/);
    return matched?.[1] || "";
  }
}

async function fetchDouyinPublicComments({ videoId, refererUrl, limit, sortBy }) {
  const endpoints = buildDouyinCommentEndpoints(videoId, limit);
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": userAgent,
          Referer: refererUrl || `https://www.douyin.com/video/${videoId}`,
          Accept: "application/json,text/plain,*/*"
        },
        signal: AbortSignal.timeout(12000)
      });
      const text = await response.text();
      if (!response.ok) {
        errors.push(`${new URL(endpoint).hostname} ${response.status}: ${summarize(text)}`);
        continue;
      }
      const data = JSON.parse(text);
      const comments = normalizeComments(extractCommentsArray(data), limit, sortBy);
      if (comments.length) {
        return {
          success: true,
          comments,
          message: `抖音公开评论接口返回 ${comments.length} 条评论。`
        };
      }
      errors.push(`${new URL(endpoint).hostname}: 未返回 comments 数组或评论为空，响应摘要：${summarize(text) || "空响应"}`);
    } catch (error) {
      errors.push(summarizeProcessError(error));
    }
  }
  return {
    success: false,
    comments: [],
    message: errors.join("；") || "抖音公开评论接口未返回评论。"
  };
}

/**
 * 授权 Cookie + a_bogus 签名的主评论接口，支持**分页抓取**。
 *
 * 上游（jiji262/douyin-downloader 与 DouyinComments）本身是单页 count 抓取；
 * 这里按 cursor / has_more 循环，直到达到 maxComments 或没有更多，
 * 以便脚本模块一次拿到 ~200 条主评论（§十一：第一阶段不做无限抓取）。
 *
 * 回复（includeReplies）默认关闭（§十四）：只对点赞最高的少量主评论抓一页回复。
 */
async function fetchDouyinSignedComments({ videoId, refererUrl, limit, sortBy, maxComments, pageSize, includeReplies, cookie: cookieOverride }) {
  const cookie = stringValue(cookieOverride) || stringValue(process.env.DOUYIN_COOKIE || process.env.DOUYIN_COMMENT_COOKIE);
  if (!cookie) {
    return {
      success: false,
      comments: [],
      message: "缺少抖音 Cookie：请在请求里传 cookie（App 的 DOUYIN_COOKIE_JAR）或配置 DOUYIN_COOKIE。"
    };
  }

  const signer = getDouyinSigner();
  if (!signer) {
    return {
      success: false,
      comments: [],
      message: "未找到 DouyinComments 签名脚本，跳过授权 Cookie 评论接口。"
    };
  }

  const endpoint = "https://www.douyin.com/aweme/v1/web/comment/list/";
  const target = Math.max(1, Math.min(Number(maxComments || limit || 20) || 20, 1000));
  const perPage = Math.max(20, Math.min(Number(pageSize || 20) || 20, 50));
  const maxPages = Math.max(1, Math.min(Number(process.env.DOUYIN_COMMENT_MAX_PAGES || 12) || 12, 40));
  const webid = await fetchDouyinWebId(cookie).catch(() => "");

  const collected = [];
  const seen = new Set();
  const errors = [];
  let cursor = "0";
  let hasMore = true;
  let pages = 0;
  let reportedTotal = 0;

  while (hasMore && collected.length < target && pages < maxPages) {
    const params = buildSignedDouyinCommentParams(videoId, perPage, cookie);
    params.cursor = cursor;
    params.count = String(perPage);
    if (webid) params.webid = webid;

    const query = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join("&");
    params.a_bogus = signer.signDetail(query, signedDouyinUserAgent);
    const signedUrl = `${endpoint}?${new URLSearchParams(params).toString()}`;

    try {
      const response = await fetch(signedUrl, {
        headers: buildDouyinCommentHeaders(cookie, refererUrl, videoId),
        signal: AbortSignal.timeout(15000)
      });
      const text = await response.text();
      if (!response.ok) {
        errors.push(`HTTP ${response.status}: ${summarize(text)}`);
        break;
      }

      const data = JSON.parse(text);
      reportedTotal = Number(data.total || reportedTotal) || reportedTotal;
      const batch = extractCommentsArray(data);
      if (!batch.length) {
        hasMore = false;
        break;
      }
      for (const item of batch) {
        const cid = stringValue(item.cid) || stringValue(item.comment_id) || stringValue(item.id);
        if (cid && seen.has(cid)) continue;
        if (cid) seen.add(cid);
        collected.push(item);
      }

      const nextCursor = data.cursor !== undefined && data.cursor !== null ? String(data.cursor) : String(Number(cursor) + batch.length);
      hasMore = Boolean(data.has_more) && nextCursor !== cursor;
      cursor = nextCursor;
      pages += 1;
    } catch (error) {
      errors.push(summarizeProcessError(error));
      break;
    }
  }

  if (!collected.length) {
    return {
      success: false,
      comments: [],
      message: `DouyinComments 授权接口未返回评论：${errors.join("；") || "空响应"}`
    };
  }

  const comments = normalizeComments(collected, target, sortBy);
  let replyComments = [];
  if (includeReplies) {
    replyComments = await fetchDouyinSignedReplies({
      videoId,
      refererUrl,
      cookie,
      signer,
      webid,
      parents: comments.slice(0, 5),
      perParent: Math.max(10, Math.min(Number(process.env.DOUYIN_COMMENT_REPLY_PAGE_SIZE || 20) || 20, 30))
    }).catch(() => []);
  }

  return {
    success: true,
    comments: comments.concat(replyComments),
    hasMore: hasMore || collected.length < reportedTotal,
    pages,
    reportedTotal,
    message: `DouyinComments 授权接口返回 ${comments.length} 条主评论${replyComments.length ? `、${replyComments.length} 条回复` : ""}（${pages} 页${hasMore ? "，还有更多" : ""}）。`
      + (errors.length ? ` 部分页失败：${errors.join("；")}` : "")
  };
}

function buildDouyinCommentHeaders(cookie, refererUrl, videoId) {
  return {
    "User-Agent": signedDouyinUserAgent,
    "Referer": refererUrl || `https://www.douyin.com/video/${videoId}`,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cookie": cookie,
    "DNT": "1",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
  };
}

/** 回复抓取：只对少量高赞主评论抓一页，默认不开启（§十四）。 */
async function fetchDouyinSignedReplies({ videoId, refererUrl, cookie, signer, webid, parents, perParent }) {
  const endpoint = "https://www.douyin.com/aweme/v1/web/comment/list/reply/";
  const results = [];
  for (const parent of parents) {
    const commentId = stringValue(parent.commentId) || stringValue(parent.rawData?.cid);
    if (!commentId) continue;
    try {
      const params = buildSignedDouyinCommentParams(videoId, perParent, cookie);
      delete params.aweme_id;
      params.item_id = videoId;
      params.comment_id = commentId;
      params.cursor = "0";
      params.count = String(perParent);
      if (webid) params.webid = webid;
      const query = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join("&");
      params.a_bogus = signer.signDetail(query, signedDouyinUserAgent);
      const response = await fetch(`${endpoint}?${new URLSearchParams(params).toString()}`, {
        headers: buildDouyinCommentHeaders(cookie, refererUrl, videoId),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) continue;
      const data = JSON.parse(await response.text());
      const batch = extractCommentsArray(data);
      for (const item of batch) {
        results.push({ ...item, __parentCommentId: commentId });
      }
    } catch {
      /* 单条父评论失败不影响主评论结果 */
    }
  }
  return normalizeComments(results, results.length || 1, "default").map((item) => ({
    ...item,
    isReply: true,
    parentCommentId: stringValue(item.rawData?.parentCommentId) || ""
  }));
}

const signedDouyinUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

let douyinSignerCache = undefined;

function getDouyinSigner() {
  if (douyinSignerCache !== undefined) return douyinSignerCache;

  const scriptPath = join(process.cwd(), "external-tools", "DouyinComments", "douyin.js");
  if (!existsSync(scriptPath)) {
    douyinSignerCache = null;
    return douyinSignerCache;
  }

  try {
    const source = readFileSync(scriptPath, "utf8");
    const sandbox = {
      Math,
      console: { log() {}, warn() {}, error() {} }
    };
    vm.createContext(sandbox);
    vm.runInContext(`${source}\nthis.__signDetail = sign_datail;\nthis.__signReply = sign_reply;`, sandbox, {
      timeout: 5000,
      filename: "DouyinComments/douyin.js"
    });
    douyinSignerCache = {
      signDetail(query, ua) {
        return sandbox.__signDetail(query, ua);
      },
      signReply(query, ua) {
        return sandbox.__signReply(query, ua);
      }
    };
    return douyinSignerCache;
  } catch {
    douyinSignerCache = null;
    return douyinSignerCache;
  }
}

function buildSignedDouyinCommentParams(videoId, limit, cookie) {
  const cookieMap = parseCookieHeader(cookie);
  return {
    aweme_id: videoId,
    cursor: "0",
    count: String(Math.max(Number(limit || 10), 20)),
    item_type: "0",
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    update_version_code: "170400",
    pc_client_type: "1",
    version_code: "190500",
    version_name: "19.5.0",
    cookie_enabled: "true",
    screen_width: cookieMap.dy_swidth || "2560",
    screen_height: cookieMap.dy_sheight || "1440",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Chrome",
    browser_version: "126.0.0.0",
    browser_online: "true",
    engine_name: "Blink",
    engine_version: "126.0.0.0",
    os_name: "Windows",
    os_version: "10",
    cpu_core_num: cookieMap.device_web_cpu_core || "24",
    device_memory: cookieMap.device_web_memory_size || "8",
    platform: "PC",
    downlink: "10",
    effective_type: "4g",
    round_trip_time: "50",
    msToken: randomMsToken(),
    verifyFp: cookieMap.s_v_web_id || "",
    fp: cookieMap.s_v_web_id || ""
  };
}

async function fetchDouyinWebId(cookie) {
  const response = await fetch("https://www.douyin.com/?recommend=1", {
    headers: {
      "User-Agent": signedDouyinUserAgent,
      "Cookie": cookie,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Sec-Fetch-Dest": "document"
    },
    signal: AbortSignal.timeout(12000)
  });
  const html = await response.text();
  return html.match(/\\"user_unique_id\\":\\"(\d+)\\"/)?.[1] || html.match(/"user_unique_id":"(\d+)"/)?.[1] || "";
}

function parseCookieHeader(cookie) {
  return Object.fromEntries(
    stringValue(cookie)
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        if (index === -1) return [item, ""];
        return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
      })
  );
}

function randomMsToken(length = 120) {
  const chars = "ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

function buildDouyinCommentEndpoints(videoId, limit) {
  const query = new URLSearchParams({
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    aweme_id: videoId,
    cursor: "0",
    count: String(Math.max(Number(limit || 10), 20)),
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
    `https://www.iesdouyin.com/web/api/v2/aweme/comment/?aweme_id=${encodeURIComponent(videoId)}&cursor=0&count=${Math.max(Number(limit || 10), 20)}`
  ];
}

function extractCommentsArray(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.comments)) return data.comments;
  if (Array.isArray(data.comment)) return data.comment;
  if (data.data && typeof data.data === "object") {
    if (Array.isArray(data.data.comments)) return data.data.comments;
    if (Array.isArray(data.data.comment)) return data.data.comment;
    if (Array.isArray(data.data.items)) return data.data.items;
  }
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function detectPlatform(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
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

function normalizeComments(rawComments, limit, sortBy) {
  const items = rawComments
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: stringValue(item.id) || stringValue(item.comment_id) || `comment_${index + 1}`,
      commentId: stringValue(item.cid) || stringValue(item.id) || stringValue(item.comment_id) || `comment_${index + 1}`,
      content: stringValue(item.text) || stringValue(item.content) || stringValue(item.comment_text) || stringValue(item.desc) || stringValue(item.comment),
      likeCount: numberValue(item.digg_count ?? item.like_count ?? item.likeCount ?? item.likes ?? item.like_cnt),
      authorName: stringValue(item.user?.nickname) || stringValue(item.nickname) || stringValue(item.author) || stringValue(item.author_name) || stringValue(item.uploader),
      replyCount: numberValue(item.reply_comment_total ?? item.reply_count ?? item.replyCount),
      authorUserId: stringValue(item.user?.uid) || stringValue(item.user?.user_id) || "",
      authorSecUid: stringValue(item.user?.sec_uid) || "",
      authorAvatar: firstFormatUrl(item.user?.avatar_thumb?.url_list) || firstFormatUrl(item.user?.avatar_168x168?.url_list) || "",
      ipLocation: stringValue(item.ip_label) || "",
      isReply: Boolean(item.__parentCommentId),
      parentCommentId: stringValue(item.__parentCommentId) || "",
      createdAt: timestampValue(item.create_time ?? item.timestamp ?? item.created_at) || "",
      rawData: {
        cid: item.cid,
        id: item.id,
        comment_id: item.comment_id,
        digg_count: item.digg_count,
        like_count: item.like_count,
        create_time: item.create_time,
        reply_comment_total: item.reply_comment_total,
        ip_label: item.ip_label,
        parentCommentId: item.__parentCommentId
      }
    }))
    .filter((item) => item.content);

  const sorted = sortBy === "likeCount"
    ? items.sort((left, right) => (right.likeCount || 0) - (left.likeCount || 0))
    : items;
  // 评论模块一次可能要 200 条主评论，这里放宽上限（旧值 30 会把分页成果截断）。
  return sorted.slice(0, Math.max(1, Math.min(Number(limit || 10), 500)));
}

function timestampValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 100000000000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return stringValue(value);
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const matched = value.match(/\d+(\.\d+)?/);
    return matched ? Number(matched[0]) : 0;
  }
  return 0;
}

function firstFormatUrl(formats) {
  if (!Array.isArray(formats)) return "";
  const preferred = [...formats].reverse().find((item) => item && typeof item === "object" && typeof item.url === "string");
  return preferred?.url || "";
}

function trimRawData(rawData) {
  return {
    id: rawData.id,
    webpage_url: rawData.webpage_url,
    original_url: rawData.original_url,
    extractor: rawData.extractor,
    duration: rawData.duration,
    like_count: rawData.like_count,
    comment_count: rawData.comment_count,
    repost_count: rawData.repost_count,
    save_count: rawData.save_count,
    format_id: rawData.format_id
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求体过大。"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("请求体必须是合法 JSON。"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:3010");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function summarize(value) {
  const text = stringValue(value).replace(/\s+/g, " ");
  return text.length > 700 ? `${text.slice(0, 260)} ... ${text.slice(-360)}` : text;
}

function summarizeProcessError(error) {
  if (!error || typeof error !== "object") return "命令执行失败";
  const record = error;
  return summarize(record.stderr || record.stdout || record.message || "命令执行失败");
}
