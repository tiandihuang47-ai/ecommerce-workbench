import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { runYtDlpWithRetries } from "@/lib/video-resolver";
import { emptyAnalyzeResult, mergeAnalyzeResult } from "@/services/link-analyzer/result";
import type { LinkAnalyzeContext, LinkAnalyzeResult, LinkParser } from "@/services/link-analyzer/types";

const tempDir = process.env.TEMP_FILE_DIR || "/tmp/director-platform";

export const ytDlpParser: LinkParser = {
  name: "yt-dlp 通用解析器",
  platforms: ["douyin", "kuaishou", "bilibili", "youtube", "tiktok", "generic"],
  async parse(context) {
    return parseWithYtDlp(context, "yt-dlp 通用解析器");
  }
};

export async function parseWithYtDlp(context: LinkAnalyzeContext, parserName: string): Promise<LinkAnalyzeResult> {
  const base = emptyAnalyzeResult({
    platform: context.platform,
    url: context.originalInput,
    normalizedUrl: context.normalizedUrl,
    parser: parserName
  });

  let metadata: Record<string, unknown> = {};
  const attempts = [];

  try {
    const result = await runYtDlpWithRetries(["--dump-json", "--no-playlist", context.normalizedUrl], context.platform, 45000);
    metadata = JSON.parse(result.stdout) as Record<string, unknown>;
    attempts.push({
      parser: parserName,
      stage: "parse_link" as const,
      success: true,
      message: "yt-dlp 已解析到公开元数据。",
      detail: result.attempts.map((item) => `${item.strategy}：${item.success ? "成功" : "失败"}`).join("；")
    });
  } catch (error) {
    attempts.push({
      parser: parserName,
      stage: "parse_link" as const,
      success: false,
      message: "yt-dlp 元数据解析失败。",
      detail: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 500) : "未知错误"
    });
  }

  const downloaded = await downloadWithYtDlp(context, parserName);
  attempts.push(...downloaded.attempts);

  const webpageUrl = stringValue(metadata.webpage_url) || stringValue(metadata.original_url) || context.normalizedUrl;
  const result = mergeAnalyzeResult(base, {
    normalizedUrl: webpageUrl,
    title: stringValue(metadata.title),
    author: stringValue(metadata.uploader) || stringValue(metadata.channel) || stringValue(metadata.creator),
    description: stringValue(metadata.description),
    coverUrl: stringValue(metadata.thumbnail),
    videoUrl: stringValue(metadata.url),
    duration: metadata.duration ? String(metadata.duration) : "",
    publishTime: stringValue(metadata.upload_date) || stringValue(metadata.release_timestamp),
    comments: normalizeComments(metadata.comments),
    rawText: [stringValue(metadata.title), stringValue(metadata.description)].filter(Boolean).join("\n"),
    videoPath: downloaded.videoPath,
    status: downloaded.videoPath || Object.keys(metadata).length ? "success" : "failed",
    error: downloaded.videoPath || Object.keys(metadata).length ? "" : "yt-dlp 无法解析或下载该链接。",
    attempts,
    structuredJson: {
      extractor: stringValue(metadata.extractor),
      id: stringValue(metadata.id),
      webpage_url: webpageUrl
    }
  });

  return result;
}

async function downloadWithYtDlp(context: LinkAnalyzeContext, parserName: string) {
  await mkdir(tempDir, { recursive: true });
  const before = new Set(await listFiles(tempDir));
  const outputTemplate = path.join(tempDir, `link_${Date.now()}_%(extractor)s_%(id)s.%(ext)s`);

  try {
    const result = await runYtDlpWithRetries(
      [
        "--no-playlist",
        "--no-part",
        "--restrict-filenames",
        "-f",
        "bv*+ba/best",
        "-o",
        outputTemplate,
        context.normalizedUrl
      ],
      context.platform,
      1000 * 60 * 12
    );

    const after = await listFiles(tempDir);
    const created = after.filter((file) => !before.has(file));
    const newest = await newestFile(created.length ? created : after.filter((file) => file.includes("link_")));

    return {
      videoPath: newest,
      attempts: [{
        parser: parserName,
        stage: "video_download" as const,
        success: Boolean(newest),
        message: newest ? "yt-dlp 已下载视频文件。" : "yt-dlp 执行完成但未找到本地视频文件。",
        detail: result.attempts.map((item) => `${item.strategy}：${item.success ? "成功" : "失败"}`).join("；")
      }]
    };
  } catch (error) {
    return {
      videoPath: "",
      attempts: [{
        parser: parserName,
        stage: "video_download" as const,
        success: false,
        message: "yt-dlp 下载失败，可能是登录、地区、版权、风控或链接失效。",
        detail: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 700) : "未知错误"
      }]
    };
  }
}

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

  const valid = stats.filter((item): item is NonNullable<typeof item> => Boolean(item?.stat.isFile()));

  return valid
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.file || "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeComments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      author: stringValue(record.author) || stringValue(record.uploader),
      content: stringValue(record.text) || stringValue(record.content),
      likeCount: record.like_count ? String(record.like_count) : "",
      publishTime: stringValue(record.timestamp)
    };
  }).filter((item) => item.content);
}
