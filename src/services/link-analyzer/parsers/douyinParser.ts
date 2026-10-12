import { mergeAnalyzeResult } from "@/services/link-analyzer/result";
import { tryExternalApiParser } from "@/services/link-analyzer/parsers/externalApi";
import { parseWithYtDlp } from "@/services/link-analyzer/parsers/ytDlpParser";
import { resolveDouyinWithCrawlerService } from "@/lib/crawler-service-client";
import type { LinkParser } from "@/services/link-analyzer/types";

export const douyinParser: LinkParser = {
  name: "抖音专用解析器",
  platforms: ["douyin"],
  async parse(context) {
    const crawler = await resolveDouyinWithCrawlerService(context.originalInput, {
      useBrowserCookies: Boolean(context.useBrowserCookies)
    });
    const ytDlp = await parseWithYtDlp(context, "抖音 yt-dlp 解析器");
    const crawlerResult = mergeAnalyzeResult(ytDlp, {
      title: crawler.success ? crawler.title || ytDlp.title : ytDlp.title,
      author: crawler.success ? crawler.author || ytDlp.author : ytDlp.author,
      description: crawler.success ? crawler.description || ytDlp.description : ytDlp.description,
      coverUrl: crawler.success ? crawler.cover || ytDlp.coverUrl : ytDlp.coverUrl,
      videoUrl: crawler.success ? crawler.videoUrl || crawler.downloadUrl || ytDlp.videoUrl : ytDlp.videoUrl,
      rawText: crawler.success ? [crawler.title, crawler.description].filter(Boolean).join("\n") || ytDlp.rawText : ytDlp.rawText,
      attempts: [...crawler.attempts, ...ytDlp.attempts],
      structuredJson: crawler.success ? { crawlerService: crawler.rawData || {} } : {}
    });
    if (crawlerResult.status === "success" && (crawlerResult.videoPath || crawlerResult.title || crawlerResult.description)) {
      return crawlerResult;
    }

    const external = await tryExternalApiParser(context, "抖音专用解析器", process.env.DOUYIN_TIKTOK_API_BASE_URL);
    if (external.status === "success" && (external.videoUrl || external.rawText || external.title)) return external;
    return mergeAnalyzeResult(crawlerResult, { attempts: [...crawlerResult.attempts, ...external.attempts] });
  }
};
