#!/usr/bin/env node
/**
 * 硬编码模型名 / AI Key 直接读取检查（CI 用）
 *
 * 检查一：硬编码模型名
 *   - 读 config/models.yaml，取所有 model_id 字符串（唯一事实来源）。
 *   - 扫描 src/ 下 .ts/.tsx，找出 " 或 ' 包裹的、完全等于某个 model_id 的字符串字面量。
 *   - 允许清单（不报错）：src/lib/commerce-image-models.ts（生图 UI 标签/画质表，登记过的例外）；
// 生图接口的取值联合类型（CommerceImageModel）必须写成字面量，运行时默认模型仍来自 config/model-routing.yaml。
// 见 docs/MODEL_ROUTING.md「已知例外」。
 *     以及 docs/、config/、scripts/（本脚本只扫 src/，列出以示边界）。
 *   - 输出每个违规点 file:line。
 *
 * 检查二：AI Key 直接读取
 *   - 扫描 src/ 下 process.env.<AI_KEY> 或 process.env["<AI_KEY>"]（AI_KEY 取自 models.yaml
 *     里 provider 的 api_key_env / api_key_fallback_env）。
 *   - 允许清单：src/lib/model-router/、src/lib/deepseek-client.ts、src/lib/doubao-asr.ts、
 *     src/lib/commerce-image-config.ts、src/lib/opus-chat-service.ts（provider/config 层）。
 *   - 其它业务文件出现即报违规。
 *
 * 用法：node scripts/check-model-routing.mjs
 * 有任意违规 → 打印 file:line 并 exit 1；全部干净 → 打印 OK 并 exit 0。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcDir = path.join(root, "src");
const modelsPath = path.join(root, "config", "models.yaml");

// ---- 允许清单 ---------------------------------------------------------
const MODEL_ALLOWLIST_FILES = new Set([
  "src/lib/commerce-image-models.ts",
  /* 生图接口的取值联合类型 CommerceImageModel 只能写成字面量（TS 类型无法读 YAML）；
   * 运行时默认模型来自 config/model-routing.yaml，见 docs/MODEL_ROUTING.md「已知例外」。 */
  "src/lib/commerce-image-types.ts"
]);
const MODEL_ALLOWLIST_DIRS = ["docs/", "config/", "scripts/"];

const KEY_ALLOWLIST_FILES = new Set([
  "src/lib/deepseek-client.ts",
  "src/lib/doubao-asr.ts",
  "src/lib/commerce-image-config.ts",
  "src/lib/opus-chat-service.ts"
]);
const KEY_ALLOWLIST_DIRS = ["src/lib/model-router/"];

// ---- 读取 models.yaml（真源）-----------------------------------------
const modelsDoc = parseYaml(readFileSync(modelsPath, "utf8")) || {};
const modelIds = new Set(
  Object.values(modelsDoc.models || {})
    .map((item) => String((item && item.model_id) || "").trim())
    .filter(Boolean)
);
const aiKeyEnvs = new Set();
for (const provider of Object.values(modelsDoc.providers || {})) {
  for (const field of ["api_key_env", "api_key_fallback_env"]) {
    const name = provider && provider[field];
    if (name) aiKeyEnvs.add(String(name).trim());
  }
}

if (!modelIds.size) {
  console.error("错误：config/models.yaml 里没有解析到任何 model_id。");
  process.exit(2);
}

// ---- 工具 -------------------------------------------------------------
function toRel(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function isAllowed(rel, files, dirs) {
  return files.has(rel) || dirs.some((dir) => rel.startsWith(dir));
}

function listSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    const info = statSync(absolute);
    if (info.isDirectory()) files.push(...listSourceFiles(absolute));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(absolute);
  }
  return files;
}

function lineOf(content, index) {
  return content.slice(0, index).split("\n").length;
}

function scanHardcodedModelIds(absolute, rel) {
  if (isAllowed(rel, MODEL_ALLOWLIST_FILES, MODEL_ALLOWLIST_DIRS)) return [];
  const content = readFileSync(absolute, "utf8");
  const violations = [];
  // 只匹配 " 或 ' 包裹的字符串字面量；再判断是否完全等于某个 model_id。
  const pattern = /"([^"\n]*)"|'([^'\n]*)'/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const literal = match[1] !== undefined ? match[1] : match[2];
    if (!modelIds.has(literal)) continue;
    violations.push({ file: rel, line: lineOf(content, match.index), value: literal });
  }
  return violations;
}

function scanDirectAiKeys(absolute, rel) {
  if (isAllowed(rel, KEY_ALLOWLIST_FILES, KEY_ALLOWLIST_DIRS)) return [];
  const content = readFileSync(absolute, "utf8");
  const violations = [];
  const pattern = /process\.env\.([A-Za-z0-9_]+)|process\.env\[\s*["']([A-Za-z0-9_]+)["']\s*\]/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1] !== undefined ? match[1] : match[2];
    if (!aiKeyEnvs.has(name)) continue;
    violations.push({ file: rel, line: lineOf(content, match.index), value: name });
  }
  return violations;
}

// ---- 扫描 -------------------------------------------------------------
const modelViolations = [];
const keyViolations = [];
for (const absolute of listSourceFiles(srcDir)) {
  const rel = toRel(absolute);
  modelViolations.push(...scanHardcodedModelIds(absolute, rel));
  keyViolations.push(...scanDirectAiKeys(absolute, rel));
}

const byLocation = (a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file));
modelViolations.sort(byLocation);
keyViolations.sort(byLocation);

// ---- 报告 -------------------------------------------------------------
console.log("模型名真源 config/models.yaml：" + modelIds.size + " 个 model_id。");
console.log("AI Key 环境变量真源（providers）：" + [...aiKeyEnvs].join(", "));
console.log("");

if (!modelViolations.length && !keyViolations.length) {
  console.log("OK：src/ 下没有硬编码模型名，也没有违规的 AI Key 直接读取。");
  process.exit(0);
}

if (modelViolations.length) {
  console.log("发现硬编码模型名：" + modelViolations.length + " 处");
  for (const item of modelViolations) {
    console.log("  " + item.file + ":" + item.line + "  " + item.value);
  }
} else {
  console.log("硬编码模型名：0 处。");
}
console.log("");

if (keyViolations.length) {
  console.log("发现违规的 AI Key 直接读取：" + keyViolations.length + " 处");
  for (const item of keyViolations) {
    console.log("  " + item.file + ":" + item.line + "  " + item.value);
  }
} else {
  console.log("违规的 AI Key 直接读取：0 处。");
}

const files = [...new Set([...modelViolations, ...keyViolations].map((item) => item.file))].sort();
console.log("");
console.log("涉及文件（" + files.length + "）：");
for (const file of files) console.log("  - " + file);

process.exit(1);
