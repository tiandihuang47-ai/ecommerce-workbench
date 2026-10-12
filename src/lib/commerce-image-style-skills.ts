import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { parse as parseYaml } from "yaml";
import { commerceImageDataRoot, ensureCommerceImageDataRoot } from "@/lib/commerce-image-config";
import { readImageMetadata } from "@/lib/commerce-image-file";
import {
  getCommerceImageTask,
  persistCommerceImageDerivedSource,
  saveCommerceImageTask
} from "@/lib/commerce-image-store";
import type { CommerceImageAsset, CommerceImageStyleSkill } from "@/lib/commerce-image-types";

const maxArchiveBytes = 20 * 1024 * 1024;
const maxExpandedBytes = 50 * 1024 * 1024;
const maxMarkdownBytes = 1024 * 1024;
const allowedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export async function listCommerceImageStyleSkills(options: { includeDisabled?: boolean } = {}) {
  const skills = await readIndex();
  return skills.filter((skill) => options.includeDisabled || skill.enabled).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function importCommerceImageStyleSkill(file: { name: string; bytes: Uint8Array }) {
  if (!file.bytes.byteLength) throw new Error("Skill 文件为空。");
  const extension = path.extname(file.name).toLowerCase();
  let markdown = "";
  let referenceFiles: Array<{ name: string; bytes: Uint8Array }> = [];
  if (extension === ".md" || extension === ".markdown") {
    if (file.bytes.byteLength > maxMarkdownBytes) throw new Error("Markdown Skill 不能超过 1MB。");
    markdown = Buffer.from(file.bytes).toString("utf8");
  } else if (extension === ".zip") {
    if (file.bytes.byteLength > maxArchiveBytes) throw new Error("Skill ZIP 不能超过 20MB。");
    const parsed = await readSkillZip(file.bytes);
    markdown = parsed.markdown;
    referenceFiles = parsed.referenceFiles;
  } else {
    throw new Error("只支持导入 Markdown 或 ZIP 格式的风格 Skill。");
  }

  const parsed = parseSkillMarkdown(markdown, file.name);
  const hash = createHash("sha256");
  hash.update(markdown);
  referenceFiles.forEach((item) => { hash.update(item.name); hash.update(item.bytes); });
  const contentHash = hash.digest("hex");
  const existing = (await readIndex()).find((skill) => skill.contentHash === contentHash);
  if (existing) return { skill: existing, duplicate: true };

  const now = new Date().toISOString();
  const id = `commerce_image_skill_${randomUUID()}`;
  const directory = path.join(await skillsRoot(), id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, "SKILL.md"), markdown, { encoding: "utf8", mode: 0o600 });
  const referenceAssets: CommerceImageAsset[] = [];
  for (const [index, item] of referenceFiles.slice(0, 10).entries()) {
    const metadata = readImageMetadata(item.bytes);
    const assetId = `commerce_image_asset_${randomUUID()}`;
    const storagePath = path.join(directory, `${String(index + 1).padStart(2, "0")}-${assetId}${metadata.extension}`);
    await writeFile(storagePath, item.bytes, { mode: 0o600 });
    referenceAssets.push({
      id: assetId,
      role: "skill_reference",
      name: safeFileName(item.name),
      mimeType: metadata.mimeType,
      size: item.bytes.byteLength,
      width: metadata.width,
      height: metadata.height,
      createdAt: now,
      storagePath
    });
  }
  const skill: CommerceImageStyleSkill = {
    id,
    name: parsed.name,
    description: parsed.description,
    version: parsed.version,
    platforms: parsed.platforms,
    tags: parsed.tags,
    instructions: parsed.instructions,
    contentHash,
    referenceAssets,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
  const all = await readIndex();
  await writeIndex([...all, skill]);
  return { skill, duplicate: false };
}

export async function disableCommerceImageStyleSkill(skillId: string) {
  const skills = await readIndex();
  const target = skills.find((skill) => skill.id === skillId);
  if (!target) return null;
  const next = skills.map((skill) => skill.id === skillId ? { ...skill, enabled: false, updatedAt: new Date().toISOString() } : skill);
  await writeIndex(next);
  return next.find((skill) => skill.id === skillId) || null;
}

export async function resolveCommerceImageStyleSkillAsset(skillId: string, assetId: string) {
  const skill = (await readIndex()).find((item) => item.id === skillId);
  const asset = skill?.referenceAssets.find((item) => item.id === assetId);
  if (!asset?.storagePath || !isInsideSkillsRoot(asset.storagePath)) return null;
  return { path: asset.storagePath, mimeType: asset.mimeType, name: asset.name };
}

export function toPublicCommerceImageStyleSkill(skill: CommerceImageStyleSkill): CommerceImageStyleSkill {
  return {
    ...skill,
    referenceAssets: skill.referenceAssets.map((asset) => ({
      ...asset,
      storagePath: undefined,
      url: `/api/commerce-image/style-skills/assets?skillId=${encodeURIComponent(skill.id)}&assetId=${encodeURIComponent(asset.id)}`
    }))
  };
}

export async function applyCommerceImageStyleSkill(taskId: string, skillId: string) {
  const task = await getCommerceImageTask(taskId);
  if (!task) throw new Error("生图项目不存在。");
  const skill = (await readIndex()).find((item) => item.id === skillId && item.enabled);
  if (!skill) throw new Error("没有找到可用的风格 Skill。");
  const copiedIds: string[] = [];
  for (const asset of skill.referenceAssets) {
    if (!asset.storagePath || !isInsideSkillsRoot(asset.storagePath)) continue;
    const result = await persistCommerceImageDerivedSource({
      taskId,
      bytes: new Uint8Array(await readFile(asset.storagePath)),
      name: asset.name,
      role: "skill_reference"
    });
    copiedIds.push(result.asset.id);
  }
  const current = await getCommerceImageTask(taskId);
  if (!current) throw new Error("生图项目不存在。");
  return saveCommerceImageTask({
    ...current,
    sourceAssets: current.sourceAssets.filter((asset) => asset.role !== "skill_reference" || copiedIds.includes(asset.id)),
    brief: { ...current.brief, strategy: "custom_skill" },
    strategySnapshot: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      contentHash: skill.contentHash,
      instructions: skill.instructions,
      referenceAssetIds: copiedIds
    },
    planRevision: current.planRevision + 1,
    approvedPlanRevision: 0,
    approvedAt: ""
  });
}

