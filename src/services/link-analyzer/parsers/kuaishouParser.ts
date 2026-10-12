import { mergeAnalyzeResult } from "@/services/link-analyzer/result";
import { tryExternalApiParser } from "@/services/link-analyzer/parsers/externalApi";
import { parseWithYtDlp } from "@/services/link-analyzer/parsers/ytDlpParser";
import type { LinkParser } from "@/services/link-analyzer/types";

export const kuaishouParser: LinkParser = {
  name: "快手专用解析器",
  platforms: ["kuaishou"],
  async parse(context) {
    const external = await tryExternalApiParser(context, "快手专用解析器", process.env.DOUYIN_TIKTOK_API_BASE_URL);
    if (external.status === "success" && (external.videoUrl || external.rawText || external.title)) return external;
    const ytDlp = await parseWithYtDlp(context, "快手 yt-dlp 解析器");
    return mergeAnalyzeResult(ytDlp, { attempts: [...external.attempts, ...ytDlp.attempts] });
  }
};
