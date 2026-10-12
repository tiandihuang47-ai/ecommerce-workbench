import { extractAudioFromVideo } from "@/lib/audio-extractor";
import { transcribeAudio } from "@/lib/doubao-asr";
import { generateWithDeepSeek, getDeepSeekErrorMessage } from "@/lib/deepseek";
import { checkRequiredTools } from "@/lib/system-check";
import { detectPlatform, normalizeUrl } from "@/lib/video-link-parser";
import { emptyAnalyzeResult, mergeAnalyzeResult, resultToStructuredJson } from "@/services/link-analyzer/result";
import { bilibiliParser } from "@/services/link-analyzer/parsers/bilibiliParser";
import { douyinParser } from "@/services/link-analyzer/parsers/douyinParser";
import { genericParser } from "@/services/link-analyzer/parsers/genericParser";
import { kuaishouParser } from "@/services/link-analyzer/parsers/kuaishouParser";
import { tiktokParser } from "@/services/link-analyzer/parsers/tiktokParser";
import { wechatChannelParser } from "@/services/link-analyzer/parsers/wechatChannelParser";
import { xiaohongshuParser } from "@/services/link-analyzer/parsers/xiaohongshuParser";
import { youtubeParser } from "@/services/link-analyzer/parsers/youtubeParser";
import { ytDlpParser } from "@/services/link-analyzer/parsers/ytDlpParser";
import type { LinkAnalyzeJobInput, LinkAnalyzeResult, LinkParser } from "@/services/link-analyzer/types";
import type { ToolInput } from "@/lib/generators";

const parserMap: LinkParser[] = [
  douyinParser,
  kuaishouParser,
  xiaohongshuParser,
  bilibiliParser,
  youtubeParser,
  tiktokParser,
  wechatChannelParser
];

export async function analyzePlatformLink(input: LinkAnalyzeJobInput): Promise<LinkAnalyzeResult> {
  const normalizedUrl = normalizeUrl(input.url);
  const platform = detectPlatform(normalizedUrl);

  if (!normalizedUrl) {
    return emptyAnalyzeResult({
      platform: "unknown",
      url: input.url,
      normalizedUrl,
      parser: "平台识别",
      error: "没有检测到可解析的视频链接。"
    });
  }

  try {
    new URL(normalizedUrl);
  } catch {
    return emptyAnalyzeResult({
      platform,
      url: input.url,
      normalizedUrl,
      parser: "平台识别",
      error: "链接格式不正确，请检查是否包含完整域名。"
    });
  }

  const tools = await checkRequiredTools();
  const attempts = [{
    parser: "系统环境",
    stage: "parse_link" as const,
    success: tools.ok,
    message: tools.message
  }];

  const context = {
    originalInput: input.url,
    url: normalizedUrl,
    normalizedUrl,
    platform,
    useBrowserCookies: Boolean(input.useBrowserCookies)
  };

  const candidates = buildParserPipeline(platform);
  let best = emptyAnalyzeResult({
    platform,
    url: input.url,
    normalizedUrl,
    parser: "多解析器调度器",
    error: "还没有解析到有效结果。",
    attempts
  });

  for (const parser of candidates) {
    const parsed = await parser.parse(context);
    best = chooseBetterResult(best, parsed);
    if (parsed.status === "success" && (parsed.videoPath || parsed.rawText || parsed.title || parsed.description)) {
      break;
    }
  }

  best = mergeAnalyzeResult(best, {
    attempts: [...attempts, ...best.attempts]
  });

  if (best.videoPath) {
    const audio = await extractAudioFromVideo(best.videoPath);
    best.attempts.push({
      parser: "ffmpeg 音频提取",
      stage: "audio_extract",
      success: audio.success,
      message: audio.message
    });
    if (audio.success) {
      best = mergeAnalyzeResult(best, { audioPath: audio.audioPath });
      const asr = await transcribeAudio(audio.audioPath);
      best.attempts.push({
        parser: "豆包语音转写",
        stage: "asr",
        success: asr.success,
        message: asr.message
      });
      if (asr.success) {
        best = mergeAnalyzeResult(best, {
          transcript: asr.transcript,
          rawText: asr.transcript || best.rawText,
          status: "success",
          error: ""
        });
      } else if (!best.rawText) {
        best = mergeAnalyzeResult(best, {
          status: "failed",
          error: asr.message
        });
      }
    }
  }

  if (best.status === "failed") {
    best = mergeAnalyzeResult(best, {
      error: buildActionableFailureMessage(best)
    });
  }

  return mergeAnalyzeResult(best, {
    structuredJson: resultToStructuredJson(best)
  });
}

