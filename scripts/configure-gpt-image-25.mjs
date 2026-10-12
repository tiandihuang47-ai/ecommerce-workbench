#!/usr/bin/env node
/*
 * GPT Image 2.5 安全配置向导
 *
 * 作用：把 API Key / Base URL / Model ID 写入本机权限隔离配置
 *       <项目>/.director-platform-data/commerce-image/providers.json
 *       （与「系统设置」页面写入的是同一个文件、同一套字段）
 *
 * 安全：
 *   - API Key 采用隐藏输入（不回显），也不会写进任何日志或输出
 *   - 全程只显示掩码（长度 + 前 8 位）
 *   - 文件权限 0600，原子写入（先写临时文件再改名）
 *   - 不修改 .env.local，不修改已验证的其他模型配置
 *
 * 用法：
 *   node scripts/configure-gpt-image-25.mjs            # 交互式配置
 *   node scripts/configure-gpt-image-25.mjs --check    # 只看当前状态（不修改）
 *   node scripts/configure-gpt-image-25.mjs --test     # 配置完后立即跑直连测试
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = process.cwd();
// 与 src/lib/commerce-image-config.ts 的 commerceImageDataRoot() 保持一致：
// COMMERCE_IMAGE_DATA_DIR 优先，否则用 <cwd>/.director-platform-data/commerce-image
const CONFIG_DIR = process.env.COMMERCE_IMAGE_DATA_DIR
  ? path.resolve(process.env.COMMERCE_IMAGE_DATA_DIR)
  : path.join(ROOT, ".director-platform-data", "commerce-image");
const CONFIG_PATH = path.join(CONFIG_DIR, "providers.json");

const DEFAULTS = {
  baseUrl: "https://origingateway.com/v1",
  modelId: "gpt-image-2.5-sunburst-4k"
};

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const runTestAfter = args.includes("--test");

const mask = (value) => (value ? `${value.slice(0, 8)}*** （长度 ${value.length}）` : "（未配置）");

function setEcho(enabled) {
  try {
    execFileSync("stty", [enabled ? "echo" : "-echo"], { stdio: ["inherit", "ignore", "ignore"] });
  } catch {
    /* 非 TTY 环境忽略 */
  }
}

/*
 * 输入实现说明（踩过的坑）：
 * 1. 不能在每次提问时新建再 close() readline —— 会关掉底层 stdin。
 * 2. 也不能只用一个 readline 反复调用 rl.question()：当 stdin 是管道时，
 *    readline 会在同一轮事件循环里把剩余行全部 emit 掉，此时还没有注册
 *    对应回调，这些行就被丢弃，表现为「卡在第二个问题」。
 * 因此这里自己维护一个行队列，两种输入方式都可靠。
 * 3. terminal: false 让 readline 不回显；可见输入靠终端自身的 echo，
 *    隐藏输入靠 stty -echo 关闭回显。
 */
let sharedInterface = null;
const lineQueue = [];
const lineWaiters = [];

function getInterface() {
  if (!sharedInterface) {
    sharedInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
    sharedInterface.on("line", (line) => {
      if (lineWaiters.length) lineWaiters.shift()(line);
      else lineQueue.push(line);
    });
  }
  return sharedInterface;
}

function nextLine() {
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  return new Promise((resolve) => lineWaiters.push(resolve));
}

async function ask(question, { hidden = false, defaultValue = "" } = {}) {
  getInterface();
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const isTty = Boolean(process.stdin.isTTY);

  process.stdout.write(`${question}${suffix}: `);
  if (hidden && isTty) setEcho(false);

  const answer = await nextLine();

  if (hidden && isTty) {
    setEcho(true);
    process.stdout.write("\n");
  }
  return String(answer).trim() || defaultValue;
}

function closeInterface() {
  try { sharedInterface?.close(); } catch { /* 忽略 */ }
}

function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return {
      version: 2,
      providers: parsed?.providers && typeof parsed.providers === "object" ? parsed.providers : {},
      assistants: parsed?.assistants && typeof parsed.assistants === "object" ? parsed.assistants : {}
    };
  } catch {
    return { version: 2, providers: {}, assistants: {} };
  }
}

function writeConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const temp = `${CONFIG_PATH}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, CONFIG_PATH);
  try { chmodSync(CONFIG_PATH, 0o600); } catch { /* 忽略 */ }
}

function showStatus() {
  const config = readConfig();
  console.log(`配置文件：${CONFIG_PATH}`);
  console.log(`配置文件存在：${existsSync(CONFIG_PATH) ? "是" : "否"}`);
  console.log("");
  const entry = config.providers?.openai_v25 || {};
  console.log("【GPT Image 2.5】");
  console.log(`  API Key : ${mask(entry.apiKey)}`);
  console.log(`  Base URL: ${entry.baseUrl || `（未配置，将回退到 ${DEFAULTS.baseUrl}）`}`);
  console.log(`  Model ID: ${entry.modelId || `（未配置，将回退到 ${DEFAULTS.modelId}）`}`);
  console.log(`  已落盘验证时间: ${entry.lastVerifiedAt || "（从未验证）"}`);
  console.log("");
  console.log("其他已配置的模型：");
  for (const [name, value] of Object.entries(config.providers || {})) {
    if (name === "openai_v25") continue;
    console.log(`  ${name}: API Key ${value?.apiKey ? "已配置" : "未配置"}`);
  }
}

async function main() {
  console.log("");
  console.log("========================================");
  console.log("   GPT Image 2.5（Sunburst）配置向导");
  console.log("========================================");
  console.log(`项目目录：${ROOT}`);
  console.log("");

  if (checkOnly) {
    showStatus();
    console.log("（--check 模式：未做任何修改）");
    return;
  }

  showStatus();
  console.log("");
  console.log("接下来依次输入三项。API Key 输入时不会显示任何字符，属于正常现象。");
  console.log("直接回车表示沿用方括号里的默认值。");
  console.log("");

  const apiKey = await ask("1/3 请输入 OriginGateway 的 API Key（输入时不显示）", { hidden: true });
  if (!apiKey) {
    console.log("");
    console.log("❌ 没有输入 API Key，已取消，未做任何修改。");
    process.exitCode = 2;
    return;
  }

  const baseUrl = await ask("2/3 请输入 Base URL", { defaultValue: DEFAULTS.baseUrl });
  const modelId = await ask("3/3 请输入 Model ID", { defaultValue: DEFAULTS.modelId });

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  console.log("");
  console.log("即将写入以下配置（Key 已掩码）：");
  console.log(`  API Key : ${mask(apiKey)}`);
  console.log(`  Base URL: ${normalizedBaseUrl}`);
  console.log(`  Model ID: ${modelId}`);
  console.log("");

  const confirm = await ask("确认写入？输入 y 回车继续，其他任意键取消", { defaultValue: "y" });
  if (confirm.toLowerCase() !== "y") {
    console.log("已取消，未做任何修改。");
    return;
  }

  const config = readConfig();
  const previous = config.providers?.openai_v25 || {};
  const changed = previous.apiKey !== apiKey
    || previous.baseUrl !== normalizedBaseUrl
    || previous.modelId !== modelId;

  config.providers.openai_v25 = {
    ...previous,
    apiKey,
    workspaceId: previous.workspaceId || "",
    baseUrl: normalizedBaseUrl,
    modelId,
    // 配置发生变化时，旧的「已验证」状态必须失效
    lastVerifiedAt: changed ? "" : (previous.lastVerifiedAt || ""),
    verificationFingerprint: changed ? "" : (previous.verificationFingerprint || "")
  };

  writeConfig(config);

  console.log("");
  console.log("✅ 配置已写入本机权限隔离目录（文件权限 0600）。");
  console.log("   文件位置：.director-platform-data/commerce-image/providers.json");
  console.log("   提示：该目录已被 .gitignore 忽略，不会进入 Git。");
  console.log("");

  showStatus();

  if (runTestAfter) {
    console.log("");
    console.log("正在运行最小直连测试…");
    console.log("");
    closeInterface();
    const { spawnSync } = await import("node:child_process");
    spawnSync(process.execPath, [path.join(ROOT, "scripts", "test-gpt-image-25-direct.mjs")], {
      stdio: "inherit",
      cwd: ROOT
    });
  } else {
    console.log("");
    console.log("下一步：运行下面的命令做真实出图验证（会真实计费）：");
    console.log("   node scripts/test-gpt-image-25-direct.mjs");
    console.log("或双击项目根目录的「测试GPT-Image-2.5.command」。");
  }
}

main()
  .catch((error) => {
    console.error("");
    console.error("配置过程出错：", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeInterface());
