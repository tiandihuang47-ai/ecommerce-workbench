import { mergeAnalyzeResult } from "@/services/link-analyzer/result";
import { tryExternalApiParser } from "@/services/link-analyzer/parsers/externalApi";
import { parseWithYtDlp } from "@/services/link-analyzer/parsers/ytDlpParser";
import type { LinkParser } from "@/services/link-analyzer/types";

export const tiktokParser: LinkParser = {
  name: "TikTok 专用解析器",
  platforms: ["tiktok"],
  async parse(context) {
    const external = await tryExternalApiParser(context, "TikTok 专用解析器", process.env.DOUYIN_TIKTOK_API_BASE_URL);
    if (external.status === "success" && (external.videoUrl || external.rawText || external.title)) return external;
    const ytDlp = await parseWithYtDlp(context, "TikTok yt-dlp 解析器");
    return mergeAnalyzeResult(ytDlp, { attempts: [...external.attempts, ...ytDlp.attempts] });
  }
};
