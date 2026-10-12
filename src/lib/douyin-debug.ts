import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { extractAudioFromVideo } from "@/lib/audio-extractor";
import { transcribeAudio } from "@/lib/doubao-asr";
import { detectChromeProfiles } from "@/lib/chrome-profiles";
import { generateWithDeepSeek } from "@/lib/deepseek";
import { detectPlatform, extractFirstUrl, normalizeUrl } from "@/lib/video-link-parser";
import { downloadVideoByYtDlp, runYtDlpWithRetries, type YtDlpAttemptResult } from "@/lib/video-resolver";

const execFileAsync = promisify(execFile);

export interface DebugStep {
  stepName: string;
  status: "success" | "failed" | "skipped";
  command: string;
  stdoutSummary: string;
  stderrSummary: string;
  nextSuggestion: string;
}

export interface DouyinDebugReport {
  success: boolean;
  input: string;
  extractedUrl: string;
  normalizedUrl: string;
  platform: string;
  redirectedUrl: string;
  chromeProfiles: Array<{ name: string; hasCookies: boolean }>;
  ytDlpAttempts: YtDlpAttemptResult[];
  videoPath: string;
  audioPath: string;
  transcriptPreview: string;
  deepseekPreview: string;
  finalReason: string;
  finalSuggestion: string;
  steps: DebugStep[];
}

