#!/usr/bin/env node
/**
 * 营销生图引擎 · 配置生成器
 *
 * 把 src/marketing/ 下的 Markdown 配置（strategies / platforms / copy / qa）
 * 解析成一份可被打包进 Next.js / Electron 的 JSON，供引擎在运行时直接读取。
 *
 * 为什么需要它：Next.js 生产构建不会自动把任意 .md 文件带进产物；
 * 先生成 JSON 再 import，才能保证「开发、正式构建、桌面 App」读到的是同一份配置。
 *
 * 用法：npm run marketing:build
 * 该命令已挂在 predev / prebuild 上，日常启动或构建会自动执行。
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const configRoot = path.join(projectRoot, "src", "marketing");
const outputPath = path.join(configRoot, "generated", "config.json");
const GROUPS = ["strategies", "platforms", "copy", "product-fidelity", "typography", "qa"];

async function main() {
  const groups = {};
  for (const group of GROUPS) groups[group] = await readGroup(group);
  const hash = createHash("sha256").update(JSON.stringify(groups)).digest("hex").slice(0, 16);
  const payload = { schemaVersion: 1, generatedAt: new Date().toISOString(), contentHash: hash, groups };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  const counts = {};
  for (const group of GROUPS) counts[group] = groups[group].length;
  console.log("[marketing] 配置已生成：" + path.relative(projectRoot, outputPath) + " hash=" + hash + " " + JSON.stringify(counts));
}

async function readGroup(group) {
  const directory = path.join(configRoot, group);
  let entries = [];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const files = entries.filter((name) => /\.md$/i.test(name) && !name.startsWith("_")).sort();
  const items = [];
  for (const file of files) {
    const raw = await readFile(path.join(directory, file), "utf8");
    items.push(parseEntry(raw, file, group));
  }
  return items;
}

function parseEntry(raw, file, group) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error("src/marketing/" + group + "/" + file + " 缺少 YAML 头信息。");
  const meta = parseYaml(match[1].replace(/\r\n?/g, "\n")) || {};
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("src/marketing/" + group + "/" + file + " 的 YAML 头信息无效。");
  const id = String(meta.id || "").trim();
  if (!id) throw new Error("src/marketing/" + group + "/" + file + " 缺少 id。");
  const body = match[2].trim();
  return { ...meta, id, file: group + "/" + file, guidance: body, sections: parseSections(body) };
}

function parseSections(body) {
  const lines = body.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections.map((section) => ({ title: section.title, content: section.lines.join("\n").trim() }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
