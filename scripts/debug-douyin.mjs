#!/usr/bin/env node
import { execFile } from "node:child_process";
import fsSync from "node:fs";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
loadEnvLocal(path.join(projectRoot, ".env.local"));

const input = process.argv.slice(2).join(" ").trim();
const tempDir = process.env.TEMP_FILE_DIR || "/tmp/director-platform";
const steps = [];

if (!input) {
  console.error("用法：npm run debug:douyin \"抖音链接或分享文案\"");
  process.exit(1);
}

const pureUrl = extractFirstUrl(input);
const normalizedUrl = normalizeUrl(input);
const platform = detectPlatform(normalizedUrl);
const profiles = await detectChromeProfiles();
let redirectedUrl = "";
let videoPath = "";
let audioPath = "";
let transcript = "";
let deepseek = "";

await fs.mkdir(tempDir, { recursive: true });

const ytVersion = await runCommand("yt-dlp", ["--version"]);
pushCommandStep("1. 是否安装 yt-dlp", ytVersion, "yt-dlp --version", "yt-dlp 已安装。", "请执行 brew install yt-dlp。");
pushCommandStep("2. yt-dlp 版本号", ytVersion, "yt-dlp --version", "版本可用。", "版本不可用。");

const ffVersion = await runCommand("ffmpeg", ["-version"]);
pushCommandStep("3. 是否安装 ffmpeg", ffVersion, "ffmpeg -version", "ffmpeg 已安装。", "请执行 brew install ffmpeg。");
pushStep("4. ffmpeg 版本号", ffVersion.ok ? "success" : "failed", "ffmpeg -version", firstLine(ffVersion.stdout), summarize(ffVersion.stderr || ffVersion.error), ffVersion.ok ? "版本可用。" : "版本不可用。");

pushStep("5. 是否能从用户输入中提取纯 URL", pureUrl ? "success" : "failed", "extractFirstUrl(input)", pureUrl, "", pureUrl ? "只会把这个纯 URL 传给 yt-dlp。" : "没有找到 URL，请复制包含 https://v.douyin.com/... 的分享文案。");
pushStep("6. 是否能识别为 douyin", platform === "douyin" ? "success" : "failed", "detectPlatform(url)", platform, "", platform === "douyin" ? "已识别为抖音。" : "不是抖音链接。");

if (pureUrl) {
  const redirect = await resolveRedirect(normalizedUrl);
  redirectedUrl = redirect.url;
  pushStep("7. 是否能解析短链跳转后的真实 URL", redirect.ok ? "success" : "failed", `HEAD ${normalizedUrl}`, redirectedUrl, redirect.error, redirect.ok && redirectedUrl.includes("/video/") ? "短链跳到了视频详情页。" : "短链未跳到视频详情页，可能过期或被风控。");
} else {
  pushSkipped("7. 是否能解析短链跳转后的真实 URL", "没有纯 URL。");
}

const downloadTemplate = path.join(tempDir, `debug_douyin_${Date.now()}_%(id)s.%(ext)s`);
const directArgs = ["--verbose", "--no-playlist", "--no-part", "--restrict-filenames", "-f", "bv*+ba/best", "-o", downloadTemplate, normalizedUrl];