export async function debugDouyinLink(input: string): Promise<DouyinDebugReport> {
  const steps: DebugStep[] = [];
  const extractedUrl = extractFirstUrl(input);
  const normalizedUrl = normalizeUrl(input);
  const platform = detectPlatform(normalizedUrl);
  let redirectedUrl = "";
  let videoPath = "";
  let audioPath = "";
  let transcript = "";
  let deepseekContent = "";
  let ytDlpAttempts: YtDlpAttemptResult[] = [];

  const ytDlp = await runCommand("yt-dlp", ["--version"]);
  steps.push({
    stepName: "1. 检查 yt-dlp 是否安装",
    status: ytDlp.ok ? "success" : "failed",
    command: "yt-dlp --version",
    stdoutSummary: summarize(ytDlp.stdout),
    stderrSummary: summarize(ytDlp.stderr || ytDlp.error),
    nextSuggestion: ytDlp.ok ? "yt-dlp 已安装。" : "请执行 brew install yt-dlp。"
  });

  steps.push({
    stepName: "2. yt-dlp 版本号",
    status: ytDlp.ok ? "success" : "failed",
    command: "yt-dlp --version",
    stdoutSummary: summarize(ytDlp.stdout),
    stderrSummary: "",
    nextSuggestion: ytDlp.ok ? "版本可用。" : "版本不可用。"
  });

  const ffmpeg = await runCommand("ffmpeg", ["-version"]);
  steps.push({
    stepName: "3. 检查 ffmpeg 是否安装",
    status: ffmpeg.ok ? "success" : "failed",
    command: "ffmpeg -version",
    stdoutSummary: summarize(ffmpeg.stdout),
    stderrSummary: summarize(ffmpeg.stderr || ffmpeg.error),
    nextSuggestion: ffmpeg.ok ? "ffmpeg 已安装。" : "请执行 brew install ffmpeg。"
  });

  steps.push({
    stepName: "4. ffmpeg 版本号",
    status: ffmpeg.ok ? "success" : "failed",
    command: "ffmpeg -version",
    stdoutSummary: summarize(ffmpeg.stdout.split("\n")[0] || ""),
    stderrSummary: "",
    nextSuggestion: ffmpeg.ok ? "版本可用。" : "版本不可用。"
  });

  steps.push({
    stepName: "5. 从用户输入中提取纯 URL",
    status: extractedUrl ? "success" : "failed",
    command: "extractFirstUrl(input)",
    stdoutSummary: extractedUrl || "",
    stderrSummary: "",
    nextSuggestion: extractedUrl ? "已提取到纯链接。" : "请输入包含 https://v.douyin.com/... 的分享内容。"
  });

  steps.push({
    stepName: "6. 识别平台",
    status: platform === "douyin" ? "success" : "failed",
    command: "detectPlatform(url)",
    stdoutSummary: platform,
    stderrSummary: "",
    nextSuggestion: platform === "douyin" ? "已识别为抖音。" : "该链接不是抖音链接。"
  });

  if (extractedUrl) {
    const redirect = await resolveRedirect(normalizedUrl);
    redirectedUrl = redirect.url;
    steps.push({
      stepName: "7. 解析短链跳转后的真实 URL",
      status: redirect.ok ? "success" : "failed",
      command: `fetch HEAD ${normalizedUrl}`,
      stdoutSummary: redirectedUrl,
      stderrSummary: redirect.error,
      nextSuggestion: redirect.ok && redirectedUrl.includes("/video/") ? "短链跳到了视频详情页。" : "短链没有跳到具体视频，可能失效或被风控。"
    });
  } else {
    steps.push(skipStep("7. 解析短链跳转后的真实 URL", "没有可用 URL。"));
  }

  if (platform === "douyin" && extractedUrl) {
    const direct = await runCommand("yt-dlp", ["--verbose", "--dump-json", "--no-playlist", normalizedUrl], 30000);
    steps.push(commandStep("8. 不带 Cookie 运行 yt-dlp 是否成功", direct, `yt-dlp --verbose --dump-json --no-playlist ${normalizedUrl}`, "不带 Cookie 可解析。", "不带 Cookie 失败，继续尝试 Cookie 策略。"));

    const browser = await runCommand("yt-dlp", ["--verbose", "--cookies-from-browser", "chrome", "--dump-json", "--no-playlist", normalizedUrl], 30000);
    steps.push(commandStep("9. 带 Chrome Cookie 运行 yt-dlp 是否成功", browser, `yt-dlp --verbose --cookies-from-browser chrome --dump-json --no-playlist ${normalizedUrl}`, "Chrome Cookie 可解析。", "Chrome Cookie 失败，可能未授权钥匙串、Cookie 过期或未登录抖音。"));

    const profiles = await detectChromeProfiles();
    for (const profile of profiles.filter((item) => item.hasCookies)) {
      const result = await runCommand("yt-dlp", ["--verbose", "--cookies-from-browser", `chrome:${profile.name}`, "--dump-json", "--no-playlist", normalizedUrl], 30000);
      steps.push(commandStep(`10. 带指定 Chrome Profile 运行 yt-dlp：${profile.name}`, result, `yt-dlp --verbose --cookies-from-browser "chrome:${profile.name}" --dump-json --no-playlist ${normalizedUrl}`, `${profile.name} 可解析。`, `${profile.name} 失败，继续尝试其他 Profile。`));
    }

    if (!profiles.some((profile) => profile.hasCookies)) {
      steps.push({
        stepName: "10. 带指定 Chrome Profile 运行 yt-dlp",
        status: "failed",
        command: "detectChromeProfiles()",
        stdoutSummary: "没有发现带 Cookies 文件的 Chrome Profile。",
        stderrSummary: "",
        nextSuggestion: "请确认 Chrome 已登录抖音，或配置 YTDLP_COOKIES_FILE。"
      });
    }

    const downloaded = await downloadVideoByYtDlp(normalizedUrl);
    ytDlpAttempts = downloaded.attempts || [];
    videoPath = downloaded.videoPath;
    steps.push({
      stepName: "11. 是否成功下载视频文件",
      status: downloaded.success && videoPath ? "success" : "failed",
      command: "downloadVideoByYtDlp(url)",
      stdoutSummary: downloaded.success ? videoPath : downloaded.message,
      stderrSummary: ytDlpAttempts.filter((attempt) => !attempt.success).map((attempt) => `${attempt.strategy}: ${attempt.errorSummary || attempt.stderrSummary}`).join(" | "),
      nextSuggestion: downloaded.success ? "视频已下载，继续提取音频。" : "下载失败。建议重新复制链接、配置 fresh cookies.txt，或改用上传视频。"
    });
  } else {
    steps.push(skipStep("8. 不带 Cookie 运行 yt-dlp 是否成功", "不是有效抖音链接。"));
    steps.push(skipStep("9. 带 Chrome Cookie 运行 yt-dlp 是否成功", "不是有效抖音链接。"));
    steps.push(skipStep("10. 带指定 Chrome Profile 运行 yt-dlp 是否成功", "不是有效抖音链接。"));
    steps.push(skipStep("11. 是否成功下载视频文件", "不是有效抖音链接。"));
  }

  if (videoPath) {
    const audio = await extractAudioFromVideo(videoPath);
    audioPath = audio.audioPath;
    steps.push({
      stepName: "12. 是否成功用 ffmpeg 提取音频",
      status: audio.success ? "success" : "failed",
      command: `ffmpeg -i ${videoPath} ...`,
      stdoutSummary: audio.success ? audioPath : "",
      stderrSummary: audio.success ? "" : audio.message,
      nextSuggestion: audio.success ? "音频已生成，继续 ASR。" : "音频提取失败，请检查视频文件。"
    });
  } else {
    steps.push(skipStep("12. 是否成功用 ffmpeg 提取音频", "视频未下载成功。"));
  }

  if (audioPath) {
    const asr = await transcribeAudio(audioPath);
    transcript = asr.transcript;
    steps.push({
      stepName: "13. 是否能调用豆包语音转写",
      status: asr.success ? "success" : "failed",
      command: "transcribeAudio(audioPath)",
      stdoutSummary: summarize(transcript),
      stderrSummary: asr.success ? "" : asr.message,
      nextSuggestion: asr.success ? "语音转写成功，继续 DeepSeek。" : "语音转写失败，请检查火山方舟 Key、模型是否开通、音频大小，或改用手动输入。"
    });
  } else {
    steps.push(skipStep("13. 是否能调用豆包语音转写", "音频未生成。"));
  }

  if (transcript) {
    try {
      deepseekContent = await generateWithDeepSeek({
        type: "link_deconstruction_rewrite",
        input: {
          transcript,
          targetProduct: "测试产品",
          targetAudience: "测试人群",
          rewriteGoal: "成交",
          rewriteStyle: "口语化"
        }
      });
      steps.push({
        stepName: "14. 是否能调用 DeepSeek 拆片仿写",
        status: "success",
        command: "generateWithDeepSeek(link_deconstruction_rewrite)",
        stdoutSummary: summarize(deepseekContent),
        stderrSummary: "",
        nextSuggestion: "DeepSeek 正常。"
      });
    } catch (error) {
      steps.push({
        stepName: "14. 是否能调用 DeepSeek 拆片仿写",
        status: "failed",
        command: "generateWithDeepSeek(link_deconstruction_rewrite)",
        stdoutSummary: "",
        stderrSummary: summarize(error instanceof Error ? error.message : "DeepSeek 失败"),
        nextSuggestion: "请检查 DeepSeek Key 或模型配置。"
      });
    }
  } else {
    steps.push(skipStep("14. 是否能调用 DeepSeek 拆片仿写", "没有逐字稿。"));
  }

  const chromeProfiles = await detectChromeProfiles();
  const failedDownloadStep = steps.find((step) => step.stepName.startsWith("11.") && step.status === "failed");
  const success = Boolean(videoPath && audioPath && transcript && deepseekContent);

  return {
    success,
    input,
    extractedUrl,
    normalizedUrl,
    platform,
    redirectedUrl,
    chromeProfiles: chromeProfiles.map((profile) => ({ name: profile.name, hasCookies: profile.hasCookies })),
    ytDlpAttempts,
    videoPath,
    audioPath,
    transcriptPreview: summarize(transcript),
    deepseekPreview: summarize(deepseekContent),
    finalReason: success ? "完整链路成功。" : failedDownloadStep?.stdoutSummary || failedDownloadStep?.stderrSummary || "链路未完整跑通。",
    finalSuggestion: success ? "可以使用链接分析。" : "当前最可靠方案是上传视频；如必须链接下载，请导出 fresh cookies.txt 并配置 YTDLP_COOKIES_FILE。",
    steps
  };
}