export async function generateDeconstructionFromAnalysis(result: LinkAnalyzeResult, input: LinkAnalyzeJobInput) {
  const sourceText = [result.transcript, result.rawText, result.description, result.title].filter(Boolean).join("\n").trim();
  if (!sourceText || !input.targetProduct || !input.targetAudience) {
    return { success: false, content: "", message: "缺少逐字稿、目标产品或目标人群，暂不自动拆解。" };
  }

  try {
    const toolInput: ToolInput = {
      platform: result.platform,
      sourceUrl: result.normalizedUrl || result.url,
      sourceTitle: result.title,
      transcript: sourceText,
      comments: result.comments.map((item) => item.content).join("\n"),
      targetProduct: input.targetProduct,
      targetAudience: input.targetAudience,
      rewriteGoal: input.rewriteGoal || "",
      rewriteStyle: input.rewriteStyle || "",
      extraRequirement: input.extraRequirement || "",
      instruction: "请基于平台链接分析结果进行拆片与原创仿写。不要复制原文案，只迁移结构。"
    };
    const content = await withTimeout(
      generateWithDeepSeek({ type: "link_deconstruction_rewrite", input: toolInput }),
      45000,
      "DeepSeek 响应超时，已使用本地基础拆片模板。"
    );
    return { success: true, content, message: "DeepSeek 已完成拆片和原创仿写。" };
  } catch (error) {
    return {
      success: true,
      content: buildLocalLinkDeconstruction(result, input, getDeepSeekErrorMessage(error)),
      message: `${getDeepSeekErrorMessage(error)}，已使用本地基础拆片模板。`
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildLocalLinkDeconstruction(result: LinkAnalyzeResult, input: LinkAnalyzeJobInput, reason: string) {
  const product = input.targetProduct || "目标产品";
  const audience = input.targetAudience || "目标人群";
  const title = result.title || "原视频";
  const hook = result.transcript.split(/[。！？\n]/).find(Boolean)?.trim() || "先点出用户正在遇到的具体问题。";

  return [
    "# 拆片结果",
    "",
    `> AI 生成未完成：${reason}`,
    "",
    "## 1. 视频核心主题",
    `${title}的核心是用真实工作流或真实经验解决一个具体低效问题。`,
    "",
    "## 2. 目标人群",
    audience,
    "",
    "## 3. 开头钩子",
    hook,
    "",
    "## 4. 爆款元素",
    "人群圈定、效率反差、成本感、可复制方法。",
    "",
    "## 5. 内容结构",
    "共鸣痛点 → 展示新方法 → 解释为什么有效 → 给出细节证据 → 引导领取/咨询。",
    "",
    "## 6. 情绪变化",
    "被说中 → 好奇 → 看到过程 → 相信可复制 → 想拿到方法。",
    "",
    "## 7. 节奏设计",
    "开头 3 秒直接说痛点；中段每 8-12 秒用一个画面或步骤推进；结尾给清晰行动。",
    "",
    "## 8. 画中画/画面辅助逻辑",
    "痛点段放错误示范或用户反馈；方法段放操作过程；证明段放细节对比；结尾放评论或私信引导。",
    "",
    "## 9. 转化路径",
    "先让用户相信你真的解决过问题，再引导评论、私信或进直播间。",
    "",
    "## 10. 可迁移结构",
    `迁移到${product}：点出${audience}的选择/使用痛点 → 展示你的解决过程 → 给出可判断的标准 → 引导咨询。`,
    "",
    "# 仿写结果",
    "",
    "## 1. 新选题",
    `${audience}选${product}前，先看懂这 3 个真实标准`,
    "",
    "## 2. 标题",
    `${product}别只看表面，真正影响体验的是这 3 点`,
    "",
    "## 3. 开头 3 秒钩子",
    `${audience}如果正在看${product}，先别急着下单，很多人踩坑就是忽略了这 3 个细节。`,
    "",
    "## 4. 完整口播脚本",
    `如果你是${audience}，正在纠结${product}，这条先听完。\n很多人不是不会选，而是一开始就看错了重点。\n第一，看它能不能解决你最真实的使用问题。\n第二，看卖点有没有具体证据，不要只听一句口号。\n第三，看后续承接是否清楚，出了问题有没有人能把话说明白。\n所以这条不是催你马上买，而是先把判断标准搞清楚。\n如果你也在纠结，把你的情况留在评论区，我按真实需求帮你判断。`,
    "",
    "## 5. 分镜建议",
    "人物中近景说钩子 → 切产品真实场景 → 展示细节和对比 → 放反馈/评论 → 回到人物做转化。",
    "",
    "## 6. 画中画建议",
    "用户痛点、产品细节、对比画面、评论截图、咨询入口。",
    "",
    "## 7. 拍摄提醒",
    "只迁移结构，不复制原视频文案；所有证据都换成自己的产品、场景和案例。",
    "",
    "## 8. 结尾引导",
    "把你的情况留在评论区，我按真实需求帮你判断。",
    "",
    "## 9. 延展选题",
    `1. ${product}最容易被忽略的 3 个成本\n2. ${audience}买${product}前必须问清楚的问题\n3. 为什么便宜的${product}可能更贵\n4. ${product}怎么选才不踩坑\n5. 从真实案例看${product}的判断标准`
  ].join("\n");
}

function buildParserPipeline(platform: LinkAnalyzeResult["platform"]) {
  const dedicated = parserMap.filter((parser) => parser.platforms.includes(platform));
  const fallback = [ytDlpParser, genericParser].filter((parser) => parser.platforms.includes(platform));
  return [...dedicated, ...fallback].filter((parser, index, list) => list.findIndex((item) => item.name === parser.name) === index);
}

function chooseBetterResult(current: LinkAnalyzeResult, next: LinkAnalyzeResult) {
  const currentScore = scoreResult(current);
  const nextScore = scoreResult(next);
  if (nextScore >= currentScore) {
    return mergeAnalyzeResult(next, { attempts: [...current.attempts, ...next.attempts] });
  }
  return mergeAnalyzeResult(current, { attempts: [...current.attempts, ...next.attempts] });
}

function buildActionableFailureMessage(result: LinkAnalyzeResult) {
  const details = result.attempts.map((attempt) => `${attempt.message} ${attempt.detail || ""}`).join(" ");
  if (result.platform === "douyin" && /Fresh cookies|could not be decrypted|Cookie|cookies/i.test(details)) {
    return "抖音链接可能需要登录态或新鲜 Cookie 才能下载。系统默认不会读取浏览器 Cookie，避免弹出钥匙串窗口；如确需尝试，请在页面手动开启“使用浏览器登录态解析”，或直接用上传视频模式。";
  }
  if (result.platform === "douyin") {
    return "抖音链接无法直接下载，常见原因是链接过期、风控、需要登录 Cookie 或视频权限限制。请重新复制抖音分享链接，或改用上传视频模式。";
  }
  return result.error || "链接分析失败，请改用上传视频或手动输入。";
}

function scoreResult(result: LinkAnalyzeResult) {
  let score = result.status === "success" ? 10 : 0;
  if (result.title) score += 2;
  if (result.author) score += 2;
  if (result.description) score += 2;
  if (result.coverUrl) score += 2;
  if (result.videoPath) score += 8;
  if (result.transcript) score += 10;
  if (result.comments.length) score += 2;
  return score;
}
