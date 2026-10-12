import { mergeAnalyzeResult } from "@/services/link-analyzer/result";
import { genericParser } from "@/services/link-analyzer/parsers/genericParser";
import { parseWithYtDlp } from "@/services/link-analyzer/parsers/ytDlpParser";
import type { LinkParser } from "@/services/link-analyzer/types";

export const xiaohongshuParser: LinkParser = {
  name: "小红书专用解析器",
  platforms: ["xiaohongshu"],
  async parse(context) {
    const ytDlp = await parseWithYtDlp(context, "小红书 yt-dlp 解析器");
    if (ytDlp.status === "success" && (ytDlp.videoPath || ytDlp.rawText || ytDlp.title)) return ytDlp;
    const generic = await genericParser.parse(context);
    return mergeAnalyzeResult(generic, { attempts: [...ytDlp.attempts, ...generic.attempts] });
  }
};
