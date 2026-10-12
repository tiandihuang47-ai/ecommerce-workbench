import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeDouyinComments, douyinCommentConfig, type CommentRecord } from "@/lib/douyin-comments";

/**
 * DouyinCommentAdapter：脚本模块拿抖音评论的**唯一入口**。
 *
 * 设计约束（见 docs/DOUYIN_COMMENT_INTEGRATION.md）：
 * 1. 不重写抖音评论采集：复用现有 crawler-service（其内部用 DouyinComments 的 a_bogus 签名 +
 *    抖音 web 评论接口，并保留 yt-dlp 兜底），本文件只做「调服务 + 归一化」。
 * 2. 不新建 cookie 体系：直接用桌面 App 已经注入的 `DOUYIN_COOKIE_JAR`（与爆款复刻/逐字稿同源），
 *    把 Netscape 格式转成 Cookie 头按请求传给服务，避免服务端再存一份登录态。
 * 3. 服务不在时按需拉起（仅本机 URL），Web 部署时通过 CRAWLER_SERVICE_URL 指向独立服务，不 spawn。
 * 4. 失败只返回失败，不抛异常到上层：评论失败绝不影响逐字稿链路。
 */

export interface FetchDouyinCommentsInput {
  url?: string;
  awemeId?: string;
  maxComments?: number;
  includeReplies?: boolean;
  /** 跳过缓存提示（服务端本身无状态，缓存由调用方/脚本工作区控制）。 */
  refresh?: boolean;
}

export interface FetchDouyinCommentsResult {
  success: boolean;
  awemeId: string;
  comments: CommentRecord[];
  totalFetched: number;
  totalReported: number;
  hasMore: boolean;
  fetchedAt: string;
  source: string;
  strategy: string;
  error?: string;
  message: string;
}

const serviceUrl = (process.env.CRAWLER_SERVICE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const servicePort = Number(process.env.CRAWLER_SERVICE_PORT || 8787);
const isLocalService = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(serviceUrl);

/** 桌面 App 注入的抖音 cookie jar（与视频导入同源，不再单独登录）。 */
export function douyinCookieJarPath() {
  return process.env.DOUYIN_COOKIE_JAR || "";
}

/** Netscape cookie jar → Cookie 请求头。只取抖音域字段，不打印、不外传。 */
export async function readDouyinCookieHeader(): Promise<string> {
  const jarPath = douyinCookieJarPath();
  if (!jarPath) return "";
  try {
    const raw = await readFile(jarPath, "utf8");
    const pairs: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const parts = line.split("\t");
      if (parts.length < 7) continue;
      const [domain, , , , , name, value] = parts;
      if (!/douyin/i.test(domain) || !name) continue;
      pairs.push(`${name}=${value}`);
    }
    return pairs.join("; ");
  } catch (error) {
    console.warn("[DOUYIN_COMMENTS] 读取 cookie jar 失败：" + (error instanceof Error ? error.message : "unknown"));
    return "";
  }
}

type SpawnState = { child: { kill: (signal?: NodeJS.Signals) => boolean } | null; starting: Promise<boolean> | null };
const globalSpawnState = globalThis as unknown as { __directorCrawlerService?: SpawnState };
function spawnState(): SpawnState {
  if (!globalSpawnState.__directorCrawlerService) {
    globalSpawnState.__directorCrawlerService = { child: null, starting: null };
  }
  return globalSpawnState.__directorCrawlerService;
}

async function serviceHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({})) as { success?: boolean };
    return Boolean(payload.success);
  } catch {
    return false;
  }
}

/** 需要时拉起本地 crawler-service（单例，进程内复用）。 */
async function ensureCrawlerService(cookie: string): Promise<boolean> {
  if (await serviceHealthy()) return true;
  if (!isLocalService) {
    console.warn("[DOUYIN_COMMENTS] crawler-service 不可达（非本机地址，不自动启动）：" + serviceUrl);
    return false;
  }
  const state = spawnState();
  if (state.starting) return state.starting;

  state.starting = (async () => {
    try {
      const entry = path.join(process.cwd(), "crawler-service", "server.mjs");
      const child = spawn(process.execPath, [entry], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CRAWLER_SERVICE_PORT: String(servicePort),
          ...(cookie ? { DOUYIN_COOKIE: cookie } : {})
        },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true
      });
      state.child = child;
      child.stderr?.on("data", (chunk: Buffer) => {
        const line = chunk.toString().split(/\r?\n/).find(Boolean);
        if (line) console.info("[CRAWLER_SERVICE] " + line.replace(/([?&](?:cookie|token|sign)=)[^&\s]+/gi, "$1<redacted>"));
      });
      child.on("exit", () => { state.child = null; });

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (await serviceHealthy()) {
          console.info("[DOUYIN_COMMENTS] crawler-service 已就绪：" + serviceUrl);
          return true;
        }
      }
      console.warn("[DOUYIN_COMMENTS] crawler-service 启动超时。");
      return false;
    } catch (error) {
      console.warn("[DOUYIN_COMMENTS] crawler-service 启动失败：" + (error instanceof Error ? error.message : "unknown"));
      return false;
    } finally {
      state.starting = null;
    }
  })();

  return state.starting;
}

