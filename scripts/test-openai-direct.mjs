#!/usr/bin/env node
/* 直接调用 OpenAI API 测试，绕过所有 UI */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const configPath = path.join(os.homedir(), "Library/Application Support/director-platform/director-platform-data/commerce-image/providers.json");
console.log("Config:", configPath);

try {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const p = config.providers?.openai_v25;
  if (!p?.apiKey) { console.error("❌ openai_v25 没有保存的 API Key"); process.exit(1); }

  const url = `${(p.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/images/generations`;
  console.log("URL:", url);
  console.log("Model:", p.modelId);
  console.log("Key:", p.apiKey.slice(0, 6) + "...", `(${p.apiKey.length} chars)`);
  console.log("\n正在调用 OpenAI API…（可能需要 30-60 秒）\n");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: p.modelId, prompt: "A simple red apple on a white background", n: 1 })
  });

  console.log(`HTTP Status: ${res.status} ${res.statusText}`);
  const body = await res.text();
  try {
    const json = JSON.parse(body);
    if (json.error) {
      console.log("\n❌ OpenAI 返回错误：");
      console.log("  type:", json.error.type);
      console.log("  code:", json.error.code);
      console.log("  message:", json.error.message);
    } else if (json.data) {
      console.log(`\n✅ 成功！生成了 ${json.data.length} 张图片`);
      if (json.data[0]?.b64_json) console.log(`  格式: base64 (${json.data[0].b64_json.length} 字符)`);
      if (json.data[0]?.url) console.log(`  URL: ${json.data[0].url.slice(0, 120)}`);
    } else {
      console.log("Response:", JSON.stringify(json).slice(0, 600));
    }
  } catch {
    console.log("Raw:", body.slice(0, 600));
  }
} catch (e) {
  console.error("Error:", e.message);
  if (e.cause) console.error("Cause:", e.cause.code || e.cause.message);
}