async function readSkillZip(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes, { createFolders: false });
  const entries = Object.values(zip.files);
  if (entries.length > 100) throw new Error("Skill ZIP 文件数量超过 100 个。");
  for (const entry of entries) {
    const unsafeName = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName;
    validateArchivePath(unsafeName || entry.name);
    if (isSymlink(entry)) throw new Error("Skill ZIP 不允许包含软链接。");
    if (!entry.dir && path.extname(entry.name).toLowerCase() === ".zip") throw new Error("Skill ZIP 不允许包含嵌套压缩包。");
  }
  const declaredExpandedBytes = entries.reduce((total, entry) => {
    const data = (entry as typeof entry & { _data?: { uncompressedSize?: number } })._data;
    return total + (Number.isFinite(data?.uncompressedSize) ? Number(data?.uncompressedSize) : 0);
  }, 0);
  if (declaredExpandedBytes > maxExpandedBytes) throw new Error("Skill ZIP 解压后超过 50MB。");
  const markdownEntries = entries.filter((entry) => !entry.dir && /(^|\/)SKILL\.md$/i.test(entry.name));
  if (markdownEntries.length !== 1) throw new Error("ZIP 中必须且只能包含一个 SKILL.md。");
  const expanded = new Map<string, Uint8Array>();
  let expandedBytes = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const fileBytes = await entry.async("uint8array");
    expandedBytes += fileBytes.byteLength;
    if (expandedBytes > maxExpandedBytes) throw new Error("Skill ZIP 解压后超过 50MB。");
    expanded.set(entry.name, fileBytes);
  }
  const markdownBytes = expanded.get(markdownEntries[0].name) || new Uint8Array();
  if (markdownBytes.byteLength > maxMarkdownBytes) throw new Error("SKILL.md 不能超过 1MB。");
  const skillDirectory = path.posix.dirname(markdownEntries[0].name);
  const referenceFiles: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const entry of entries) {
    if (entry.dir || entry.name === markdownEntries[0].name) continue;
    const normalized = entry.name.replace(/\\/g, "/");
    const relative = skillDirectory === "." ? normalized : normalized.startsWith(`${skillDirectory}/`) ? normalized.slice(skillDirectory.length + 1) : "";
    const extension = path.extname(relative).toLowerCase();
    if (!relative || extension === ".zip") continue;
    if (!/^(references|examples)\//i.test(relative) || !allowedImageExtensions.has(extension)) continue;
    const fileBytes = expanded.get(entry.name) || new Uint8Array();
    if (fileBytes.byteLength > 10 * 1024 * 1024) throw new Error(`${relative} 超过 10MB。`);
    referenceFiles.push({ name: path.posix.basename(relative), bytes: fileBytes });
  }
  return { markdown: Buffer.from(markdownBytes).toString("utf8"), referenceFiles };
}