if (platform === "douyin") {
  const direct = await runYtDlpDownload("不带 Cookie", directArgs);
  pushCommandStep("8. 不带 Cookie 运行 yt-dlp 是否成功", direct, sanitizeCommand(["yt-dlp", ...directArgs]), "不带 Cookie 下载成功。", "不带 Cookie 失败，继续尝试 Cookie。");
  videoPath = direct.filePath || "";

  if (!videoPath) {
    const chromeArgs = ["--verbose", "--cookies-from-browser", "chrome", ...directArgs.slice(1)];
    const chrome = await runYtDlpDownload("Chrome Cookie", chromeArgs);
    pushCommandStep("9. 带 Chrome Cookie 运行 yt-dlp 是否成功", chrome, sanitizeCommand(["yt-dlp", ...chromeArgs]), "Chrome Cookie 下载成功。", "Chrome Cookie 失败，可能 Cookie 过期、未登录或钥匙串未授权。");
    videoPath = chrome.filePath || "";
  } else {
    pushSkipped("9. 带 Chrome Cookie 运行 yt-dlp 是否成功", "前一步已成功。");
  }

  if (!videoPath) {
    let profileSuccess = false;
    for (const profile of profiles.filter((item) => item.hasCookies)) {
      const profileArgs = ["--verbose", "--cookies-from-browser", `chrome:${profile.name}`, ...directArgs.slice(1)];
      const profileResult = await runYtDlpDownload(`Chrome Profile ${profile.name}`, profileArgs);
      pushCommandStep(`10. 带指定 Chrome Profile 运行 yt-dlp：${profile.name}`, profileResult, sanitizeCommand(["yt-dlp", ...profileArgs]), `${profile.name} 下载成功。`, `${profile.name} 失败。`);
      if (profileResult.filePath) {
        videoPath = profileResult.filePath;
        profileSuccess = true;
        break;
      }
    }
    if (!profileSuccess && !profiles.some((item) => item.hasCookies)) {
      pushStep("10. 带指定 Chrome Profile 运行 yt-dlp 是否成功", "failed", "detectChromeProfiles()", profiles.map((item) => `${item.name}: cookies=${item.hasCookies}`).join("；"), "", "没有找到带 Cookies 的 Chrome Profile。");
    }
  } else {
    pushSkipped("10. 带指定 Chrome Profile 运行 yt-dlp 是否成功", "前一步已成功。");
  }

  if (!videoPath && process.env.YTDLP_COOKIES_FILE) {
    const cookieArgs = ["--verbose", "--cookies", process.env.YTDLP_COOKIES_FILE, ...directArgs.slice(1)];
    const cookieFile = await runYtDlpDownload("cookies.txt", cookieArgs);
    pushCommandStep("10b. cookies.txt 运行 yt-dlp 是否成功", cookieFile, sanitizeCommand(["yt-dlp", ...cookieArgs]), "cookies.txt 下载成功。", "cookies.txt 失败，请确认 cookies 文件新鲜且路径正确。");
    videoPath = cookieFile.filePath || "";
  }
} else {
  pushSkipped("8. 不带 Cookie 运行 yt-dlp 是否成功", "不是有效抖音链接。");
  pushSkipped("9. 带 Chrome Cookie 运行 yt-dlp 是否成功", "不是有效抖音链接。");
  pushSkipped("10. 带指定 Chrome Profile 运行 yt-dlp 是否成功", "不是有效抖音链接。");
}

pushStep("11. 是否成功下载视频文件", videoPath && existsSync(videoPath) ? "success" : "failed", "yt-dlp download", videoPath, "", videoPath ? "视频文件存在，继续提取音频。" : "视频下载失败，建议上传视频或配置 fresh cookies.txt。");

