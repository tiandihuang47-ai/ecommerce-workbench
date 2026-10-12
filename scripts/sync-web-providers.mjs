#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * 把桌面 App 数据根里已配置好的生图服务 / AI 助手配置，
 * 合并同步到网页版服务的数据根（局域网同事共用出图，Key 只保留在这台 Mac 上）。
 *
 *   源（桌面 App）：~/Library/Application Support/director-platform/director-platform-data/commerce-image/providers.json
 *   目标（网页版）：<项目>/.director-platform-data/commerce-image/providers.json
 *
 * 规则：
 *   - 桌面条目优先，网页端独有的条目保留；
 *   - 原子写（temp + rename），目录 0700、文件 0600；
 *   - 输出绝不包含任何 Key 明文；
 *   - 网页服务每次生图调用都会重新读这份文件，同步后立即生效，无需重启服务。
 */

const LABEL = "同步生图配置到网页版";

const desktopDefault = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "director-platform",
  "director-platform-data",
  "commerce-image"
);
const webDefault = process.env.COMMERCE_IMAGE_DATA_DIR
  ? path.resolve(process.env.COMMERCE_IMAGE_DATA_DIR)
  : path.join(process.cwd(), ".director-platform-data", "commerce-image");

function parseArgs(argv) {
  const args = { from: "", to: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--from") args.from = argv[index + 1] || "";
    if (argv[index] === "--to") args.to = argv[index + 1] || "";
  }
  return args;
}

function readConfig(configDir) {
  const file = path.join(configDir, "providers.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return {
    file,
    version: 2,
    providers: raw.providers && typeof raw.providers === "object" ? raw.providers : {},
    assistants: raw.assistants && typeof raw.assistants === "object" ? raw.assistants : {}
  };
}

function describeEntry(entry) {
  if (!entry || typeof entry !== "object") return "空";
  return [
    entry.apiKey ? "apiKey ✓" : "apiKey ✗",
    entry.baseUrl ? "baseUrl ✓" : "baseUrl ✗",
    entry.modelId ? "modelId ✓" : "modelId ✗"
  ].join("，");
}

function writeConfigAtomic(configDir, config) {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const target = path.join(configDir, "providers.json");
  const temp = path.join(configDir, `providers.json.${Date.now()}.tmp`);
  writeFileSync(temp, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, target);
  const mode = statSync(target).mode & 0o777;
  return { target, mode: mode.toString(8) };
}

function mergeSection(name, sourceSection, targetSection) {
  const merged = { ...targetSection };
  let copied = 0;
  for (const [key, entry] of Object.entries(sourceSection || {})) {
    if (!entry || typeof entry !== "object") continue;
    const had = merged[key] && typeof merged[key] === "object" ? merged[key] : null;
    const same = had && JSON.stringify(had) === JSON.stringify(entry);
    merged[key] = { ...(had || {}), ...entry };
    if (!same) copied += 1;
    console.log(`  ${name}.${key}：${describeEntry(merged[key])}${had ? (same ? "（已一致）" : "（桌面端覆盖）") : "（新增）"}`);
  }
  for (const key of Object.keys(merged)) {
    if (!merged[key] || typeof merged[key] !== "object") delete merged[key];
  }
  return { merged, copied };
}

const args = parseArgs(process.argv.slice(2));
const sourceDir = args.from || desktopDefault;
const targetDir = args.to || webDefault;

console.log("========================================");
console.log(`   编导中台 · ${LABEL}`);
console.log("========================================");
console.log("");
console.log(`来源（桌面 App）：${sourceDir}`);
console.log(`目标（网页版）  ：${targetDir}`);
console.log("");

let source;
try {
  source = readConfig(sourceDir);
} catch (error) {
  console.error(`❌ 读取桌面 App 配置失败：${error.message}`);
  console.error("   请确认这台电脑上桌面 App 已经配置过生图服务（系统设置 → 生图模型）。");
  process.exit(1);
}

let target;
try {
  target = readConfig(targetDir);
} catch {
  target = { file: path.join(targetDir, "providers.json"), version: 2, providers: {}, assistants: {} };
  console.log("目标文件不存在或不可读，将按来源整体创建。");
}

console.log("");
console.log("【生图服务 providers】");
const providers = mergeSection("providers", source.providers, target.providers);
console.log("");
console.log("【AI 助手 assistants】");
const assistants = mergeSection("assistants", source.assistants, target.assistants);

const { target: written, mode } = writeConfigAtomic(targetDir, {
  version: 2,
  providers: providers.merged,
  assistants: assistants.merged
});

console.log("");
console.log(`✅ 已写入 ${written}（权限 ${mode}）。`);
console.log("   网页版生图立即使用最新配置，无需重启网页服务。");
console.log("   Key 只保存在这台 Mac 的本地文件里，网页端只显示掩码，不会返回明文。");
if (!providers.merged.openai_v25?.apiKey) {
  console.log("");
  console.log("⚠ 提醒：openai_v25（GPT Image 2.5）还没有 Key。请先在桌面 App 的系统设置里配置，再重新运行本同步。");
}
