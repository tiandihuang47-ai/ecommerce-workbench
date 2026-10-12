#!/usr/bin/env node
/*
 * GPT Image 2.5 (gpt-image-2.5-sunburst-4k @ OriginGateway) 最小直连测试
 *
 * 目的：绕过 commerce-image 业务链路，直接验证
 *       「当前 Key + 当前 Base URL + 当前 model」能否真实生图。
 *
 * 用法：
 *   node scripts/test-gpt-image-25-direct.mjs                  # 默认跑 文生图 + 图生图
 *   node scripts/test-gpt-image-25-direct.mjs --test=generations
 *   node scripts/test-gpt-image-25-direct.mjs --test=edits
 *   node scripts/test-gpt-image-25-direct.mjs --base-url=https://origingateway.com/v1
 *
 * 配置读取顺序（与 src/lib/commerce-image-config.ts 保持一致）：
 *   providers.json 的 providers.openai_v25 → 环境变量 ORIGIN_GATEWAY_* → 默认值
 *
 * 安全：任何时候都不打印 API Key 明文；响应体中的密钥与超长 base64 会被截断。
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, ".director-platform-data", "commerce-image", "providers.json");
const OUT_DIR = path.join(ROOT, ".director-platform-data", "gpt-image-25-direct");
const MODEL = process.env.COMMERCE_OPENAI_V25_MODEL || "gpt-image-2.5-sunburst-4k";
const DEFAULT_BASE_URL = "https://origingateway.com/v1";

const args = process.argv.slice(2);
const argValue = (name, fallback = "") => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const which = argValue("test", "both");

function readStoredConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return parsed?.providers?.openai_v25 || {};
  } catch {
    return {};
  }
}

const stored = readStoredConfig();
const apiKey = (stored.apiKey || "").trim()
  || (process.env.ORIGIN_GATEWAY_API_KEY || "").trim();
const rawBaseUrl = (argValue("base-url") || stored.baseUrl || process.env.ORIGIN_GATEWAY_BASE_URL || DEFAULT_BASE_URL)
  .replace(/\/+$/, "");
/* 与 src/lib/commerce-image-config.ts 的 normalizeOriginGatewayBaseUrl 一致：裸域名补 /v1。 */
const baseUrl = (() => {
  try {
    const url = new URL(rawBaseUrl);
    if (url.pathname === "" || url.pathname === "/") return `${rawBaseUrl}/v1`;
  } catch { /* 保持原值 */ }
  return rawBaseUrl;
})();

const maskKey = (value) => {
  if (!value) return "(未配置)";
  const prefix = value.slice(0, 8);
  return `已读取 · 长度 ${value.length} · 前缀 ${prefix}***`;
};