/**
 * 拉取一条抖音作品的评论。
 * 输入可以是链接或整段分享文案；也可以直接给 awemeId。
 */
export async function fetchDouyinComments(input: FetchDouyinCommentsInput): Promise<FetchDouyinCommentsResult> {
  const fetchedAt = new Date().toISOString();
  const maxComments = Math.max(1, Math.min(Number(input.maxComments || douyinCommentConfig.defaultMaxComments), 1000));
  const includeReplies = input.includeReplies ?? douyinCommentConfig.includeReplies;
  const empty = (message: string, error = ""): FetchDouyinCommentsResult => ({
    success: false,
    awemeId: input.awemeId || "",
    comments: [],
    totalFetched: 0,
    totalReported: 0,
    hasMore: false,
    fetchedAt,
    source: "crawler-service",
    strategy: "",
    error: error || message,
    message
  });

  const url = String(input.url || "").trim();
  const awemeId = String(input.awemeId || "").trim();
  if (!url && !awemeId) return empty("缺少抖音链接或作品 ID，无法获取评论。");
  if (!douyinCommentConfig.enabled) return empty("评论采集已被配置关闭（DOUYIN_COMMENTS_ENABLED=0）。");

  const cookie = await readDouyinCookieHeader();
  if (!cookie) {
    // 不是致命错误：公开接口可能仍可用，但抖音通常需要 ttwid 等字段。
    console.warn("[DOUYIN_COMMENTS] 未拿到 cookie jar（DOUYIN_COOKIE_JAR 未配置或文件不可读），尝试匿名请求。");
  }

  if (!(await ensureCrawlerService(cookie))) {
    return empty("评论服务未启动，暂时无法获取评论。", "crawler-service 不可达");
  }

  const attempts = Math.max(1, douyinCommentConfig.maxRetries + 1);
  let lastError = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${serviceUrl}/resolve-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url || `https://www.douyin.com/video/${awemeId}`,
          platform: "douyin",
          maxComments,
          pageSize: douyinCommentConfig.pageSize,
          includeReplies,
          sortBy: "likeCount",
          ...(cookie ? { cookie } : {})
        }),
        signal: AbortSignal.timeout(douyinCommentConfig.requestTimeoutMs)
      });
      const payload = await response.json().catch(() => ({})) as {
        success?: boolean;
        comments?: Array<Record<string, unknown>>;
        videoId?: string;
        strategy?: string;
        source?: string;
        hasMore?: boolean;
        pages?: number;
        reportedTotal?: number;
        message?: string;
      };

      const resolvedAwemeId = String(payload.videoId || awemeId || "");
      const comments = normalizeDouyinComments(Array.isArray(payload.comments) ? payload.comments : [], {
        awemeId: resolvedAwemeId,
        maxComments
      });

      if (!payload.success || !comments.length) {
        lastError = String(payload.message || "评论接口没有返回评论。");
        // 明确没有评论 / 需要登录，不必重试
        if (/未返回评论|需要登录|没有评论/.test(lastError)) break;
        continue;
      }

      const summary = `已获取 ${comments.length} 条评论`;
      console.info(`[DOUYIN_COMMENTS] ${summary} strategy=${payload.strategy || "-"} awemeId=${resolvedAwemeId || "-"}`);
      return {
        success: true,
        awemeId: resolvedAwemeId,
        comments,
        totalFetched: comments.length,
        totalReported: Number(payload.reportedTotal || 0),
        hasMore: Boolean(payload.hasMore),
        fetchedAt,
        source: payload.source || "crawler-service",
        strategy: String(payload.strategy || ""),
        message: String(payload.message || summary)
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "评论请求失败。";
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }

  console.warn("[DOUYIN_COMMENTS] 获取失败：" + lastError);
  return empty("暂时未获取到评论，可稍后重试。", lastError);
}
