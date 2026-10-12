import { execFile } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { detectChromeProfiles } from "@/lib/chrome-profiles";
import { detectPlatform, normalizeUrl, type VideoPlatform } from "@/lib/video-link-parser";

const execFileAsync = promisify(execFile);
const tempDir = process.env.TEMP_FILE_DIR || "/tmp/director-platform";

export interface ResolvedVideoInfo {
  success: boolean;
  platform: VideoPlatform;
  url: string;
  normalizedUrl: string;
  title: string;
  author: string;
  description: string;
  duration: number;
  videoPath: string;
  message: string;
  attempts?: YtDlpAttemptResult[];
}

export interface YtDlpAttemptResult {
  strategy: string;
  command: string;
  success: boolean;
  stdoutSummary: string;
  stderrSummary: string;
  errorSummary: string;
}

export async function resolveVideoByYtDlp(url: string) {
  const normalizedUrl = normalizeUrl(url);
  const platform = detectPlatform(normalizedUrl);

  if (!normalizedUrl) {
    return buildResult({ success: false, platform: "unknown", url, normalizedUrl, message: "链接不能为空，请先粘贴平台视频链接。" });
  }

  try {
    new URL(normalizedUrl);
  } catch {
    return buildResult({ success: false, platform, url, normalizedUrl, message: "链接格式不正确，请检查是否包含完整域名。" });
  }

  if (platform === "unknown") {
    return buildResult({
      success: false,
      platform,
      url,
      normalizedUrl,
      message: "暂未识别该平台链接，请改用上传视频或手动输入逐字稿。"
    });
  }

  try {
    const { stdout } = await runYtDlpWithRetries(["--dump-json", "--no-playlist", normalizedUrl], platform, 30000);
    const metadata = JSON.parse(stdout) as Record<string, unknown>;

    return buildResult({
      success: true,
      platform,
      url,
      normalizedUrl: String(metadata.webpage_url || metadata.original_url || normalizedUrl),
      title: String(metadata.title || ""),
      author: String(metadata.uploader || metadata.channel || metadata.creator || ""),
      description: String(metadata.description || ""),
      duration: typeof metadata.duration === "number" ? metadata.duration : 0,
      message: "已通过 yt-dlp 解析到视频信息。"
    });
  } catch (error) {
    const ytError = error instanceof YtDlpStrategyError ? error : null;
    return buildResult({
      success: false,
      platform,
      url,
      normalizedUrl,
      message: buildDownloadErrorMessage(error, platform, "解析"),
      attempts: ytError?.attempts || []
    });
  }
}

export async function downloadVideoByYtDlp(url: string) {
  const normalizedUrl = normalizeUrl(url);
  const platform = detectPlatform(normalizedUrl);

  await mkdir(tempDir, { recursive: true });
  const before = new Set(await listFiles(tempDir));
  const outputTemplate = path.join(tempDir, `source_${Date.now()}_%(id)s.%(ext)s`);

  try {
    const downloadResult = await runYtDlpWithRetries(
      [
        "--no-playlist",
        "--no-part",
        "--restrict-filenames",
        "-f",
        "bv*+ba/best",
        "-o",
        outputTemplate,
        normalizedUrl
      ],
      platform,
      1000 * 60 * 10
    );

    const after = await listFiles(tempDir);
    const created = after.filter((file) => !before.has(file));
    const candidates = created.length ? created : after.filter((file) => file.includes("source_"));
    const newest = await newestFile(candidates);

    if (!newest) {
      return buildResult({
        success: false,
        platform,
        url,
        normalizedUrl,
        message: "yt-dlp 下载完成但没有找到本地视频文件，请改用上传视频或手动输入。"
      });
    }

    const info = await resolveVideoByYtDlp(normalizedUrl);
    return {
      ...info,
      success: true,
      platform,
      videoPath: newest,
      attempts: downloadResult.attempts,
      message: info.success ? "视频下载成功。" : "视频下载成功，但基础信息解析不完整。"
    };
  } catch (error) {
    const ytError = error instanceof YtDlpStrategyError ? error : null;
    return buildResult({
      success: false,
      platform,
      url,
      normalizedUrl,
      message: buildDownloadErrorMessage(error, platform, "下载"),
      attempts: ytError?.attempts || []
    });
  }
}

export async function resolveVideoLink(url: string) {
  return downloadVideoByYtDlp(url);
}

export { detectPlatform, normalizeUrl };

async function listFiles(dir: string) {
  try {
    const names = await readdir(dir);
    return names.map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

async function newestFile(files: string[]) {
  const stats = await Promise.all(
    files.map(async (file) => {
      try {
        return { file, stat: await stat(file) };
      } catch {
        return null;
      }
    })
  );

  const valid = stats
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.stat.isFile());

  return valid
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.file || "";
}

function buildResult(input: Partial<ResolvedVideoInfo> & Pick<ResolvedVideoInfo, "success" | "platform" | "url" | "normalizedUrl" | "message">): ResolvedVideoInfo {
  return {
    title: "",
    author: "",
    description: "",
    duration: 0,
    videoPath: "",
    ...input
  };
}

function formatProcessError(error: unknown) {
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, " ").slice(0, 500);
  }
  return "命令执行失败";
}