if (videoPath && existsSync(videoPath)) {
  audioPath = path.join(tempDir, `debug_audio_${Date.now()}.mp3`);
  const ffmpeg = await runCommand("ffmpeg", ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-q:a", "4", audioPath], 300000);
  pushCommandStep("12. 是否成功用 ffmpeg 提取音频", ffmpeg, `ffmpeg -i ${videoPath} ...`, "音频提取成功。", "音频提取失败。");
  if (!ffmpeg.ok) audioPath = "";
} else {
  pushSkipped("12. 是否成功用 ffmpeg 提取音频", "视频未下载成功。");
}

if (audioPath && existsSync(audioPath)) {
  const asr = await transcribeAudioWithAliyun(audioPath);
  transcript = asr.transcript;
  pushStep("13. 是否能调用阿里云 ASR 转文字", asr.success ? "success" : "failed", "DashScope ASR", summarize(transcript), asr.success ? "" : asr.message, asr.success ? "ASR 成功。" : "ASR 失败，请检查 API Key、模型或音频大小。");
} else {
  pushSkipped("13. 是否能调用阿里云 ASR 转文字", "音频未生成。");
}

if (transcript) {
  const ds = await callDeepSeek(transcript);
  deepseek = ds.content;
  pushStep("14. 是否能调用 DeepSeek 拆片仿写", ds.ok ? "success" : "failed", "DeepSeek Chat Completions", summarize(deepseek), ds.error, ds.ok ? "DeepSeek 成功。" : "DeepSeek 失败，请检查 API Key/模型。");
} else {
  pushSkipped("14. 是否能调用 DeepSeek 拆片仿写", "没有逐字稿。");
}

printReport();
process.exit(steps.every((step) => step.status !== "failed") ? 0 : 1);

function pushStep(stepName, status, command, stdoutSummary, stderrSummary, nextSuggestion) {
  steps.push({ stepName, status, command, stdoutSummary: summarize(stdoutSummary), stderrSummary: summarize(stderrSummary), nextSuggestion });
}

function pushSkipped(stepName, reason) {
  pushStep(stepName, "skipped", "", "", reason, reason);
}

function pushCommandStep(stepName, result, command, successSuggestion, failSuggestion) {
  pushStep(stepName, result.ok ? "success" : "failed", command, result.stdout, result.stderr || result.error, result.ok ? successSuggestion : failSuggestion);
}

async function runYtDlpDownload(strategy, args) {
  const before = new Set(await listTempFiles());
  const result = await runCommand("yt-dlp", args, 600000);
  const after = await listTempFiles();
  const created = after.filter((file) => !before.has(file));
  const filePath = created.sort((a, b) => fsStatMtime(b) - fsStatMtime(a))[0] || "";
  return { ...result, strategy, filePath };
}

function fsStatMtime(filePath) {
  try {
    return existsSync(filePath) ? Number(requireStatSync(filePath).mtimeMs) : 0;
  } catch {
    return 0;
  }
}

function requireStatSync(filePath) {
  return fsSync.statSync(filePath);
}

async function listTempFiles() {
  try {
    const names = await fs.readdir(tempDir);
    return names.map((name) => path.join(tempDir, name));
  } catch {
    return [];
  }
}

async function runCommand(command, args, timeout = 30000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, maxBuffer: 1024 * 1024 * 20 });
    return { ok: true, stdout: String(stdout || ""), stderr: String(stderr || ""), error: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr: typeof error?.stderr === "string" ? error.stderr : "",
      error: error instanceof Error ? error.message : "命令执行失败"
    };
  }
}

async function resolveRedirect(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36" },
      signal: AbortSignal.timeout(10000)
    });
    return { ok: true, url: response.url || url, error: "" };
  } catch (error) {
    return { ok: false, url: "", error: error instanceof Error ? error.message : "短链跳转失败" };
  }
}

async function transcribeAudioWithAliyun(audioPath) {
  if (!process.env.ALIYUN_API_KEY) return { success: false, transcript: "", message: "未配置 ALIYUN_API_KEY" };
  const file = await fs.readFile(audioPath);
  const maxBytes = Number(process.env.ALIYUN_ASR_DIRECT_MAX_BYTES || 10 * 1024 * 1024);
  if (file.length > maxBytes) return { success: false, transcript: "", message: `音频超过小文件直传上限：${file.length} bytes` };
  const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.ALIYUN_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.ALIYUN_ASR_DIRECT_MODEL || "qwen3-asr-flash",
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: `data:audio/mpeg;base64,${file.toString("base64")}` } }] }],
      temperature: 0
    })
  });
  const payload = await response.json().catch(() => ({}));
  const transcript = payload?.choices?.[0]?.message?.content || payload?.output?.text || "";
  return { success: response.ok && Boolean(transcript), transcript: String(transcript), message: response.ok ? "" : JSON.stringify(payload).slice(0, 500) };
}

