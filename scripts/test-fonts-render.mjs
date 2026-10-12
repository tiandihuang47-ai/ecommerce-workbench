#!/usr/bin/env node
/**
 * 字体与文字渲染基础设施测试（不调用模型、不产生费用）。
 *
 * 验证：
 *  1. 内置字体存在且与 SHA256SUMS.txt 校验一致；
 *  2. fontkit 能打开两个字体，家族名正确，常用中英文/数字/标点字形齐全；
 *  3. 同一文本的度量结果确定（两次测量一致），换行逻辑可复现；
 *  4. 相同输入用 sharp 渲染两次得到逐字节相同的 PNG（导出可复现，尺寸一致）。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = path.join(projectRoot, "assets", "fonts");
const SUMS_FILE = path.join(fontDir, "SHA256SUMS.txt");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const SAMPLE_TEXT = `新品上市：限量发售，MiaoMax Pro 无线蓝牙耳机，附赠收纳盒。价格 199 元（07:00 开售）——“黑胶音质”，请以商品页为准！`;

async function main() {
  console.log("[fonts] 内置字体与校验");
  const sumsText = existsSync(SUMS_FILE) ? readFileSync(SUMS_FILE, "utf8") : "";
  const sums = new Map(
    sumsText.split("\n").filter(Boolean).map((line) => {
      const [hash, file] = line.trim().split(/\s+/);
      return [path.basename(file), hash];
    })
  );

  for (const [family, fileName] of [
    ["黑体", "NotoSansSC-Regular.otf"],
    ["宋体", "NotoSerifSC-Regular.otf"]
  ]) {
    const filePath = path.join(fontDir, fileName);
    check(`${family} 字体文件存在（${fileName}）`, existsSync(filePath));
    if (!existsSync(filePath)) continue;

    const bytes = readFileSync(filePath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const expected = sums.get(fileName);
    check(`${family} SHA256 与 SHA256SUMS.txt 一致`, expected ? expected === hash : false,
      expected ? "" : "SHA256SUMS.txt 缺少该文件");

    let font = null;
    try {
      font = fontkit.openSync(filePath);
    } catch (error) {
      check(`${family} fontkit 可打开`, false, String(error));
      continue;
    }
    check(`${family} fontkit 可打开`, Boolean(font));
    const familyName = font.familyName || font.postscriptName || "";
    check(`${family} 家族名包含 Noto`, /Noto/i.test(familyName), `实际 ${familyName}`);

    const missing = [];
    for (const char of SAMPLE_TEXT) {
      const cp = char.codePointAt(0);
      if (cp > 0x20 && !font.hasGlyphForCodePoint(cp) && !missing.includes(char)) missing.push(char);
    }
    check(`${family} 样例文本无缺字（中/英/数字/标点）`, missing.length === 0,
      missing.length ? `缺字：${missing.join("")}` : "");

    const size = 64;
    const measure = (text) => font.layout(text).advanceWidth / font.unitsPerEm * size;
    const a1 = measure(SAMPLE_TEXT);
    const a2 = measure(SAMPLE_TEXT);
    check(`${family} 度量确定（两次一致）`, a1 === a2 && a1 > 0, `${a1} vs ${a2}`);

    // 换行：逐字符贪心断行（与渲染器同逻辑），每行都不超宽
    const maxWidth = 800;
    let line = "";
    const lines = [];
    for (const char of SAMPLE_TEXT.replace(/\n/g, "")) {
      const candidate = line + char;
      if (measure(candidate) > maxWidth && line) {
        lines.push(line);
        line = char;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
    check(`${family} 换行后每行宽度不超限`, lines.every((l) => measure(l) <= maxWidth + 0.5),
      lines.map((l) => measure(l).toFixed(1)).join(","));

    // 缺字检测对生僻字应有提示（用 PUA 区字符，任何字体都没有）
    const puaMissing = [..."\uE000\uE001"].filter((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0)));
    check(`${family} PUA 私有区字符可被识别为缺字`, puaMissing.length === 2);
  }

  console.log("[fonts] sharp 导出可复现性");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400">
  <rect width="800" height="400" fill="#ffffff"/>
  <text font-family="'Noto Sans CJK SC', sans-serif" font-size="40" font-weight="bold" fill="#111111" x="40" y="120">新品上市：限量发售</text>
  <text font-family="'Noto Sans CJK SC', sans-serif" font-size="28" fill="#333333" x="40" y="220">价格 199 元，“黑胶音质”。</text>
</svg>`;
  const render = () => sharp({ create: { width: 800, height: 400, channels: 3, background: "#ffffff" } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
  const png1 = await render();
  const png2 = await render();
  check("相同输入渲染两次 PNG 逐字节一致", png1.equals(png2));
  const meta = await sharp(png1).metadata();
  check("导出尺寸与画布一致（800×400）", meta.width === 800 && meta.height === 400, `${meta.width}×${meta.height}`);
  const hasInk = png1.some((b) => b < 200);
  check("文字确实被绘制出来（存在深色像素）", hasInk);
  if (!hasInk) {
    console.log("  提示：PNG 全白说明 sharp/librsvg 没找到 Noto 字体，服务器部署需要安装字体或配置 fontconfig。");
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) {
    for (const item of failures) console.log(`  - ${item}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