export async function runYtDlpWithRetries(args: string[], platform: VideoPlatform, timeout: number) {
  const attempts = await buildYtDlpAttempts(args, platform);
  const results: YtDlpAttemptResult[] = [];
  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const result = await execFileAsync("yt-dlp", attempt.args, {
        timeout,
        maxBuffer: 1024 * 1024 * 16
      });
      results.push({
        strategy: attempt.strategy,
        command: sanitizeCommand(["yt-dlp", ...attempt.args]),
        success: true,
        stdoutSummary: summarizeOutput(result.stdout),
        stderrSummary: summarizeOutput(result.stderr),
        errorSummary: ""
      });
      return { ...result, attempts: results };
    } catch (error) {
      lastError = error;
      results.push({
        strategy: attempt.strategy,
        command: sanitizeCommand(["yt-dlp", ...attempt.args]),
        success: false,
        stdoutSummary: summarizeOutput(getProcessStream(error, "stdout")),
        stderrSummary: summarizeOutput(getProcessStream(error, "stderr")),
        errorSummary: summarizeOutput(formatProcessError(error))
      });
    }
  }

  throw new YtDlpStrategyError(lastError instanceof Error ? lastError.message : "yt-dlp 执行失败", results);
}

export async function buildYtDlpAttempts(args: string[], platform: VideoPlatform) {
  const baseHeaders = [
    "--user-agent",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "--referer",
    getRefererByPlatform(platform)
  ];

  const attempts: Array<{ strategy: string; args: string[] }> = [
    { strategy: "direct_headers", args: [...baseHeaders, ...args] }
  ];

  const browserName = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  const profileName = process.env.YTDLP_CHROME_PROFILE?.trim();
  if (browserName && profileName) {
    attempts.push({
      strategy: `chrome_profile:${profileName}`,
      args: ["--cookies-from-browser", `${browserName}:${profileName}`, ...baseHeaders, ...args]
    });
  } else if (browserName) {
    attempts.push({
      strategy: `browser_cookie:${browserName}`,
      args: ["--cookies-from-browser", browserName, ...baseHeaders, ...args]
    });
  }

  if (process.env.YTDLP_AUTO_TRY_CHROME_PROFILES === "true") {
    const profiles = await detectChromeProfiles();
    const ordered = profileName
      ? profiles.sort((a, b) => (a.name === profileName ? -1 : b.name === profileName ? 1 : 0))
      : profiles;
    for (const profile of ordered.filter((item) => item.hasCookies)) {
      const strategy = `auto_chrome_profile:${profile.name}`;
      if (!attempts.some((attempt) => attempt.strategy === strategy || attempt.strategy === `chrome_profile:${profile.name}`)) {
        attempts.push({
          strategy,
          args: ["--cookies-from-browser", `chrome:${profile.name}`, ...baseHeaders, ...args]
        });
      }
    }
  }

  const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
  if (cookiesFile) {
    attempts.push({
      strategy: "cookies_file",
      args: ["--cookies", cookiesFile, ...baseHeaders, ...args]
    });
  }

  return attempts;
}

function getRefererByPlatform(platform: VideoPlatform) {
  if (platform === "douyin") return "https://www.douyin.com/";
  if (platform === "kuaishou") return "https://www.kuaishou.com/";
  if (platform === "xiaohongshu") return "https://www.xiaohongshu.com/";
  if (platform === "bilibili") return "https://www.bilibili.com/";
  if (platform === "youtube") return "https://www.youtube.com/";
  if (platform === "tiktok") return "https://www.tiktok.com/";
  if (platform === "wechat_channels") return "https://channels.weixin.qq.com/";
  return "https://www.google.com/";
}

function buildDownloadErrorMessage(error: unknown, platform: VideoPlatform, action: "解析" | "下载") {
  const raw = formatProcessError(error);

  if (platform === "douyin" && raw.includes("Unsupported URL: https://www.douyin.com")) {
    return `抖音链接没有跳转到具体视频，而是跳到了抖音首页。请在抖音里重新点“分享”复制最新链接，确认粘贴内容里包含 https://v.douyin.com/...；如果仍失败，请用“上传视频”。`;
  }

  if (platform === "douyin" && raw.includes("Failed to parse JSON")) {
    return `抖音${action}失败：抖音接口返回了无法解析的内容，通常是链接失效、风控或需要登录 Cookie。默认不会读取浏览器 Cookie；如确需登录态，请在页面高级模式手动开启，或直接用“上传视频”。`;
  }

  return `视频${action}失败：${raw}。平台可能限制下载，请改用上传视频或手动输入。`;
}

function sanitizeCommand(parts: string[]) {
  return parts.map((part, index) => {
    const previous = parts[index - 1];
    if (previous === "--cookies") return "<cookies.txt路径已隐藏>";
    return part;
  }).join(" ");
}

function summarizeOutput(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 700) return text;
  return `${text.slice(0, 260)} ... ${text.slice(-420)}`;
}

function getProcessStream(error: unknown, key: "stdout" | "stderr") {
  if (error && typeof error === "object" && key in error) {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  }
  return "";
}

class YtDlpStrategyError extends Error {
  attempts: YtDlpAttemptResult[];

  constructor(message: string, attempts: YtDlpAttemptResult[]) {
    super(message);
    this.name = "YtDlpStrategyError";
    this.attempts = attempts;
  }
}
