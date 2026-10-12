import { parseWithYtDlp } from "@/services/link-analyzer/parsers/ytDlpParser";
import type { LinkParser } from "@/services/link-analyzer/types";

export const youtubeParser: LinkParser = {
  name: "YouTube 专用解析器",
  platforms: ["youtube"],
  async parse(context) {
    return parseWithYtDlp(context, "YouTube yt-dlp 解析器");
  }
};