function commandStep(stepName: string, result: Awaited<ReturnType<typeof runCommand>>, command: string, successSuggestion: string, failSuggestion: string): DebugStep {
  return {
    stepName,
    status: result.ok ? "success" : "failed",
    command,
    stdoutSummary: summarize(result.stdout),
    stderrSummary: summarize(result.stderr || result.error),
    nextSuggestion: result.ok ? successSuggestion : failSuggestion
  };
}

function skipStep(stepName: string, reason: string): DebugStep {
  return {
    stepName,
    status: "skipped",
    command: "",
    stdoutSummary: "",
    stderrSummary: reason,
    nextSuggestion: reason
  };
}

async function runCommand(command: string, args: string[], timeout = 10000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, maxBuffer: 1024 * 1024 * 12 });
    return { ok: true, stdout: String(stdout || ""), stderr: String(stderr || ""), error: "" };
  } catch (error) {
    const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
    return {
      ok: false,
      stdout: typeof record.stdout === "string" ? record.stdout : "",
      stderr: typeof record.stderr === "string" ? record.stderr : "",
      error: error instanceof Error ? error.message : "命令执行失败"
    };
  }
}

async function resolveRedirect(url: string) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
      },
      signal: AbortSignal.timeout(10000)
    });
    return { ok: true, url: response.url || url, error: "" };
  } catch (error) {
    return { ok: false, url: "", error: error instanceof Error ? error.message : "短链跳转解析失败" };
  }
}

async function fileExists(filePath: string) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function summarize(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 700);
}

export { fileExists };