function isSymlink(entry: JSZip.JSZipObject) {
  const permissions = typeof entry.unixPermissions === "string"
    ? Number.parseInt(entry.unixPermissions, 8)
    : entry.unixPermissions || 0;
  return (permissions & 0o170000) === 0o120000;
}

function parseSkillMarkdown(markdown: string, fileName: string) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md 缺少 YAML 头信息，请至少填写 name 和 description。");
  let meta: Record<string, unknown>;
  try {
    const parsed = parseYaml(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid frontmatter");
    meta = parsed as Record<string, unknown>;
  } catch {
    throw new Error("SKILL.md 的 YAML 头信息无法解析。");
  }
  const name = textValue(meta.name, 100);
  const description = textValue(meta.description, 300);
  if (!name || !description) throw new Error("SKILL.md 必须包含 name 和 description。");
  const instructions = match[2].trim().slice(0, 30_000);
  if (!instructions) throw new Error(`${fileName} 没有风格指令正文。`);
  return {
    name,
    description,
    version: textValue(meta.version, 40) || "1",
    platforms: normalizePlatforms(meta.platforms),
    tags: normalizeStringArray(meta.tags, 12, 40),
    instructions
  };
}

function normalizePlatforms(value: unknown): Array<"douyin" | "xiaohongshu"> {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，\s]+/) : [];
  return [...new Set(values.map((item) => String(item).toLowerCase()).map((item) => item.includes("douyin") || item.includes("抖音") ? "douyin" : item.includes("xiaohongshu") || item.includes("小红书") ? "xiaohongshu" : "").filter((item): item is "douyin" | "xiaohongshu" => Boolean(item)))];
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，]+/) : [];
  return values.map((item) => String(item).trim().slice(0, maxLength)).filter(Boolean).slice(0, maxItems);
}

function validateArchivePath(value: string) {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").includes("..") || normalized.includes("\u0000")) {
    throw new Error("Skill ZIP 含有不安全路径，已拒绝导入。");
  }
}

async function skillsRoot() {
  const root = path.join(await ensureCommerceImageDataRoot(), "style-skills");
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

async function indexPath() { return path.join(await skillsRoot(), "index.json"); }

async function readIndex(): Promise<CommerceImageStyleSkill[]> {
  try {
    const parsed = JSON.parse(await readFile(await indexPath(), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function writeIndex(value: CommerceImageStyleSkill[]) {
  const target = await indexPath();
  const temporary = `${target}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

function isInsideSkillsRoot(filePath: string) {
  const root = path.resolve(path.join(commerceImageDataRoot(), "style-skills"));
  const target = path.resolve(filePath);
  return target.startsWith(`${root}${path.sep}`);
}

function textValue(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function safeFileName(value: string) { return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 160) || "reference.png"; }
