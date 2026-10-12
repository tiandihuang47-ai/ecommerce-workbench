import { mergeAnalyzeResult } from "@/services/link-analyzer/result";
import { genericParser } from "@/services/link-analyzer/parsers/genericParser";
import type { LinkParser } from "@/services/link-analyzer/types";

export const wechatChannelParser: LinkParser = {
  name: "视频号专用解析器",
  platforms: ["wechat_channels"],
  async parse(context) {
    const generic = await genericParser.parse(context);
    return mergeAnalyzeResult(generic, {
      attempts: [
        {
          parser: "视频号专用解析器",
          stage: "parse_link",
          success: false,
          message: "视频号公开链接通常无法直接解析视频文件，已改用网页元信息兜底。"
        },
        ...generic.attempts
      ],
      error: generic.status === "success" ? "" : "视频号链接无法稳定公开解析，请上传视频或手动输入逐字稿。"
    });
  }
};