function redact(text) {
  return String(text)
    .replace(/(?:sk|ak)-[A-Za-z0-9_-]{6,}/g, "[已隐藏密钥]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/"(b64_json|base64|image_base64)"\s*:\s*"[^"]{80,}"/g, '"$1":"[base64 已截断]"')
    .slice(0, 1200);
}

/* ------------------------------------------------------------------ */
/* 输出目录                                                            */
/* ------------------------------------------------------------------ */
mkdirSync(OUT_DIR, { recursive: true });

const results = [];

async function checkReachability() {
  console.log("\n===== 0. 端点可达性（不带 Key，仅确认网络/路由）=====");
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: "probe" }),
      signal: AbortSignal.timeout(20_000)
    });
    const text = await response.text();
    console.log(`  endpoint : POST ${baseUrl}/images/generations`);
    console.log(`  HTTP     : ${response.status}`);
    console.log(`  body     : ${redact(text)}`);
    return true;
  } catch (error) {
    console.log(`  ❌ 不可达: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 结果落盘 + 真实性校验                                                */
/* ------------------------------------------------------------------ */
async function saveResult(label, payload) {
  // 1) base64 字段
  const b64 = [payload?.data?.[0]?.b64_json, payload?.data?.[0]?.base64, payload?.data?.[0]?.image_base64]
    .find((value) => typeof value === "string" && value.length > 100);
  // 2) url 字段
  const url = payload?.data?.[0]?.url
    || payload?.data?.map?.((item) => item?.url).find?.((value) => typeof value === "string")
    || payload?.url;

  let bytes = null;
  let source = "";
  if (b64) {
    bytes = Buffer.from(b64.replace(/^data:[^,]+,/, ""), "base64");
    source = "b64_json";
  } else if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    source = `url → 已下载 (${url.slice(0, 90)}…)`;
  } else {
    throw new Error("响应中没有 b64_json / base64 / url 任何一种图片字段");
  }

  const meta = await sharp(bytes).metadata();
  const file = path.join(OUT_DIR, `${label}.${meta.format || "png"}`);
  writeFileSync(file, bytes);
  console.log(`  图片字段来源 : ${source}`);
  console.log(`  图片字节数   : ${bytes.length}`);
  console.log(`  真实图片校验 : ${meta.format} ${meta.width}×${meta.height} ✅ 可解码`);
  console.log(`  已保存到     : ${file}`);
  return { bytes: bytes.length, width: meta.width, height: meta.height, format: meta.format, file };
}

function summarizeResponse(status, text) {
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* 非 JSON */ }
  console.log(`  HTTP status  : ${status}`);
  if (payload) {
    // 只打印结构，不打印数据
    const first = payload?.data?.[0];
    console.log(`  顶层字段     : ${Object.keys(payload).join(", ") || "(空)"}`);
    if (first) console.log(`  data[0] 字段 : ${Object.keys(first).join(", ")}`);
    if (payload.error) {
      console.log(`  error.code   : ${payload.error.code ?? "(无)"}`);
      console.log(`  error.type   : ${payload.error.type ?? "(无)"}`);
      console.log(`  error.message: ${redact(payload.error.message ?? "(无)")}`);
    }
    const requestId = payload.trace_id || payload.request_id || payload.id || payload.error?.trace_id;
    if (requestId) console.log(`  request id   : ${requestId}`);
  } else {
    console.log(`  body(raw)    : ${redact(text)}`);
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* 测试 1：纯文生图 POST /images/generations                            */
/* ------------------------------------------------------------------ */
async function testGenerations() {
  console.log("\n===== 测试 1：纯文生图 POST /images/generations =====");
  console.log(`  model    : ${MODEL}`);
  console.log(`  prompt   : 一只白色陶瓷杯放在木桌上，写实产品摄影，白底背景`);
  console.log(`  body     : { model, prompt }  ← 最小参数，不带 size / quality / n`);

  const started = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: "一只白色陶瓷杯放在木桌上，写实产品摄影，白底背景" }),
      signal: AbortSignal.timeout(240_000)
    });
  } catch (error) {
    console.log(`  ❌ 请求异常: ${error instanceof Error ? error.message : String(error)}`);
    results.push({ name: "文生图", ok: false, note: "请求异常" });
    return;
  }
  const text = await response.text();
  console.log(`  耗时         : ${Date.now() - started}ms`);
  const payload = summarizeResponse(response.status, text);

  if (!response.ok) {
    if (response.status === 401) {
      console.log("\n  ↳ 401 鉴权失败。请确认 ORIGIN_GATEWAY_API_KEY 是否有效（Authorization: Bearer <token>）。");
      console.log("    当前 Key 前缀见上方；若中转站要求其他鉴权头，请按其文档调整。");
    }
    results.push({ name: "文生图", ok: false, note: `HTTP ${response.status}` });
    return;
  }
  try {
    const saved = await saveResult("generations", payload);
    results.push({ name: "文生图", ok: true, note: `${saved.width}×${saved.height} ${saved.format} ${saved.bytes}B` });
  } catch (error) {
    console.log(`  ❌ 解析/保存失败: ${error instanceof Error ? error.message : String(error)}`);
    results.push({ name: "文生图", ok: false, note: "解析/保存失败" });
  }
}

/* ------------------------------------------------------------------ */
/* 测试 2：图生图 POST /images/edits (multipart/form-data)              */
/* ------------------------------------------------------------------ */
async function testEdits() {
  console.log("\n===== 测试 2：图生图 POST /images/edits (multipart/form-data) =====");

  // 生成一张合规的输入图（部分模型要求边长 > 10）
  const inputPath = path.join(OUT_DIR, "input-source.png");
  const inputPng = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 40, g: 90, b: 160 } }
  }).png().toBuffer();
  writeFileSync(inputPath, inputPng);
  console.log(`  输入图   : ${inputPath} (1024×1024 PNG, ${inputPng.length}B)`);
  console.log(`  指令     : 保留主体，把背景改成干净电商白底`);

  const buildForm = (imageField) => {
    const form = new FormData();
    form.set("model", MODEL);
    form.set("prompt", "保留主体，把背景改成干净电商白底");
    form.append(imageField, new Blob([inputPng], { type: "image/png" }), "input-source.png");
    return form;
  };

  // OpenAI 官方用 image[]，少数中转站只认 image —— 依次尝试
  for (const imageField of ["image[]", "image"]) {
    console.log(`\n  --- 尝试字段名: ${imageField} ---`);
    const started = Date.now();
    let response;
    try {
      response = await fetch(`${baseUrl}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: buildForm(imageField),
        signal: AbortSignal.timeout(240_000)
      });
    } catch (error) {
      console.log(`  ❌ 请求异常: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const text = await response.text();
    console.log(`  耗时         : ${Date.now() - started}ms`);
    const payload = summarizeResponse(response.status, text);

    if (!response.ok) {
      results.push({ name: `图生图(${imageField})`, ok: false, note: `HTTP ${response.status}` });
      continue;
    }
    try {
      const saved = await saveResult("edits", payload);
      results.push({ name: `图生图(${imageField})`, ok: true, note: `${saved.width}×${saved.height} ${saved.format} ${saved.bytes}B` });
      return;
    } catch (error) {
      console.log(`  ❌ 解析/保存失败: ${error instanceof Error ? error.message : String(error)}`);
      results.push({ name: `图生图(${imageField})`, ok: false, note: "解析/保存失败" });
    }
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
console.log("========== GPT Image 2.5 最小直连测试 ==========");
console.log(`Base URL : ${baseUrl}`);
console.log(`Model    : ${MODEL}`);
console.log(`API Key  : ${maskKey(apiKey)}`);
console.log(`配置文件 : ${CONFIG_PATH} ${existsSync(CONFIG_PATH) ? "(存在)" : "(不存在)"}`);

if (!apiKey) {
  console.log("\n❌ 未找到 GPT Image 2.5 的 API Key，无法进行真实调用。");
  console.log("   请任选一种方式配置后重跑本脚本：");
  console.log("   1) 打开当前工具的「系统设置 → OpenAI GPT Image 2.5」卡片，填入 API Key 并保存；");
  console.log(`      （会写入 ${CONFIG_PATH}）`);
  console.log("   2) 或在项目根目录 .env.local 中添加：");
  console.log("      ORIGIN_GATEWAY_API_KEY=<你的 key>");
  console.log(`      ORIGIN_GATEWAY_BASE_URL=${baseUrl.replace(/\/v1$/, "")}`);
  console.log("\n   本次未发起任何计费请求。");
  process.exit(2);
}

await checkReachability();

if (which === "generations" || which === "both") await testGenerations();
if (which === "edits" || which === "both") await testEdits();

console.log("\n========== 汇总 ==========");
for (const item of results) console.log(`  ${item.ok ? "✅" : "❌"} ${item.name}  ${item.note || ""}`);
const failed = results.filter((item) => !item.ok);
console.log(`\n通过 ${results.length - failed.length} / 失败 ${failed.length}`);
console.log(`输出目录：${OUT_DIR}`);
process.exit(failed.length ? 1 : 0);