async function callDeepSeek(transcript) {
  if (!process.env.DEEPSEEK_API_KEY) return { ok: false, content: "", error: "未配置 DEEPSEEK_API_KEY" };
  try {
    const response = await fetch(`${process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: "你是短视频拆片专家。不要复制原文，只拆结构并原创仿写。辅助画面一律使用“画中画”这个中文术语。" },
          { role: "user", content: `逐字稿：${transcript}\n目标产品：测试产品\n目标人群：测试人群\n请输出拆片和仿写脚本。` }
        ],
        temperature: 0.7
      })
    });
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || "";
    return { ok: response.ok && Boolean(content), content: String(content), error: response.ok ? "" : JSON.stringify(payload).slice(0, 500) };
  } catch (error) {
    return { ok: false, content: "", error: error instanceof Error ? error.message : "DeepSeek 请求失败" };
  }
}

function extractFirstUrl(value) {
  const text = value.trim();
  const directUrl = text.match(/https?:\/\/[^\s，。；;）)\]}]+/i)?.[0];
  if (directUrl) return cleanUrl(directUrl);
  const domainUrl = text.match(/(?:www\.)?(?:v\.)?douyin\.com\/[^\s，。；;）)\]}]+/i)?.[0];
  return domainUrl ? cleanUrl(domainUrl) : "";
}

function cleanUrl(value) {
  return value.replace(/[，。；;、,.!?！？）)\]}]+$/g, "").trim();
}

function normalizeUrl(value) {
  const url = extractFirstUrl(value);
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("douyin.com") || host.includes("iesdouyin.com") ? "douyin" : "unknown";
  } catch {
    return "unknown";
  }
}

async function detectChromeProfiles() {
  const root = path.join(os.homedir(), "Library/Application Support/Google/Chrome");
  try {
    const entries = await fs.readdir(root);
    const profiles = [];
    for (const name of entries.filter((entry) => entry === "Default" || /^Profile \d+$/.test(entry))) {
      const networkCookiesPath = path.join(root, name, "Network", "Cookies");
      const legacyCookiesPath = path.join(root, name, "Cookies");
      profiles.push({ name, hasCookies: existsSync(networkCookiesPath) || existsSync(legacyCookiesPath) });
    }
    return profiles.sort((a, b) => (a.name === "Default" ? -1 : b.name === "Default" ? 1 : a.name.localeCompare(b.name)));
  } catch {
    return [];
  }
}

function sanitizeCommand(parts) {
  return parts.map((part, index) => parts[index - 1] === "--cookies" ? "<cookies.txt路径已隐藏>" : part).join(" ");
}

function summarize(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= 700) return text;
  return `${text.slice(0, 260)} ... ${text.slice(-420)}`;
}

function firstLine(value) {
  return String(value || "").split("\n")[0] || "";
}

function loadEnvLocal(filePath) {
  if (!existsSync(filePath)) return;
  const content = fsSync.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function printReport() {
  console.log("\n抖音链接诊断报告");
  console.log("=".repeat(60));
  console.log(`输入：${input}`);
  console.log(`提取 URL：${pureUrl || "未提取到"}`);
  console.log(`平台：${platform}`);
  console.log(`短链跳转：${redirectedUrl || "未解析"}`);
  console.log(`Chrome Profiles：${profiles.map((p) => `${p.name}(cookies=${p.hasCookies})`).join("，") || "未发现"}`);
  console.log(`视频文件：${videoPath || "无"}`);
  console.log(`音频文件：${audioPath || "无"}`);
  console.log("\n步骤明细");
  for (const step of steps) {
    console.log("-".repeat(60));
    console.log(`step name: ${step.stepName}`);
    console.log(`status: ${step.status}`);
    console.log(`command: ${step.command}`);
    console.log(`stdout 摘要: ${step.stdoutSummary}`);
    console.log(`stderr 摘要: ${step.stderrSummary}`);
    console.log(`next suggestion: ${step.nextSuggestion}`);
  }
  console.log("=".repeat(60));
}
